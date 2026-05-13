import { PrismaClient } from "@prisma/client";
import { questionSeeds } from "./seeds/questions";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // 1. Seed Questions
  console.log("🌱 Seeding questions...");

  // Safety check for clearing existing questions
  const shouldClear = process.env.SEED_CLEAR === "true";
  const isProduction = process.env.NODE_ENV === "production";
  const forceCleanup = process.env.FORCE_SEED_CLEANUP === "true";

  if (shouldClear) {
    // Additional safety check for production environment
    if (isProduction && !forceCleanup) {
      console.log("⚠️  Skipping question deletion in production environment");
    } else {
      // Confirmation prompt for destructive operation
      console.log("⚠️  About to delete all existing questions!");

      if (forceCleanup) {
        console.log(
          "✅ Force cleanup enabled, proceeding with seeding in transaction...",
        );
        const [created] = await prisma.$transaction([
          prisma.question.createMany({
            data: questionSeeds,
            skipDuplicates: true,
          }),
        ]);
        console.log(`✅ Seeded ${created.count} questions`);
      } else {
        console.log(
          "⏭️  Skipping question deletion (set SEED_CLEAR=true and FORCE_SEED_CLEANUP=true to enable)",
        );
      }
    }
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
