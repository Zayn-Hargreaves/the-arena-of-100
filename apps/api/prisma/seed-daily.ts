// ============================================================
// Daily Challenge seed - Phase 1
//
// Builds N consecutive days of question sets from the existing question
// bank. Selection is deterministic (seeded by `dateKey`), so re-running the
// seed reproduces the same sets and never shuffles a day that players have
// already answered.
//
// Usage:
//   pnpm --filter @arena/api prisma:seed:daily
//   DAILY_SEED_DAYS=60 pnpm --filter @arena/api prisma:seed:daily
//   DAILY_SEED_START=2026-08-01 pnpm --filter @arena/api prisma:seed:daily
// ============================================================

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { z } from "zod";
import { questionSeeds } from "../src/prisma-seeds/questions";
import { buildSslConfig } from "../src/common/database/ssl-config";

const QUESTIONS_PER_DAY = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const envSchema = z.object({
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
  NODE_ENV: z.string().optional(),
  /** How many consecutive days to generate. */
  DAILY_SEED_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** First day to generate (YYYY-MM-DD). Defaults to today (UTC). */
  DAILY_SEED_START: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Overwrite sets that already exist. Off by default to protect live days. */
  DAILY_SEED_OVERWRITE: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
});

const env = envSchema.parse(process.env);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: buildSslConfig({
    nodeEnv: env.NODE_ENV,
    useSSL: env.DATABASE_SSL,
    caCert: env.PG_SSL_CA,
    allowSelfSigned: env.PG_ALLOW_SELF_SIGNED,
  }),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** mulberry32 — small, fast, and reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: turns a `dateKey` into the RNG seed for that day. */
function hashDateKey(dateKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toDateKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Picks `QUESTIONS_PER_DAY` distinct questions for a day. Partial
 * Fisher-Yates over a copy: unbiased, and only as much work as we need.
 */
function pickQuestionsForDay(dateKey: string) {
  const rng = mulberry32(hashDateKey(dateKey));
  const pool = [...questionSeeds];

  for (let i = 0; i < QUESTIONS_PER_DAY; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, QUESTIONS_PER_DAY).map((question) => ({
    content: question.content,
    options: question.options,
    correctAnswer: question.correctAnswer,
    difficulty: question.difficulty,
    category: question.category,
    ...(question.explanation ? { explanation: question.explanation } : {}),
  }));
}

async function main() {
  console.log("🌱 Seeding daily challenges...");

  if (questionSeeds.length < QUESTIONS_PER_DAY) {
    throw new Error(
      `❌ Question bank has ${questionSeeds.length} entries, need at least ${QUESTIONS_PER_DAY}.`,
    );
  }

  const startMs = env.DAILY_SEED_START
    ? Date.parse(`${env.DAILY_SEED_START}T00:00:00.000Z`)
    : Date.parse(`${toDateKey(new Date())}T00:00:00.000Z`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let offset = 0; offset < env.DAILY_SEED_DAYS; offset++) {
    const dateKey = toDateKey(new Date(startMs + offset * MS_PER_DAY));
    const questions = pickQuestionsForDay(dateKey);

    const existing = await prisma.dailyQuestion.findUnique({
      where: { dateKey },
    });

    if (existing && !env.DAILY_SEED_OVERWRITE) {
      skipped++;
      continue;
    }

    if (existing) {
      await prisma.dailyQuestion.update({
        where: { dateKey },
        data: { questions, active: true },
      });
      updated++;
    } else {
      await prisma.dailyQuestion.create({
        data: { dateKey, questions, active: true },
      });
      created++;
    }
  }

  console.log(`✅ Created ${created} daily challenge(s)`);
  if (updated > 0) console.log(`♻️  Updated ${updated} existing day(s)`);
  if (skipped > 0) {
    console.log(
      `⏭️  Skipped ${skipped} existing day(s) (set DAILY_SEED_OVERWRITE=true to replace)`,
    );
  }
  console.log("🚀 Daily challenge seeding completed!");
}

main()
  .catch((e) => {
    console.error("❌ Daily seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
