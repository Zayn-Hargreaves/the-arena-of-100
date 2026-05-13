import { PrismaClient } from "@prisma/client";
import { questionSeeds } from "./seeds/questions";
import { z } from "zod";
import process from "node:process";

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
});

// Parse environment variables
const parsedEnv = envSchema.parse(process.env);

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // 1. Seed Questions
  console.log("🌱 Seeding questions...");

  // Validate questionSeeds before proceeding
  if (!Array.isArray(questionSeeds) || questionSeeds.length === 0) {
    throw new Error("❌ questionSeeds is undefined, not an array, or empty. Seeding aborted.");
  }

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

    // Perform deletion and seeding together inside a single transaction
    const [deleted, created] = await prisma.$transaction([
      prisma.question.deleteMany(),
      prisma.question.createMany({
        data: questionSeeds,
        skipDuplicates: true,
      }),
    ]);
    console.log(`🗑️ Deleted ${deleted.count} existing questions`);
    console.log(`✅ Seeded ${created.count} questions`);
  } else {
    console.log(
      "⏭️  Skipping question deletion (set SEED_CLEAR=true to enable)",
    );

    // Just seed new questions without deleting existing ones
    const { count } = await prisma.question.createMany({
      data: questionSeeds,
      skipDuplicates: true,
    });
    console.log(`✅ Seeded ${count} questions`);
  }

  // Add other seeds here as needed...
  // console.log('🌱 Seeding users...');
  // ...

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
