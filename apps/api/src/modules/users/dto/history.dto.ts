import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const historyItemSchema = z.object({
  matchId: z.string(),
  playedAt: z.string(), // ISO 8601
  roomCategory: z.string(),
  playerCount: z.number().int().positive(),
  rank: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  status: z.enum(["WON", "ELIMINATED", "ABANDONED"]),
  durationSec: z.number().nonnegative(),
  eloDelta: z.number().int().nullable().optional(),
});

export const historyResponseSchema = z.object({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type HistoryItem = z.infer<typeof historyItemSchema>;
export type HistoryResponse = z.infer<typeof historyResponseSchema>;

export class HistoryItemDto implements HistoryItem {
  @ApiProperty({ example: "ckl5g2x1y0000abcd1234efgh" })
  matchId!: string;

  @ApiProperty({ example: "2026-05-30T18:24:00.000Z" })
  playedAt!: string;

  @ApiProperty({ example: "ALL" })
  roomCategory!: string;

  @ApiProperty({ example: 100 })
  playerCount!: number;

  @ApiProperty({
    example: 1,
    description: "1-based rank by MatchPlayer.score within the match",
  })
  rank!: number;

  @ApiProperty({ example: 3200 })
  score!: number;

  @ApiProperty({ enum: ["WON", "ELIMINATED", "ABANDONED"] })
  status!: "WON" | "ELIMINATED" | "ABANDONED";

  @ApiProperty({ example: 312, description: "Match duration in seconds" })
  durationSec!: number;

  @ApiProperty({
    example: 16,
    nullable: true,
    required: false,
    description: "ELO change in this match",
  })
  eloDelta?: number | null;
}

export class HistoryResponseDto implements HistoryResponse {
  @ApiProperty({ type: [HistoryItemDto] })
  items!: HistoryItemDto[];

  @ApiProperty({ example: "ckl5g2x1y0000abcd1234efgh", nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ example: false })
  hasMore!: boolean;
}
