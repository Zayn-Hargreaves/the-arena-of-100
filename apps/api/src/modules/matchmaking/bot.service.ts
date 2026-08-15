// ============================================================
// Bot Service - AI Opponent Simulation for Matchmaking
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AVATAR_SEEDS, MATCHMAKING_CONFIG, DEFAULT_ELO } from "@arena/shared";
import { nanoid } from "nanoid";

export interface BotAnswerSimulation {
  userId: string;
  answer: string;
  responseTimeMs: number;
  submissionId: string;
  clientTimestamp: number;
}

export const BOT_NAME_PREFIXES = [
  "Bot",
  "AI",
  "Neo",
  "Cyber",
  "Pro",
  "Thánh",
  "HọcBá",
  "VôTri",
  "CaoThủ",
  "SiêuNhí",
  "BáĐạo",
  "HiệpSĩ",
  "PhùThủy",
  "ẨnDanh",
  "BấtBại",
] as const;

export const BOT_NAME_PREFIX_SET = new Set<string>(BOT_NAME_PREFIXES);

export function isBotName(name?: string | null): boolean {
  if (!name) return false;
  const prefix = name.split("_")[0];
  return prefix ? BOT_NAME_PREFIX_SET.has(prefix) : false;
}

const BOT_NAME_SUFFIXES = [
  "99",
  "Pro",
  "Vip",
  "X",
  "2026",
  "King",
  "Master",
  "Genius",
  "Chớp",
  "Bão",
  "GàCon",
  "ĐộcCô",
  "CựcBén",
  "Zero",
  "One",
];

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates or fetches existing bot users to fill matchmaking slots.
   */
  async ensureBotUsers(count: number, baseElo = DEFAULT_ELO) {
    if (count <= 0) return [];

    // Query existing bot accounts
    const existingBots = await this.prisma.user.findMany({
      where: {
        guestId: { startsWith: "bot_" },
      },
      take: count,
    });

    const needed = count - existingBots.length;
    const createdBots = [];

    for (let i = 0; i < needed; i++) {
      const prefix =
        BOT_NAME_PREFIXES[Math.floor(Math.random() * BOT_NAME_PREFIXES.length)];
      const suffix =
        BOT_NAME_SUFFIXES[Math.floor(Math.random() * BOT_NAME_SUFFIXES.length)];
      const randomNum = Math.floor(Math.random() * 900) + 100;
      let username = `${prefix}_${suffix}_${randomNum}`;
      const guestId = `bot_${nanoid(12)}`;
      const avatar =
        AVATAR_SEEDS[Math.floor(Math.random() * AVATAR_SEEDS.length)];

      // Vary bot ELO around baseElo ± 100
      const eloVariance = Math.floor(Math.random() * 200) - 100;
      const botElo = Math.max(800, baseElo + eloVariance);

      let created = false;
      let attempts = 0;
      while (!created && attempts < 3) {
        attempts++;
        try {
          const bot = await this.prisma.user.create({
            data: {
              username,
              guestId,
              avatar,
              elo: botElo,
            },
          });
          createdBots.push(bot);
          created = true;
        } catch (err) {
          const failedUsername = username;
          username = `${prefix}_${suffix}_${Math.floor(Math.random() * 9000) + 1000}`;
          if (attempts >= 3) {
            this.logger.warn(
              `Failed to create bot user ${failedUsername}`,
              err,
            );
          }
        }
      }
    }

    return [...existingBots, ...createdBots].slice(0, count);
  }

  /**
   * Simulates answer submissions for bot players for a given round.
   */
  simulateBotAnswers(
    question: {
      id: string;
      answer?: string;
      correctAnswer?: string;
      options: string[];
      difficulty?: string;
    },
    botUserIds: string[],
  ): BotAnswerSimulation[] {
    return simulateBotAnswers(question, botUserIds);
  }

  static simulateBotAnswers = simulateBotAnswers;
}

export function simulateBotAnswers(
  question: {
    id: string;
    answer?: string;
    correctAnswer?: string;
    options: string[];
    difficulty?: string;
  },
  botUserIds: string[],
): BotAnswerSimulation[] {
  const now = Date.now();
  const simulations: BotAnswerSimulation[] = [];

  // Probability of choosing the correct answer based on difficulty
  let correctProbability = 0.65;
  const diff = question.difficulty?.toUpperCase();
  if (diff === "EASY") correctProbability = 0.85;
  else if (diff === "HARD") correctProbability = 0.45;

  const correctAnswer = question.correctAnswer ?? question.answer ?? "";
  const wrongOptions = question.options.filter((opt) => opt !== correctAnswer);

  for (const userId of botUserIds) {
    const isCorrect = Math.random() < correctProbability;
    let chosenAnswer: string;

    if (isCorrect || wrongOptions.length === 0) {
      chosenAnswer = correctAnswer;
    } else {
      chosenAnswer =
        wrongOptions[Math.floor(Math.random() * wrongOptions.length)] ||
        correctAnswer;
    }

    // Random delay between MIN and MAX
    const minDelay = MATCHMAKING_CONFIG.MIN_BOT_ANSWER_DELAY_MS;
    const maxDelay = MATCHMAKING_CONFIG.MAX_BOT_ANSWER_DELAY_MS;
    const responseTimeMs = Math.floor(
      minDelay + Math.random() * (maxDelay - minDelay),
    );

    simulations.push({
      userId,
      answer: chosenAnswer,
      responseTimeMs,
      submissionId: `bot_sub_${nanoid(10)}`,
      clientTimestamp: now - (maxDelay - responseTimeMs),
    });
  }

  return simulations;
}
