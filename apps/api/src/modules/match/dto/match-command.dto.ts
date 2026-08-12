import { z } from "zod";

// ---- Zod Validation Schemas ---------------------------------

export const submitAnswerBodySchema = z.object({
  type: z.literal("submit_answer"),
  userId: z.string(),
  answer: z.string(),
  submissionId: z.string(),
  clientTs: z.number().finite(),
  commandId: z.string().min(1),
});

export const playerDisconnectBodySchema = z.object({
  type: z.literal("player_disconnect"),
  userId: z.string(),
});

// Card command bodies forwarded to the owner via the durable command
// channel (see MatchHandler.handleCardPick / handleCardPlay and
// MatchCommandService.dispatchBuiltin). The handler at the boundary
// already validated `commandId` (assertValidCommandId) and `cardId`
// (assertCardId) shape; the owner re-validates authoritative state
// (hand, target, AOE cap) and performs the single-writer mutation.
export const cardPickBodySchema = z.object({
  type: z.literal("card_pick"),
  userId: z.string().min(1),
  commandId: z.string().min(1),
  cardId: z.string(),
  offerSeqNo: z.number().int().positive(),
});

export const cardPlayBodySchema = z.object({
  type: z.literal("card_play"),
  userId: z.string().min(1),
  commandId: z.string().min(1),
  cardId: z.string().min(1),
  offerSeqNo: z.number().int().positive(),
  targetPlayerId: z.string().min(1).optional(),
});

export const commandBodySchema = z.discriminatedUnion("type", [
  submitAnswerBodySchema,
  playerDisconnectBodySchema,
  cardPickBodySchema,
  cardPlayBodySchema,
]);

export const commandEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(1),
  matchId: z.string(),
  emittedByNodeId: z.string(),
  emittedAt: z.number().finite(),
  body: commandBodySchema,
});

// ---- Types derived from schema / interfaces -------------------

export type SubmitAnswerBody = z.infer<typeof submitAnswerBodySchema>;
export type PlayerDisconnectBody = z.infer<typeof playerDisconnectBodySchema>;
export type CardPickBody = z.infer<typeof cardPickBodySchema>;
export type CardPlayBody = z.infer<typeof cardPlayBodySchema>;
export type OwnerCommandBody = z.infer<typeof commandBodySchema>;

export interface CommandEnvelope<
  T extends OwnerCommandBody = OwnerCommandBody,
> {
  readonly eventId: string; // uuid — transport-level dedup key
  readonly schemaVersion: 1;
  readonly matchId: string;
  readonly emittedByNodeId: string;
  readonly emittedAt: number; // epoch ms
  readonly body: T;
}
