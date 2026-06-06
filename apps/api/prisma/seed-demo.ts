// ============================================================
// Demo Seed - Sample data for Profile / Rankings UI
//
// Idempotent: re-running the script re-uses demo users (upsert
// by username) and rebuilds matches attached to the DEMO_ARENA
// room. Safe to run repeatedly during local development and E2E
// tests.
//
// Refuses to run against production environments.
// ============================================================

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { z } from "zod";
import { AVATAR_SEEDS } from "@arena/shared";
import { buildSslConfig } from "../src/common/database/ssl-config";

// ---------- Environment guards ----------

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.string().optional(),
  DATABASE_SSL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  PG_SSL_CA: z.string().optional(),
  PG_ALLOW_SELF_SIGNED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  DEMO_PIN_USER_ID: z.string().optional(),
  DEMO_NUM_USERS: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .pipe(z.number().int().positive().max(500))
    .optional(),
});

const env = envSchema.parse(process.env);

if (env.NODE_ENV === "production") {
  throw new Error(
    "❌ Refusing to run demo seed in production (NODE_ENV=production).",
  );
}

// Guard against running against dev DB by default: this script is
// meant for the isolated test DB unless explicitly opted in.
const isTestDb =
  env.DATABASE_URL.includes(":5434/") ||
  env.DATABASE_URL.includes(":5433/") ||
  env.DATABASE_URL.includes("/arena_test") ||
  process.env.DEMO_ALLOW_DEV_DB === "true";
if (!isTestDb) {
  throw new Error(
    "❌ Refusing to run demo seed against what looks like a non-test database.\n" +
      "   Expected DATABASE_URL to point at port 5433/5434 or DB name 'arena_test'.\n" +
      "   Set DEMO_ALLOW_DEV_DB=true to override (NOT recommended).",
  );
}

// ---------- Prisma client ----------

const sslConfig = buildSslConfig({
  nodeEnv: env.NODE_ENV,
  useSSL: env.DATABASE_SSL,
  caCert: env.PG_SSL_CA,
  allowSelfSigned: env.PG_ALLOW_SELF_SIGNED,
});

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  ssl: sslConfig,
});
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

// ---------- Configuration ----------

const DEMO_ROOM_CODE = "DEMO_ARENA";
const NUM_USERS = env.DEMO_NUM_USERS ?? 30;
const NUM_MATCHES = 8;
const PLAYERS_PER_MATCH = 10;
const QUESTIONS_PER_MATCH_MIN = 5;
const QUESTIONS_PER_MATCH_MAX = 10;
// Realistic ceiling: ~15% of players time out per round (no answer row).
// Below the 100% mark on purpose so the seed mirrors real-world rates
// where timeouts happen, while still guaranteeing every matchPlayer
// accumulates answer rows across the match (rotates fairly).
const TIMEOUT_RATE = 0.15;
const MATCH_SPAN_DAYS = 14; // covers weekly and all-time leaderboards

// ---------- Deterministic PRNG (mulberry32) ----------
// Same seed -> same dataset -> reproducible E2E and screenshots.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260606);

function pick<T>(arr: readonly T[]): T {
  const idx = Math.floor(rand() * arr.length);
  return arr[idx] as T;
}

function rangeInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

// ---------- Score formula (matches in-game runtime) ----------

function computeScore(isCorrect: boolean, responseTimeMs: number): number {
  if (!isCorrect) return 0;
  return Math.floor(100 + Math.max(0, (10000 - responseTimeMs) / 200));
}

// ---------- Main ----------

async function main() {
  console.log("🌱 Seeding demo data (Profile / Rankings)...");
  console.log(
    `   Users: ${NUM_USERS}, Matches: ${NUM_MATCHES}, Span: ${MATCH_SPAN_DAYS}d`,
  );

  // 1. Ensure base lookup data exists (questions).
  const questionCount = await prisma.question.count({
    where: { active: true },
  });
  if (questionCount === 0) {
    throw new Error(
      "❌ No active questions found. Run `pnpm prisma:seed:dev` first to seed questions.",
    );
  }
  console.log(`   Found ${questionCount} active questions`);

  const allQuestions = await prisma.question.findMany({
    where: { active: true },
    select: { id: true, correctAnswer: true },
  });

  // 2. Create / refresh users.
  const userIds: string[] = [];
  for (let i = 1; i <= NUM_USERS; i++) {
    const username = `demo_player_${String(i).padStart(2, "0")}`;
    const avatar = pick(AVATAR_SEEDS);

    const user = await prisma.user.upsert({
      where: { username },
      update: { avatar },
      create: { username, avatar, role: "GUEST" },
      select: { id: true, username: true, avatar: true },
    });
    userIds.push(user.id);
  }
  console.log(`✅ Upserted ${userIds.length} demo users`);

  // 2b. When DEMO_RESET=true, wipe ALL demo-related rows up-front
  // so the seed produces a clean baseline. The :reset variant of
  // the npm script sets this flag. Order matters: matches first
  // (cascades to players/rounds/answers), then the room, then users.
  if (process.env.DEMO_RESET === "true") {
    const deletedMatches = await prisma.match.deleteMany({
      where: { room: { code: DEMO_ROOM_CODE } },
    });
    const deletedRooms = await prisma.room.deleteMany({
      where: { code: DEMO_ROOM_CODE },
    });
    const deletedUsers = await prisma.user.deleteMany({
      where: { username: { startsWith: "demo_player_" } },
    });
    console.log(
      `🗑️  DEMO_RESET: deleted ${deletedMatches.count} match(es), ` +
        `${deletedRooms.count} room(s), ${deletedUsers.count} user(s)`,
    );
    // Re-create the users we just deleted (idempotent for the
    // current run, but the baseline state is now clean).
    userIds.length = 0;
    for (let i = 1; i <= NUM_USERS; i++) {
      const username = `demo_player_${String(i).padStart(2, "0")}`;
      const avatar = pick(AVATAR_SEEDS);
      const user = await prisma.user.create({
        data: { username, avatar, role: "GUEST" },
        select: { id: true, username: true, avatar: true },
      });
      userIds.push(user.id);
    }
    console.log(`✅ Re-created ${userIds.length} demo users after reset`);
  }

  // 3. Re-pin the user matching DEMO_PIN_USER_ID (optional, for live UI testing).
  if (env.DEMO_PIN_USER_ID) {
    const target = await prisma.user.findUnique({
      where: { id: env.DEMO_PIN_USER_ID },
      select: { id: true, username: true },
    });
    if (target) {
      // No schema change: just print so the dev knows which user is "theirs".
      console.log(
        `📌 Pinned target user detected: ${target.username} (${target.id})`,
      );
    }
  }

  // 4. Create / refresh the demo room.
  const firstUserId = userIds[0]!;
  const room = await prisma.room.upsert({
    where: { code: DEMO_ROOM_CODE },
    update: { status: "FINISHED", maxPlayers: PLAYERS_PER_MATCH },
    create: {
      code: DEMO_ROOM_CODE,
      type: "PUBLIC",
      status: "FINISHED",
      hostId: firstUserId,
      maxPlayers: PLAYERS_PER_MATCH,
      timeLimit: 15,
      category: "ALL",
    },
  });
  console.log(`✅ Demo room: ${room.code} (${room.id})`);

  // 5. Recreate matches attached to this room (idempotent full rebuild).
  const deleted = await prisma.match.deleteMany({
    where: { roomId: room.id },
  });
  if (deleted.count > 0) {
    console.log(`🗑️  Cleared ${deleted.count} previous demo match(es)`);
  }

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (let m = 0; m < NUM_MATCHES; m++) {
    // Match m: started (m + 0.5) days ago, ended ~20 minutes later
    const startedAt = new Date(now - (m + 0.5) * oneDayMs);
    const endedAt = new Date(startedAt.getTime() + 20 * 60 * 1000);

    // Sample PLAYERS_PER_MATCH distinct users for this match.
    const playerIds = [...userIds]
      .sort(() => rand() - 0.5)
      .slice(0, PLAYERS_PER_MATCH);

    // Create match without a pre-set winner; we'll derive it from
    // the highest-scoring player after scores are aggregated.
    const match = await prisma.match.create({
      data: {
        roomId: room.id,
        status: "FINISHED",
        startedAt,
        endedAt,
      },
      select: { id: true },
    });

    // Create MatchPlayers with initial score=0; we'll update after computing answers.
    const matchPlayers: Array<{ id: string; userId: string }> = [];
    for (const userId of playerIds) {
      const mp = await prisma.matchPlayer.create({
        data: { matchId: match.id, userId, score: 0 },
        select: { id: true, userId: true },
      });
      matchPlayers.push(mp);
    }

    // Create rounds + answers, then update each player's score.
    const numRounds = rangeInt(
      QUESTIONS_PER_MATCH_MIN,
      QUESTIONS_PER_MATCH_MAX,
    );
    const scoreByUser = new Map<string, number>();
    for (const mp of matchPlayers) scoreByUser.set(mp.userId, 0);

    for (let r = 0; r < numRounds; r++) {
      const question = pick(allQuestions)!;
      const round = await prisma.matchRound.create({
        data: {
          matchId: match.id,
          roundNo: r + 1,
          questionId: question.id,
          startedAt: new Date(startedAt.getTime() + r * 60 * 1000),
          endedAt: new Date(startedAt.getTime() + (r + 1) * 60 * 1000 - 500),
        },
        select: { id: true },
      });

      // A subset of players answer this round (the rest time out).
      // Shuffle deterministically so different players skip different
      // rounds — over a full match every player has answer rows, so
      // stats aggregations (avgResponseMs, accuracy) are well-defined.
      const answeringPlayers = [...matchPlayers].filter(
        () => rand() >= TIMEOUT_RATE,
      );

      const answerRows: Prisma.AnswerCreateManyInput[] = answeringPlayers.map(
        (mp) => {
          const isCorrect = rand() < 0.6; // 60% correct rate
          const responseTimeMs = rangeInt(800, 9500);
          const answer = isCorrect
            ? question.correctAnswer
            : (pick(
                (["A", "B", "C", "D"] as const).filter(
                  (o) => o !== question.correctAnswer,
                ),
              ) as string);
          const score = computeScore(isCorrect, responseTimeMs);
          scoreByUser.set(mp.userId, (scoreByUser.get(mp.userId) ?? 0) + score);
          return {
            matchId: match.id,
            roundId: round.id,
            userId: mp.userId,
            answer,
            isCorrect,
            responseTimeMs,
          };
        },
      );

      if (answerRows.length > 0) {
        await prisma.answer.createMany({ data: answerRows });
      }
    }

    // Persist aggregated scores back to MatchPlayer.
    for (const mp of matchPlayers) {
      const finalScore = scoreByUser.get(mp.userId) ?? 0;
      await prisma.matchPlayer.update({
        where: { id: mp.id },
        data: { score: finalScore },
      });
    }

    // Determine the winner by the highest final score (tie-broken
    // deterministically by the player order created above).
    let winnerId: string | null = null;
    let bestScore = -1;
    for (const mp of matchPlayers) {
      const finalScore = scoreByUser.get(mp.userId) ?? 0;
      if (finalScore > bestScore) {
        bestScore = finalScore;
        winnerId = mp.userId;
      }
    }
    if (winnerId) {
      await prisma.match.update({
        where: { id: match.id },
        data: { winnerId },
      });
    }
  }

  console.log(`✅ Created ${NUM_MATCHES} FINISHED matches`);
  console.log("🚀 Demo seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Demo seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
