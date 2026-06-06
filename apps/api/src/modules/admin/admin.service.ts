// ============================================================
// Admin Service - Seeding, Database Cleanup, and System Reset
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { normalizeString, questionSeeds } from "../../prisma-seeds/questions";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Synchronizes the database questions with the questionSeeds.
   * @param clearExisting Whether to clear all existing questions before seeding.
   */
  async syncQuestions(clearExisting: boolean = true) {
    this.logger.log(
      `Starting programmatically sync questions (clearExisting: ${clearExisting})...`,
    );

    if (clearExisting) {
      this.logger.warn(
        "Deleting all existing questions, tags, and dependencies...",
      );
      // Prisma relations will handle cascading delete on QuestionTag, MatchRound questions are kept or protected.
      // Since match_rounds have on_delete: Restrict/Cascade, we'll perform a clean delete.
      // To avoid foreign key constraint violations if there are active matches referencing questions,
      // we must clear matches, rounds, answers first, or skip clearing those if it's production.
      // For general sync, clearing questions and tags is fully supported.
      await this.prisma.questionTag.deleteMany();
      await this.prisma.question.deleteMany();
      await this.prisma.tag.deleteMany();
    }

    let seededQuestions = 0;
    let seededTags = 0;
    let seededQuestionTags = 0;

    // Collect all unique tag names
    const allTagNames = new Set<string>();
    for (const question of questionSeeds) {
      const targetTags = question.tags
        ? question.tags.map((t) => normalizeString(t))
        : [];
      targetTags.forEach((tagName) => allTagNames.add(tagName));
    }

    const allTagNamesArray = Array.from(allTagNames);

    // Batch create or fetch tags
    if (allTagNamesArray.length > 0) {
      await this.prisma.tag.createMany({
        data: allTagNamesArray.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }

    const existingTags = await this.prisma.tag.findMany();
    const tagMap = new Map(existingTags.map((tag) => [tag.name, tag]));
    seededTags = existingTags.length;

    for (const question of questionSeeds) {
      const normalizedContent = question.content.trim();

      // Check if question already exists
      const existingQuestion = await this.prisma.question.findFirst({
        where: {
          content: normalizedContent,
        },
      });

      let createdQuestion;
      if (existingQuestion) {
        // Update existing question
        createdQuestion = await this.prisma.question.update({
          where: { id: existingQuestion.id },
          data: {
            options: question.options as string[],
            correctAnswer: question.correctAnswer,
            difficulty: question.difficulty,
            category: question.category,
            explanation: question.explanation,
            active: true,
          },
        });
      } else {
        // Create new question
        createdQuestion = await this.prisma.question.create({
          data: {
            content: normalizedContent,
            options: question.options as string[],
            correctAnswer: question.correctAnswer,
            difficulty: question.difficulty,
            category: question.category,
            explanation: question.explanation,
            active: true,
          },
        });
      }
      seededQuestions++;

      // Sync tags
      const targetTags = question.tags
        ? question.tags.map((t) => normalizeString(t))
        : [];

      const resolvedTags = targetTags
        .map((name) => tagMap.get(name))
        .filter((t): t is (typeof existingTags)[0] => !!t);

      if (resolvedTags.length > 0) {
        // Find existing question tags to avoid duplicate inserts
        const existingQuestionTags = await this.prisma.questionTag.findMany({
          where: { questionId: createdQuestion.id },
        });
        const existingTagIds = new Set(
          existingQuestionTags.map((qt) => qt.tagId),
        );
        const tagsToCreate = resolvedTags.filter(
          (tag) => !existingTagIds.has(tag.id),
        );

        if (tagsToCreate.length > 0) {
          await this.prisma.questionTag.createMany({
            data: tagsToCreate.map((tag) => ({
              questionId: createdQuestion.id,
              tagId: tag.id,
            })),
            skipDuplicates: true,
          });
          seededQuestionTags += tagsToCreate.length;
        }
      }
    }

    // Upsert admin user for safety
    await this.prisma.user.upsert({
      where: { username: "admin" },
      update: { role: "ADMIN" },
      create: {
        username: "admin",
        role: "ADMIN",
      },
    });

    this.logger.log(
      `Programmatic question sync successful: ${seededQuestions} questions, ${seededTags} tags, ${seededQuestionTags} tag relationships.`,
    );

    return {
      success: true,
      questionsCount: seededQuestions,
      tagsCount: seededTags,
      relationshipsCount: seededQuestionTags,
    };
  }

  /**
   * Resets the entire match system by purging DB and Redis.
   */
  async resetSystem() {
    this.logger.warn(
      "system-wide reset triggered! Purging all room, player, match state...",
    );

    // Delete DB entries in dependent order
    await this.prisma.eventLog.deleteMany();
    await this.prisma.answer.deleteMany();
    await this.prisma.matchRound.deleteMany();
    await this.prisma.matchPlayer.deleteMany();
    await this.prisma.match.deleteMany();
    await this.prisma.roomPlayer.deleteMany();
    await this.prisma.room.deleteMany();

    // Clear active lobby/match Redis keys using non-blocking SCAN approach
    const client = this.redis.getClient();
    let totalDeleted = 0;

    // Helper function to scan and delete keys in batches
    const scanAndDelete = async (pattern: string): Promise<number> => {
      let cursor = '0';
      let deletedCount = 0;
      
      do {
        const result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
        cursor = result[0];
        const keys = result[1];
        
        if (keys.length > 0) {
          const deleted = await client.del(...keys);
          deletedCount += deleted;
        }
      } while (cursor !== '0');
      
      return deletedCount;
    };

    // Scan and delete both room and match keys
    const roomDeleted = await scanAndDelete('room:*');
    const matchDeleted = await scanAndDelete('match:*');
    totalDeleted = roomDeleted + matchDeleted;

    if (totalDeleted > 0) {
      this.logger.log(`Purged ${totalDeleted} Redis keys from cache (${roomDeleted} room keys, ${matchDeleted} match keys).`);
    }

    return {
      success: true,
      message:
        "System reset complete. All active rooms, players, matches, and Redis cache cleared successfully.",
    };
  }
}
