import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env file before any other imports/execution
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { z } from "zod";
import { normalizeString } from "../src/prisma-seeds/questions";
import { buildSslConfig } from "../src/common/database/ssl-config";

// Define environment schema
const envSchema = z.object({
  SEED_CLEAR: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  NODE_ENV: z.string().optional(),
  FORCE_SEED_CLEANUP: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  DATABASE_URL: z.string(),
  DATABASE_SSL: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  PG_SSL_CA: z.string().optional(),
  PG_ALLOW_SELF_SIGNED: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  SEED_ENV: z.string().default("dev"),
});

// Parse environment variables
const parsedEnv = envSchema.parse(process.env);

const connectionString = parsedEnv.DATABASE_URL;
const useSSL = parsedEnv.DATABASE_SSL;
const caCert = parsedEnv.PG_SSL_CA;
const allowSelfSigned = parsedEnv.PG_ALLOW_SELF_SIGNED;

// buildSslConfig throws on the production+self-signed combination;
// that check used to live in this file too.
const sslConfig = buildSslConfig({
  nodeEnv: parsedEnv.NODE_ENV,
  useSSL,
  caCert,
  allowSelfSigned,
});

const pool = new Pool({
  connectionString,
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 15000, // Return an error after 15 seconds if connection could not be established
  ssl: sslConfig,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Starting database seeding...");

  // Determine which dataset to use based on SEED_ENV
  const seedEnv = parsedEnv.SEED_ENV;

  let selectedQuestions;
  if (seedEnv === "test") {
    console.log(`🌱 Seeding questions using ${seedEnv} dataset...`);
    const { testQuestionSeeds } = await import("./seeds/questions.seeds");
    selectedQuestions = testQuestionSeeds;
  } else if (seedEnv === "dev") {
    console.log(`🌱 Seeding questions using ${seedEnv} dataset...`);
    const { questionSeeds } = await import("../src/prisma-seeds/questions");
    selectedQuestions = questionSeeds;
  } else {
    throw new Error(
      `❌ Invalid SEED_ENV value: "${seedEnv}". Only "dev" and "test" are supported. Please check your parsedEnv.SEED_ENV configuration.`,
    );
  }

  // Validate selectedQuestions before proceeding
  if (!Array.isArray(selectedQuestions) || selectedQuestions.length === 0) {
    throw new Error(
      "❌ Selected questionSeeds is undefined, not an array, or empty. Seeding aborted.",
    );
  }

  // Import and run validation for selected questions
  // We need to dynamically import the validation function since it's in the same file as the data
  // For now, we'll just log the count of questions by difficulty and category
  const easyCount = selectedQuestions.filter(
    (q) => q.difficulty === "EASY",
  ).length;
  const mediumCount = selectedQuestions.filter(
    (q) => q.difficulty === "MEDIUM",
  ).length;
  const hardCount = selectedQuestions.filter(
    (q) => q.difficulty === "HARD",
  ).length;

  // Count questions by category
  const categories: Record<string, number> = {};
  selectedQuestions.forEach((q) => {
    categories[q.category] = (categories[q.category] || 0) + 1;
  });

  console.log(`📊 Question Statistics:`);
  console.log(`   EASY: ${easyCount}`);
  console.log(`   MEDIUM: ${mediumCount}`);
  console.log(`   HARD: ${hardCount}`);
  console.log(`   TOTAL: ${selectedQuestions.length}`);
  console.log(`   Categories:`);
  Object.entries(categories).forEach(([category, count]) => {
    console.log(`     ${category}: ${count}`);
  });

  // Safety check for clearing existing questions
  const shouldClear = parsedEnv.SEED_CLEAR;
  const isProduction = parsedEnv.NODE_ENV === "production";
  const forceCleanup = parsedEnv.FORCE_SEED_CLEANUP;

  if (shouldClear) {
    // Additional safety check for production environment
    if (isProduction && !forceCleanup) {
      console.log("⚠️  Skipping question deletion in production environment");
      console.log(
        "❌ Aborting seeding to prevent data inconsistency when SEED_CLEAR=true but cleanup is forbidden.",
      );
      return;
    }

    // Confirmation prompt for destructive operation
    console.log("⚠️  About to delete all existing questions!");

    // Delete existing questions, tags, and question_tags
    const deletedQuestions = await prisma.question.deleteMany();
    const deletedTags = await prisma.tag.deleteMany();
    console.log(`🗑️ Deleted ${deletedQuestions.count} existing questions`);
    console.log(`🗑️ Deleted ${deletedTags.count} existing tags`);
  } else {
    console.log(
      "⏭️  Skipping question deletion (set SEED_CLEAR=true to enable)",
    );
  }

  // Seed questions with their tags
  let seededQuestions = 0;
  let seededTags = 0;
  let seededQuestionTags = 0;

  // Collect all unique tag names for batch processing
  const allTagNames = new Set<string>();
  for (const question of selectedQuestions) {
    const targetTags = question.tags
      ? question.tags.map((t) => normalizeString(t))
      : [];
    targetTags.forEach((tagName) => allTagNames.add(tagName));
  }

  const allTagNamesArray = Array.from(allTagNames);

  // Batch fetch existing tags
  const existingTags = await prisma.tag.findMany({
    where: {
      name: {
        in: allTagNamesArray,
      },
    },
  });

  // Build tag map for quick lookups
  const tagMap = new Map(existingTags.map((tag) => [tag.name, tag]));

  // Identify and create missing tags in bulk
  const existingTagNames = new Set(existingTags.map((tag) => tag.name));
  const missingTagNames = allTagNamesArray.filter(
    (name) => !existingTagNames.has(name),
  );

  if (missingTagNames.length > 0) {
    try {
      await prisma.tag.createMany({
        data: missingTagNames.map((name) => ({ name })),
        skipDuplicates: true,
      });

      // Refresh cache by re-querying newly created tags
      const newlyCreatedTags = await prisma.tag.findMany({
        where: {
          name: {
            in: missingTagNames,
          },
        },
      });

      // Populate tagMap with newly created tags
      newlyCreatedTags.forEach((tag) => tagMap.set(tag.name, tag));
      seededTags += newlyCreatedTags.length;
    } catch (e) {
      console.error("Error creating tags in batch:", e);
      throw e;
    }
  }

  for (const question of selectedQuestions) {
    // Normalize the content for consistent comparison
    const normalizedContent = question.content.trim();

    // Check if question already exists
    const existingQuestion = await prisma.question.findFirst({
      where: {
        content: normalizedContent,
      },
    });

    let createdQuestion;
    if (existingQuestion) {
      // Update existing question
      createdQuestion = await prisma.question.update({
        where: { id: existingQuestion.id },
        data: {
          options: question.options,
          correctAnswer: question.correctAnswer,
          difficulty: question.difficulty,
          category: question.category,
          explanation: question.explanation,
          active: true,
        },
      });
    } else {
      // Create new question
      createdQuestion = await prisma.question.create({
        data: {
          content: normalizedContent,
          options: question.options,
          correctAnswer: question.correctAnswer,
          difficulty: question.difficulty,
          category: question.category,
          explanation: question.explanation,
          active: true,
        },
      });
    }
    seededQuestions++;

    // Handle tags synchronization using the tagMap for lookups
    const targetTags = question.tags
      ? question.tags.map((t) => normalizeString(t))
      : [];

    const resolvedTags: typeof existingTags = [];
    for (const tagName of targetTags) {
      const tag = tagMap.get(tagName);
      if (tag) {
        resolvedTags.push(tag);
      } else {
        console.warn(
          `⚠️ Tag "${tagName}" not found in tagMap for question "${question.content}"`,
        );
      }
    }

    // Perform all tag operations in a single transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Fetch existing questionTag entries for createdQuestion.id
      const existingQuestionTags = await tx.questionTag.findMany({
        where: { questionId: createdQuestion.id },
      });

      const targetTagIds = resolvedTags.map((t) => t.id);
      const existingTagIds = existingQuestionTags.map((qt) => qt.tagId);

      const targetTagIdSet = new Set(targetTagIds);
      const existingTagIdSet = new Set(existingTagIds);

      // Compute which tag relations need deletion and which need creation
      const tagIdsToDelete = existingTagIds.filter(
        (id) => !targetTagIdSet.has(id),
      );
      const tagIdsToCreate = targetTagIds.filter(
        (id) => !existingTagIdSet.has(id),
      );

      // Perform deletions with tx.questionTag.deleteMany for stale tagIds
      if (tagIdsToDelete.length > 0) {
        await tx.questionTag.deleteMany({
          where: {
            questionId: createdQuestion.id,
            tagId: { in: tagIdsToDelete },
          },
        });
      }

      // Create missing relations
      if (tagIdsToCreate.length > 0) {
        const result = await tx.questionTag.createMany({
          data: tagIdsToCreate.map((tagId) => ({
            questionId: createdQuestion.id,
            tagId,
          })),
          skipDuplicates: true,
        });
        seededQuestionTags += result.count;
      }
    });
  }

  console.log(`✅ Seeded ${seededQuestions} questions`);
  console.log(`✅ Seeded ${seededTags} tags`);
  console.log(`✅ Seeded ${seededQuestionTags} question-tag relationships`);

  // Clean up orphaned tags (tags not associated with any questions)
  const orphanedTags = await prisma.tag.deleteMany({
    where: {
      questions: {
        none: {},
      },
    },
  });
  if (orphanedTags.count > 0) {
    console.log(`🗑️ Pruned ${orphanedTags.count} orphaned tags`);
  }

  // Add other seeds here as needed...
  console.log("🌱 Seeding admin user...");
  await prisma.user.upsert({
    where: { username: "admin" },
    update: { role: "ADMIN" },
    create: {
      username: "admin",
      role: "ADMIN",
    },
  });
  console.log("✅ Seeded admin user");

  console.log("🚀 Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
