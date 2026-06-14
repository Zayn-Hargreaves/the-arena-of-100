// ============================================================
// Zod Schemas - Socket Event Payloads
// Runtime validation for client -> server events
// ============================================================
//
// These schemas are the single source of truth for the shape of
// every client -> server event. They serve two purposes:
//
// 1. Server-side validation: the API applies them via WsValidationPipe
//    on every @MessageBody, so a malformed payload (wrong type,
//    missing required field, oversized string, object injection
//    in a string field, ...) is rejected with INVALID_PAYLOAD before
//    any handler code runs. This is the WS analogue of the HTTP
//    ZodValidationPipe used on REST controllers.
//
// 2. Type derivation: each schema is followed by `z.infer<typeof ...>`
//    so the TypeScript payload interfaces in socket.ts are derived
//    from the schema. Drift between runtime and compile-time types
//    becomes a build error rather than a runtime surprise.

import { z } from "zod";
import { GAME_CONFIG } from "./game-config";

// Helper: roomId / matchId are server-issued CUIDs. The client never
// generates them, but we still validate the shape so a garbage value
// can't be used to probe internal state.
const idSchema = z.string().min(1).max(64);

// AUTHENTICATE ---------------------------------------------------------------

export const AuthenticatePayloadSchema = z.object({
  token: z.string().min(1).max(4096),
});
export type AuthenticatePayload = z.infer<typeof AuthenticatePayloadSchema>;

// CREATE_ROOM ----------------------------------------------------------------
// maxPlayers is bounded to GAME_CONFIG.MAX_PLAYERS to avoid a 100k-player
// room that would OOM the broadcast loop in endRound. (See M2 in the
// bug-investigation report.)
const MAX_PLAYERS_MAX = 100;

export const CreateRoomPayloadSchema = z.object({
  roomType: z.enum(["PUBLIC", "PRIVATE"]),
  maxPlayers: z.number().int().min(2).max(MAX_PLAYERS_MAX).optional(),
  timeLimit: z.number().int().positive().max(120).optional(),
  category: z.string().min(1).max(64).optional(),
});
export type CreateRoomPayload = z.infer<typeof CreateRoomPayloadSchema>;

// JOIN_ROOM ------------------------------------------------------------------

export const JoinRoomPayloadSchema = z.object({
  roomCode: z.string().min(1).max(32).optional(),
  roomType: z.enum(["PUBLIC", "PRIVATE"]).optional(),
});
export type JoinRoomPayload = z.infer<typeof JoinRoomPayloadSchema>;

// LEAVE_ROOM -----------------------------------------------------------------

export const LeaveRoomPayloadSchema = z.object({
  roomId: idSchema,
});
export type LeaveRoomPayload = z.infer<typeof LeaveRoomPayloadSchema>;

// START_MATCH ----------------------------------------------------------------

export const StartMatchPayloadSchema = z.object({
  roomId: idSchema,
});
export type StartMatchPayload = z.infer<typeof StartMatchPayloadSchema>;

// SUBMIT_ANSWER --------------------------------------------------------------
// `answer` is constrained to a string with a sensible cap. Without this,
// a client could send { answer: { inject: true } } and bypass downstream
// Prisma string-column expectations. (See C2 in the bug-investigation
// report.)
const ANSWER_MAX_LENGTH = 1024;

// clientTimestamp upper bound: ~1 year of slack beyond the moment
// the validation runs. Catches client clock-skew (browsers with
// wildly wrong system clocks, mobile devices in poor-network states)
// and obvious garbage payloads without rejecting the legitimate
// "slightly out of sync" case. Number.MAX_SAFE_INTEGER was previously
// used here, which allowed timestamps thousands of years in the
// past or future — clearly a payload corruption indicator.
//
// `.refine()` is required (not a frozen `Date.now() + OFFSET`
// constant) so a long-running server process keeps using the
// current clock as the reference, not a value baked in at module
// load. Otherwise a server up >1 year would start rejecting every
// legitimate SUBMIT_ANSWER whose timestamp is in the present.
const CLIENT_TIMESTAMP_MAX_OFFSET_MS = 365 * 24 * 60 * 60 * 1000;

export const SubmitAnswerPayloadSchema = z.object({
  matchId: idSchema,
  // roundNo is bounded by the runtime cap from GAME_CONFIG. The
  // schema mirrors the constant so a payload with a round number
  // above MAX_ROUNDS is rejected at the boundary, not at the state
  // machine. Previously this was a hardcoded 1000, which was
  // inconsistent with GAME_CONFIG.MAX_ROUNDS = 50.
  roundNo: z.number().int().positive().max(GAME_CONFIG.MAX_ROUNDS),
  answer: z.string().min(1).max(ANSWER_MAX_LENGTH),
  clientTimestamp: z
    .number()
    .int()
    .nonnegative()
    .refine(
      (ts) => ts >= Date.now() - CLIENT_TIMESTAMP_MAX_OFFSET_MS,
      "clientTimestamp too far in the past",
    )
    .refine(
      (ts) => ts <= Date.now() + CLIENT_TIMESTAMP_MAX_OFFSET_MS,
      "clientTimestamp too far in the future",
    ),
});
export type SubmitAnswerPayload = z.infer<typeof SubmitAnswerPayloadSchema>;

// REQUEST_SNAPSHOT ------------------------------------------------------------

export const RequestSnapshotPayloadSchema = z.object({
  matchId: idSchema,
  lastSeenSeqNo: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type RequestSnapshotPayload = z.infer<
  typeof RequestSnapshotPayloadSchema
>;

// HEARTBEAT ------------------------------------------------------------------

export const HeartbeatPayloadSchema = z.object({
  roomId: idSchema.optional(),
  matchId: idSchema.optional(),
  sentAt: z.number().int().nonnegative(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

// Map of ClientEvent -> schema, used by the gateway to look up the right
// schema for each @MessageBody. Keeping the mapping here means the gateway
// does not need to know the union of payload types — it just trusts the
// pipe factory and the typed handler signature.
export const CLIENT_EVENT_SCHEMAS = {
  authenticate: AuthenticatePayloadSchema,
  create_room: CreateRoomPayloadSchema,
  join_room: JoinRoomPayloadSchema,
  leave_room: LeaveRoomPayloadSchema,
  start_match: StartMatchPayloadSchema,
  submit_answer: SubmitAnswerPayloadSchema,
  request_snapshot: RequestSnapshotPayloadSchema,
  heartbeat: HeartbeatPayloadSchema,
} as const;
