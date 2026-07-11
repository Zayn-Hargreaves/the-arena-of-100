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
const MAX_PLAYERS_MAX = GAME_CONFIG.MAX_PLAYERS;

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

// clientTimestamp upper bound: ~5 minutes of slack beyond the moment
// the validation runs. Catches client clock-skew (browsers with
// wildly wrong system clocks, mobile devices in poor-network states)
// and obvious garbage payloads without rejecting the legitimate
// "slightly out of sync" case. The previous 1-year bound was a
// permissive default that accepted clearly corrupt payloads — any
// client clock more than a few minutes off is almost certainly a bug
// or a tampering attempt.
//
// `.refine()` is required (not a frozen `Date.now() + OFFSET`
// constant) so a long-running server process keeps using the
// current clock as the reference, not a value baked in at module
// load. Otherwise a server up >5 minutes would start rejecting every
// legitimate SUBMIT_ANSWER whose timestamp is in the present.
//
// Headroom rationale: ROUND_DURATION_MS = 15s. 5 minutes = 20x
// round duration = more than enough for legitimate NTP drift, mobile
// sleep recovery, and network buffering combined.
const CLIENT_TIMESTAMP_MAX_OFFSET_MS = 5 * 60 * 1000;

export const SubmitAnswerPayloadSchema = z.object({
  matchId: idSchema,
  // roundNo is bounded by the runtime cap from GAME_CONFIG. The
  // schema mirrors the constant so a payload with a round number
  // above MAX_ROUNDS is rejected at the boundary, not at the state
  // machine. Previously this was a hardcoded 1000, which was
  // inconsistent with GAME_CONFIG.MAX_ROUNDS = 50.
  roundNo: z.number().int().positive().max(GAME_CONFIG.MAX_ROUNDS),
  answer: z.string().min(1).max(ANSWER_MAX_LENGTH),
  submissionId: idSchema,
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
  // lastSeenSeqNo is the delta-replay cursor the client sends when
  // asking for a snapshot: "I have applied every event up to this
  // seqNo — give me what's newer." The server (`match.handler`
  // handleRequestSnapshot) answers with either a full SNAPSHOT
  // (cursor 0 / out of range) or an EVENT_BATCH delta of events with
  // `seqNo > lastSeenSeqNo` (see MatchStateMachine.getDelta). A fresh
  // hydrate sends 0.
  //
  // The cap is derived from the real worst-case event-log size so a
  // legitimate cursor is never rejected while obviously bogus fuzz
  // (sentinels, bit-flips) still is. A match logs up to ~MAX_PLAYERS
  // `ANSWER_SUBMITTED` per round plus round/transition/elimination
  // events across up to MAX_ROUNDS rounds, plus disconnect/reconnect
  // churn: `MAX_ROUNDS * MAX_PLAYERS` bounds the answer events and the
  // `* 2` factor covers transitions and presence churn with headroom.
  // Server-side `getFloorSeqNo`/`getHeadSeqNo` bounds validate the
  // cursor precisely; this cap is only the coarse fuzz guard.
  lastSeenSeqNo: z
    .number()
    .int()
    .nonnegative()
    .max(GAME_CONFIG.MAX_ROUNDS * GAME_CONFIG.MAX_PLAYERS * 2),
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
