import { z } from "zod";

// ---- Zod Validation Schemas ---------------------------------

export const submitAnswerBodySchema = z.object({
  type: z.literal("submit_answer"),
  userId: z.string(),
  answer: z.string(),
  submissionId: z.string(),
  clientTs: z.number().finite(),
});

export const playerDisconnectBodySchema = z.object({
  type: z.literal("player_disconnect"),
  userId: z.string(),
});

export const commandBodySchema = z.discriminatedUnion("type", [
  submitAnswerBodySchema,
  playerDisconnectBodySchema,
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
