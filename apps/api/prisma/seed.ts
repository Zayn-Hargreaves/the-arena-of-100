import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env file before any other imports/execution
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { questionSeeds } from "./seeds/questions";
import { testQuestionSeeds } from "./seeds/questions.test";
import { z } from "zod";

// Define environment schema
const envSchema = z.object({
  SEED_CLEAR: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  NODE_ENV: z.string().default("development"),
  FORCE_SEED_CLEANUP: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  DATABASE_URL: z.string(),
  SEED_ENV: z.string().default("dev"),
});

// Parse environment variables
const parsedEnv = envSchema.parse(process.env);

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Determine which dataset to use based on SEED_ENV
  const selectedQuestions =
    parsedEnv.SEED_ENV === "test" ? testQuestionSeeds : questionSeeds;
  console.log(`🌱 Seeding questions using ${parsedEnv.SEED_ENV} dataset...`);

  // Validate questionSeeds before proceeding
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

    // Handle tags if they exist
    if (question.tags && question.tags.length > 0) {
      for (const tagName of question.tags) {
        // Normalize tag name
        const normalizedTagName = tagName.trim().toLowerCase();

        // Check if tag already exists
        const existingTag = await prisma.tag.findUnique({
          where: { name: normalizedTagName },
        });

        let createdTag;
        if (!existingTag) {
          // Create new tag only if it doesn't exist
          createdTag = await prisma.tag.create({
            data: { name: normalizedTagName },
          });
          seededTags++;
        } else {
          // Use existing tag
          createdTag = existingTag;
        }

        // Create the question-tag relationship
        try {
          await prisma.questionTag.create({
            data: {
              questionId: createdQuestion.id,
              tagId: createdTag.id,
            },
          });
          seededQuestionTags++;
        } catch (e) {
          // Ignore duplicate relationships
          if (
            e instanceof Error &&
            e.message.includes("Unique constraint failed")
          ) {
            // Ignore duplicate relationships
          } else {
            throw e;
          }
        }
      }
    }
  }

  console.log(`✅ Seeded ${seededQuestions} questions`);
  console.log(`✅ Seeded ${seededTags} tags`);
  console.log(`✅ Seeded ${seededQuestionTags} question-tag relationships`);

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
  });
