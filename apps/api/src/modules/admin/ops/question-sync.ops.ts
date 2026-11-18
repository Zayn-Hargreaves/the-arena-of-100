// ============================================================
// Question sync ops — seeds/updates the question bank from
// questionSeeds, best-effort audited. Extracted verbatim from
// AdminService.syncQuestions.
// ============================================================

import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  normalizeString,
  Question,
  questionSeeds,
} from "../../../prisma-seeds/questions";
import { appendAudit } from "./admin-audit.ops";

export interface QuestionSyncDeps {
  prisma: PrismaService;
  logger: Logger;
}

type TagRecord = { id: string; name: string };

/**
 * Clear all existing questions, tags, and dependencies when requested.
 */
async function clearQuestionBank(
  tx: Prisma.TransactionClient,
  logger: Logger,
): Promise<void> {
  logger.warn("Deleting all existing questions, tags, and dependencies...");
  // Prisma relations will handle cascading delete on QuestionTag, MatchRound questions are kept or protected.
  // Since match_rounds have on_delete: Restrict/Cascade, we'll perform a clean delete.
  // To avoid foreign key constraint violations if there are active matches referencing questions,
  // we must clear matches, rounds, answers first, or skip clearing those if it's production.
  // For general sync, clearing questions and tags is fully supported.
  await tx.questionTag.deleteMany();
  await tx.question.deleteMany();
  await tx.tag.deleteMany();
}

/**
 * Collect all unique normalized tag names across seed questions.
 */
function collectUniqueSeedTags(seeds: Question[]): string[] {
  const allTagNames = new Set<string>();
  for (const question of seeds) {
    for (const t of question.tags ?? []) {
      allTagNames.add(normalizeString(t));
    }
  }
  return Array.from(allTagNames);
}

/**
 * Batch create or fetch tags in the database.
 */
async function syncTags(
  tx: Prisma.TransactionClient,
  tagNames: string[],
): Promise<Map<string, TagRecord>> {
  if (tagNames.length === 0) {
    return new Map();
  }
  await tx.tag.createMany({
    data: tagNames.map((name) => ({ name })),
    skipDuplicates: true,
  });
  const existingTags = await tx.tag.findMany({
    where: { name: { in: tagNames } },
  });
  return new Map(existingTags.map((tag) => [tag.name, tag]));
}

/**
 * Preload every question that already matches a seed's content and its
 * associated questionTag links in batch queries instead of per-seed lookups.
 */
async function preloadExistingQuestionsAndTags(
  tx: Prisma.TransactionClient,
  seedContents: string[],
) {
  const existingQuestions = await tx.question.findMany({
    where: { content: { in: seedContents } },
  });
  const existingQuestionByContent = new Map(
    existingQuestions.map((q) => [q.content, q]),
  );

  const existingQuestionIds = existingQuestions.map((q) => q.id);
  const existingQuestionTags =
    existingQuestionIds.length > 0
      ? await tx.questionTag.findMany({
          where: { questionId: { in: existingQuestionIds } },
        })
      : [];

  const existingTagIdsByQuestionId = new Map<string, Set<string>>();
  for (const qt of existingQuestionTags) {
    let set = existingTagIdsByQuestionId.get(qt.questionId);
    if (!set) {
      set = new Set();
      existingTagIdsByQuestionId.set(qt.questionId, set);
    }
    set.add(qt.tagId);
  }

  return { existingQuestionByContent, existingTagIdsByQuestionId };
}

/**
 * Sync tag links for a single question.
 */
async function syncQuestionTags(
  tx: Prisma.TransactionClient,
  questionId: string,
  questionTags: string[] | undefined,
  tagMap: Map<string, TagRecord>,
  existingTagIdsByQuestionId: Map<string, Set<string>>,
): Promise<number> {
  if (!questionTags || questionTags.length === 0) {
    return 0;
  }

  const resolvedTags = questionTags
    .map((name) => tagMap.get(normalizeString(name)))
    .filter((t): t is TagRecord => !!t);

  if (resolvedTags.length === 0) {
    return 0;
  }

  const existingTagIds =
    existingTagIdsByQuestionId.get(questionId) ?? new Set<string>();
  const tagsToCreate = resolvedTags.filter(
    (tag) => !existingTagIds.has(tag.id),
  );

  if (tagsToCreate.length === 0) {
    return 0;
  }

  await tx.questionTag.createMany({
    data: tagsToCreate.map((tag) => ({
      questionId,
      tagId: tag.id,
    })),
    skipDuplicates: true,
  });

  return tagsToCreate.length;
}

/**
 * Insert or update a single question and synchronize its tags.
 */
async function syncSingleQuestion(
  tx: Prisma.TransactionClient,
  question: Question,
  existingQuestionByContent: Map<string, { id: string }>,
  tagMap: Map<string, TagRecord>,
  existingTagIdsByQuestionId: Map<string, Set<string>>,
): Promise<{ seededQuestionTags: number }> {
  const normalizedContent = question.content.trim();
  const existingQuestion = existingQuestionByContent.get(normalizedContent);

  const questionData = {
    options: question.options,
    correctAnswer: question.correctAnswer,
    difficulty: question.difficulty,
    category: question.category,
    explanation: question.explanation,
    active: true,
  };

  const createdQuestion = existingQuestion
    ? await tx.question.update({
        where: { id: existingQuestion.id },
        data: questionData,
      })
    : await tx.question.create({
        data: {
          content: normalizedContent,
          ...questionData,
        },
      });

  const seededQuestionTags = await syncQuestionTags(
    tx,
    createdQuestion.id,
    question.tags,
    tagMap,
    existingTagIdsByQuestionId,
  );

  return { seededQuestionTags };
}

/**
 * Synchronizes the database questions with the questionSeeds.
 * @param clearExisting Whether to clear all existing questions before seeding.
 * @param adminUserId The admin user ID captured from the JWT, used for the
 *   audit row. Required — the controller always supplies it (see
 *   admin.controller.ts) and this service throws on missing input.
 */
export async function syncQuestions(
  deps: QuestionSyncDeps,
  clearExisting: boolean,
  adminUserId: string,
) {
  const { prisma, logger } = deps;
  if (!adminUserId || adminUserId.trim() === "") {
    throw new Error("syncQuestions: adminUserId is required");
  }
  logger.log(
    `Starting programmatically sync questions (clearExisting: ${clearExisting})...`,
  );

  // Accumulators for the audit row. Declared outside the try so the
  // finally block can reference them, but only ever assigned from the
  // transaction's return value AFTER it resolves (see below) — a
  // mid-seed failure rolls back the DB and leaves these at their zero
  // default, so the audit row never reports counts that were never
  // committed.
  let seededQuestions = 0;
  let seededQuestionTags = 0;
  let allTagNamesArray: string[] = [];
  let success = false;
  let errorMessage: string | undefined;

  try {
    // The full clear-and-reseed workflow (purge, tag/question
    // creation & updates, questionTag sync, admin user upsert) runs
    // as one atomic transaction: a failure partway through (e.g.
    // after the purge but before the seed completes) rolls back the
    // purge instead of leaving the question bank empty.
    const result = await prisma.$transaction(async (tx) => {
      if (clearExisting) {
        await clearQuestionBank(tx, logger);
      }

      const txAllTagNamesArray = collectUniqueSeedTags(questionSeeds);
      const tagMap = await syncTags(tx, txAllTagNamesArray);

      const seedContents = questionSeeds.map((q) => q.content.trim());
      const { existingQuestionByContent, existingTagIdsByQuestionId } =
        await preloadExistingQuestionsAndTags(tx, seedContents);

      const questionResults = await Promise.all(
        questionSeeds.map((question) =>
          syncSingleQuestion(
            tx,
            question,
            existingQuestionByContent,
            tagMap,
            existingTagIdsByQuestionId,
          ),
        ),
      );

      // Upsert admin user for safety
      await tx.user.upsert({
        where: { username: "admin" },
        update: { role: "ADMIN" },
        create: {
          username: "admin",
          role: "ADMIN",
        },
      });

      const txSeededQuestions = questionResults.length;
      const txSeededQuestionTags = questionResults.reduce(
        (sum, r) => sum + r.seededQuestionTags,
        0,
      );

      return {
        seededQuestions: txSeededQuestions,
        seededQuestionTags: txSeededQuestionTags,
        allTagNamesArray: txAllTagNamesArray,
      };
    });

    // Only assign the outer accumulators once the transaction has
    // committed, so a rollback (caught below) leaves them at their zero
    // default instead of the partial in-progress counts.
    seededQuestions = result.seededQuestions;
    seededQuestionTags = result.seededQuestionTags;
    allTagNamesArray = result.allTagNamesArray;

    logger.log(
      `Programmatic question sync successful: ${seededQuestions} questions, ${allTagNamesArray.length} tags, ${seededQuestionTags} tag relationships.`,
    );

    success = true;
  } catch (error) {
    // PR 3 (Finding 4 follow-up): log the failure with a stack
    // trace so the operator can correlate it with the audit row
    // the finally block will write. The error is re-thrown below
    // (outside the try/finally) so the controller still returns
    // 500 — the audit row is forensic, not a status override.
    errorMessage = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logger.error(
      `syncQuestions failed (clearExisting: ${clearExisting}): ${errorMessage}`,
      errStack,
    );
  } finally {
    // PR 3: append a best-effort audit row on BOTH success and
    // failure. The seed/sync operation mutates (or replaces, when
    // clearExisting=true) the question bank that every match
    // depends on, so it deserves an audit row even when the
    // operation aborts partway (e.g. after a successful clear but
    // before the seed completes — the bank would be left empty
    // with no record of who triggered the wipe). appendAudit is
    // best-effort and never throws (see helper).
    await appendAudit(deps, {
      adminUserId,
      eventType: "ADMIN_SYNC_QUESTIONS",
      payload: {
        success,
        clearExisting,
        questionsCount: seededQuestions,
        tagsCount: allTagNamesArray.length,
        relationshipsCount: seededQuestionTags,
        ...(errorMessage ? { error: errorMessage } : {}),
      },
    });
  }

  if (!success) {
    throw new Error(`syncQuestions failed: ${errorMessage ?? "unknown error"}`);
  }

  return {
    success: true,
    questionsCount: seededQuestions,
    tagsCount: allTagNamesArray.length,
    relationshipsCount: seededQuestionTags,
  };
}
