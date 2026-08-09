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
import {
  DATE_KEY_PATTERN,
  isRealUtcDate,
} from "../src/common/date/calendar-date";

const QUESTIONS_PER_DAY = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Version-conflict retries before giving up on a day (concurrent seeds). */
const MAX_PUBLISH_RETRIES = 5;

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
    .regex(DATE_KEY_PATTERN)
    .refine(isRealUtcDate, "DAILY_SEED_START must be a real calendar date")
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
 * Structural equality for a stored payload vs. a freshly derived one.
 *
 * Postgres returns JSONB keys alphabetically, while `pickQuestionsForDay`
 * writes them in declaration order — so `JSON.stringify` differs even when
 * the content is identical. Deep walk is the cheap fix.
 */
function isSamePayload(stored: unknown, next: unknown): boolean {
  if (stored === next) return true;

  // Arrays first: isPlainObject excludes them, so leaving this inside the
  // guard below reads as a fallback when it is really the questions-array
  // case — the payload's whole top level.
  if (Array.isArray(stored) || Array.isArray(next)) {
    if (!Array.isArray(stored) || !Array.isArray(next)) return false;
    if (stored.length !== next.length) return false;
    return stored.every((v, i) => isSamePayload(v, next[i]));
  }

  if (!isPlainObject(stored) || !isPlainObject(next)) return false;

  const storedKeys = Object.keys(stored);
  const nextKeys = Object.keys(next);
  if (storedKeys.length !== nextKeys.length) return false;

  return storedKeys.every((key) => isSamePayload(stored[key], next[key]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

type DayOutcome = "created" | "versioned" | "unchanged" | "skipped";

/** True when the error is a Prisma unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Publishes a day's question set, tolerating a concurrent seed process.
 *
 * Append-only does NOT eliminate the race between two seeds running at once —
 * both can read the same `latest` and try to insert the same version number.
 * What it does is make losing that race harmless: the unique
 * ([dateKey, version]) constraint rejects the duplicate instead of letting one
 * writer clobber the other's payload, and we simply re-read and retry. No
 * published row is ever mutated, so an attempt already citing a version keeps
 * grading against exactly what it was served.
 */
async function upsertDay(
  dateKey: string,
  questions: ReturnType<typeof pickQuestionsForDay>,
  attempt = 0,
): Promise<DayOutcome> {
  // Bounded: each retry re-reads a strictly newer `latest`, so a handful of
  // rounds is far more than a real seed race needs.
  if (attempt >= MAX_PUBLISH_RETRIES) {
    throw new Error(
      `❌ Gave up publishing ${dateKey} after ${MAX_PUBLISH_RETRIES} version conflicts.`,
    );
  }

  // Newest version wins; older ones are kept for the attempts that cite them.
  const latest = await prisma.dailyQuestion.findFirst({
    where: { dateKey },
    orderBy: { version: "desc" },
  });

  // Identical payload: nothing to publish. Makes reruns a true no-op rather
  // than churning version numbers on every invocation.
  if (latest && isSamePayload(latest.questions, questions)) {
    return "unchanged";
  }

  if (latest && !env.DAILY_SEED_OVERWRITE) {
    return "skipped";
  }

  try {
    await prisma.dailyQuestion.create({
      data: {
        dateKey,
        version: latest ? latest.version + 1 : 1,
        questions,
        publishedAt: new Date(),
      },
    });
    return latest ? "versioned" : "created";
  } catch (error) {
    // Another seed process claimed this version number first. Re-read and
    // retry: the winner's row is intact, and we either find our payload
    // already published (-> unchanged) or append on top of theirs.
    if (isUniqueViolation(error)) {
      return upsertDay(dateKey, questions, attempt + 1);
    }
    throw error;
  }
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

  const counts: Record<DayOutcome, number> = {
    created: 0,
    versioned: 0,
    unchanged: 0,
    skipped: 0,
  };

  for (let offset = 0; offset < env.DAILY_SEED_DAYS; offset++) {
    const dateKey = toDateKey(new Date(startMs + offset * MS_PER_DAY));
    const questions = pickQuestionsForDay(dateKey);
    const outcome = await upsertDay(dateKey, questions);
    counts[outcome]++;
  }

  console.log(`✅ Created ${counts.created} daily challenge(s)`);
  if (counts.versioned > 0) {
    console.log(
      `🆕 Published ${counts.versioned} new version(s) (old ones retained)`,
    );
  }
  if (counts.unchanged > 0) {
    console.log(`✔️  ${counts.unchanged} day(s) already up to date (no-op)`);
  }
  if (counts.skipped > 0) {
    console.log(
      `⏭️  Skipped ${counts.skipped} changed day(s) (set DAILY_SEED_OVERWRITE=true to publish a new version)`,
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
