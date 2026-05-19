import { z } from "zod";
import { MatchStatus, PlayerStatus } from "@arena/shared";

const playerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.nativeEnum(PlayerStatus),
  score: z.number(),
  totalResponseTimeMs: z.number(),
  correctAnswers: z.number(),
  isOnline: z.boolean(),
});

const answerStateSchema = z.object({
  playerId: z.string(),
  answer: z.string(),
  isCorrect: z.boolean(),
  responseTimeMs: z.number(),
  submittedAt: z.number(),
});

const questionStateSchema = z.object({
  id: z.string(),
  content: z.string(),
  options: z.array(z.string()),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
});

const roundStateSchema = z.object({
  matchId: z.string(),
  roundNo: z.number(),
  question: questionStateSchema,
  startedAt: z.number(),
  endsAt: z.number(),
  answers: z.array(z.tuple([z.string(), answerStateSchema])),
  correctAnswer: z.string(),
  status: z.enum(["PENDING", "ACTIVE", "EVALUATING", "COMPLETED"]),
});

export const deserializedMatchSchema = z.object({
  state: z.object({
    id: z.string(),
    roomId: z.string(),
    status: z.nativeEnum(MatchStatus),
    currentRoundNo: z.number(),
    totalRounds: z.number(),
    players: z.array(z.tuple([z.string(), playerInfoSchema])),
    survivingPlayerIds: z.array(z.string()),
    eliminatedPlayerIds: z.array(z.string()),
    winnerId: z.string().nullable(),
    startedAt: z.number(),
    endedAt: z.number().nullable(),
  }),
  currentRound: roundStateSchema.nullable(),
  eventLog: z.array(z.unknown()),
});

export type DeserializedMatch = z.infer<typeof deserializedMatchSchema>;
