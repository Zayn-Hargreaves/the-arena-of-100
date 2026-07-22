// ============================================================
// MatchCommandService (B4a) — owner command channel
//
// A SUBMIT_ANSWER (or player_disconnect) can arrive on ANY node — whichever
// the player's socket is on — but the authoritative mutation of match:state
// must happen on the OWNER only. This service is the durable transport that
// carries commands to the owner: a per-match Redis Stream `match:cmd:<id>`
// (XADD → owner XREADGROUP + XACK) giving at-least-once delivery, ordering
// within a match, retry of un-acked entries, and replay for audit.
//
// B4a is the transport scaffolding only — the authoritative apply
// (`dispatcher`) is wired by B4b/B5. Until a dispatcher is set, `apply`
// returns "RETRY" so nothing is acked/lost.
// ============================================================

import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Server } from "socket.io";
import { RedisService, StreamEntry } from "../redis/redis.service";
import { MatchService } from "./match.service";
import { MatchOwnershipService } from "./match-ownership.service";
import { ClusterService } from "../cluster/cluster.service";

// ---- Immutable command envelope ------------------------------

export type SubmitAnswerBody = {
  readonly type: "submit_answer";
  readonly userId: string;
  readonly answer: string;
  readonly submissionId: string;
  readonly clientTs: number;
};
export type PlayerDisconnectBody = {
  readonly type: "player_disconnect";
  readonly userId: string;
};
export type OwnerCommandBody = SubmitAnswerBody | PlayerDisconnectBody;

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

/**
 * Shared envelope factory (B4a/B5). Stamps the required transport fields —
 * `eventId` (uuid dedup key), `schemaVersion`, `emittedAt` — so producers never
 * hand-roll an envelope (and can't omit a field or inject a wrong `matchId`).
 */
export function makeCommandEnvelope<T extends OwnerCommandBody>(input: {
  matchId: string;
  emittedByNodeId: string;
  body: T;
}): CommandEnvelope<T> {
  return {
    eventId: randomUUID(),
    schemaVersion: 1,
    matchId: input.matchId,
    emittedByNodeId: input.emittedByNodeId,
    emittedAt: Date.now(),
    body: input.body,
  };
}

/** Authoritative-apply outcome. XACK on the first three; leave RETRY pending. */
export type CommandOutcome =
  | "APPLIED"
  | "DUPLICATE_EVENT"
  | "DUPLICATE_SUBMISSION"
  | "RETRY";

/**
 * The authoritative apply dispatcher — wired by B4b (submit_answer) / B5
 * (player_disconnect). Receives the validated envelope + the CURRENT
 * `{ fence, leaseValue }` ownership snapshot so the fenced CAS can reject a
 * stale owner. Returns the typed outcome that drives the ack decision.
 */
export type CommandDispatcher = (
  env: CommandEnvelope,
  owner: { fence: number; leaseValue: string },
  server: Server,
) => Promise<CommandOutcome>;

/**
 * B4b/B5 fenced side effects — wired by GameLoopService. They run AFTER a
 * successful fenced persist and re-validate the owner snapshot before touching
 * the wire, so an ex-owner can never broadcast. Kept out of MatchCommandService
 * (which owns transport + dedup) to avoid a DI cycle with GameLoopService.
 */
export interface CommandSideEffects {
  publishAnswerResult(
    env: CommandEnvelope<SubmitAnswerBody>,
    roomId: string,
    result: {
      submissionId: string;
      isCorrect: boolean;
      responseTimeMs: number;
    },
    roundNo: number,
    server: Server,
  ): void;
  checkEarlyTermination(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void>;
  /** B5: player_disconnect authoritative handling. Optional until B5 wires it. */
  handlePlayerDisconnect?(
    env: CommandEnvelope,
    owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome>;
}

/** Owner-scoped set of applied transport eventIds (dedup). Deleted on finish. */
export const appliedSetKey = (matchId: string): string =>
  `match:applied:${matchId}`;

export const OWNER_GROUP = "owners";
/** Min-idle before a pending entry is eligible for takeover (XAUTOCLAIM). */
export const CLAIM_MIN_IDLE_MS = 30_000;
const BLOCK_MS = 1_000;
const BATCH = 16;
const POLL_INTERVAL_MS = 250;

interface Registration {
  server: Server;
  abort: AbortController;
}

@Injectable()
export class MatchCommandService implements OnModuleDestroy {
  private readonly logger = new Logger(MatchCommandService.name);
  private dispatcher: CommandDispatcher | null = null;
  private sideEffects: CommandSideEffects | null = null;
  private readonly registered = new Map<string, Registration>();
  private readonly inFlight = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly matchService: MatchService,
    private readonly ownership: MatchOwnershipService,
    private readonly cluster: ClusterService,
  ) {}

  /** Wire the fenced side effects (ANSWER_RESULT publish + early-termination). */
  setSideEffects(sideEffects: CommandSideEffects): void {
    this.sideEffects = sideEffects;
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const reg of this.registered.values()) reg.abort.abort();
    this.registered.clear();
  }

  streamKey(matchId: string): string {
    return `match:cmd:${matchId}`;
  }

  private get consumer(): string {
    return this.cluster.nodeId;
  }

  /** Wire the authoritative apply dispatcher (B4b/B5). */
  setDispatcher(dispatcher: CommandDispatcher): void {
    this.dispatcher = dispatcher;
  }

  /**
   * Sender (ANY node): durable append. Returns once the XADD is persisted — the
   * envelope is the durable record, written before any apply/broadcast.
   */
  async forward(env: CommandEnvelope): Promise<void> {
    await this.redis.xadd(this.streamKey(env.matchId), JSON.stringify(env));
  }

  /**
   * Owner: register a match's stream with the shared poll set (creating the
   * consumer group if absent) when this node acquires the lease. Idempotent.
   */
  async registerMatch(matchId: string, server: Server): Promise<void> {
    const existing = this.registered.get(matchId);
    if (existing) {
      existing.server = server;
      return;
    }
    this.registered.set(matchId, { server, abort: new AbortController() });
    try {
      await this.redis.xgroupCreate(this.streamKey(matchId), OWNER_GROUP, {
        mkStream: true,
      });
    } catch (err) {
      this.logger.error(
        `registerMatch: xgroupCreate failed for ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    this.ensurePolling();
  }

  /** Deregister on release / lease loss — aborts any in-flight blocked read. */
  deregisterMatch(matchId: string): void {
    const reg = this.registered.get(matchId);
    if (reg) {
      reg.abort.abort();
      this.registered.delete(matchId);
    }
    if (this.registered.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      for (const [matchId, reg] of this.registered) {
        if (this.inFlight.has(matchId)) continue;
        this.inFlight.add(matchId);
        void this.pollOnce(matchId, reg.server, reg.abort.signal).finally(() =>
          this.inFlight.delete(matchId),
        );
      }
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  /**
   * One poll iteration for a match: FIRST XAUTOCLAIM idle pending entries left
   * by a dead owner's consumer (takeover — plain XREADGROUP ... > would miss
   * them), then read new entries. Both are processed in stream order.
   */
  async pollOnce(
    matchId: string,
    server: Server,
    signal?: AbortSignal,
  ): Promise<void> {
    const stream = this.streamKey(matchId);
    try {
      // Takeover: reassign idle pending entries from failed consumers to us.
      let cursor = "0-0";
      do {
        if (signal?.aborted) return;
        const { nextCursor, claimed } = await this.redis.xautoclaim(
          stream,
          OWNER_GROUP,
          this.consumer,
          CLAIM_MIN_IDLE_MS,
          cursor,
          BATCH,
        );
        for (const entry of claimed) {
          if (signal?.aborted) return;
          await this.processEntry(matchId, entry, server);
        }
        cursor = nextCursor;
      } while (cursor !== "0-0");

      if (signal?.aborted) return;
      const entries = await this.redis.xreadgroup(
        OWNER_GROUP,
        this.consumer,
        stream,
        BATCH,
        BLOCK_MS,
        signal,
      );
      for (const entry of entries) {
        if (signal?.aborted) return;
        await this.processEntry(matchId, entry, server);
      }
    } catch (err) {
      this.logger.warn(
        `pollOnce failed for ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Validate → apply → ack. An entry that fails validation is dead-lettered
   * (and only then XACK'd + XDEL'd); a valid entry is applied and XACK'd on any
   * non-RETRY outcome. A RETRY (lease lost mid-apply, or no dispatcher yet) is
   * left in the PEL for the next owner to reprocess — never acked.
   */
  async processEntry(
    matchId: string,
    entry: StreamEntry,
    server: Server,
  ): Promise<void> {
    const stream = this.streamKey(matchId);
    const env = this.parseAndValidate(entry.data, matchId);
    if (!env) {
      const persisted = await this.deadLetterEntry(matchId, entry);
      if (persisted) {
        await this.redis.xack(stream, OWNER_GROUP, entry.id);
        await this.redis.xdel(stream, entry.id);
      }
      // else: leave in the PEL for retry — never ack an unpersisted bad entry.
      return;
    }
    const outcome = await this.apply(env, server);
    if (outcome !== "RETRY") {
      await this.redis.xack(stream, OWNER_GROUP, entry.id);
    }
  }

  /**
   * NARROW BOUNDARY: accepts ONLY a submit_answer envelope. The compiler
   * rejects a player_disconnect envelope here at compile time, so a disconnect
   * can never reach the submit-answer apply. Forwarded disconnects go through
   * the private `apply` from the consumer's dispatch.
   */
  async applySubmitAnswer(
    env: CommandEnvelope<SubmitAnswerBody>,
    server: Server,
  ): Promise<CommandOutcome> {
    return this.apply(env, server);
  }

  /**
   * Authoritative apply. Re-checks the CURRENT ownership snapshot and aborts
   * without ack (RETRY) when the lease is lost, so a stale owner never applies.
   * The typed outcome (APPLIED / DUPLICATE_EVENT / DUPLICATE_SUBMISSION / RETRY)
   * comes from the dispatcher's fenced CAS.
   */
  private async apply(
    env: CommandEnvelope,
    server: Server,
  ): Promise<CommandOutcome> {
    const owner = this.ownership.currentFence(env.matchId);
    if (owner == null) return "RETRY"; // lease lost → do NOT ack
    // Test hook (B4a): an explicitly injected dispatcher wins.
    if (this.dispatcher) return this.dispatcher(env, owner, server);
    return this.dispatchBuiltin(env, owner, server);
  }

  /** Route a validated envelope to its authoritative handler by body type. */
  private async dispatchBuiltin(
    env: CommandEnvelope,
    owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome> {
    if (env.body.type === "submit_answer") {
      if (!this.sideEffects) return "RETRY"; // side effects not wired yet
      return this.applyAnswerAuthoritative(
        env as CommandEnvelope<SubmitAnswerBody>,
        owner,
        server,
      );
    }
    // player_disconnect → B5 (optional until wired).
    if (this.sideEffects?.handlePlayerDisconnect) {
      return this.sideEffects.handlePlayerDisconnect(env, owner, server);
    }
    return "RETRY";
  }

  /**
   * The authoritative single-writer answer apply (B4b). Reached by BOTH the
   * owner-local forwarded command and any node's forwarded command through the
   * one consumer path, so there is one ordering + ack path. The per-match
   * consumer serialises entries, and only the current owner (currentFence != null
   * + fenced persist) mutates match:state — so two answers on two nodes can
   * never both blind-write. Outcome contract drives XACK vs retry:
   *   - APPLIED               — persisted; canonical ANSWER_RESULT emitted.
   *   - DUPLICATE_EVENT       — same eventId already applied; heal (re-emit) + ack.
   *   - DUPLICATE_SUBMISSION  — same submissionId replay; ackable no-op, no side effects.
   *   - RETRY                 — lease lost / stale fence / persist failed; NOT acked.
   */
  async applyAnswerAuthoritative(
    env: CommandEnvelope<SubmitAnswerBody>,
    owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome> {
    const applied = appliedSetKey(env.matchId);

    // eventId dedup (transport-level). Owner-single + consumer-serial makes a
    // plain check/record race-free; a redelivery of an already-applied event
    // heals (re-emits) rather than double-applying.
    let alreadyApplied: boolean;
    try {
      alreadyApplied = await this.redis.sismember(applied, env.eventId);
    } catch (err) {
      this.logger.warn(
        `applyAnswerAuthoritative: dedup read failed for ${env.matchId} (RETRY): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return "RETRY"; // cannot verify dedup → do NOT ack
    }
    if (alreadyApplied) return this.recoverDuplicateEvent(env, server);

    const sm = await this.matchService.getStateMachine(env.matchId);
    if (!sm) return "RETRY"; // not hydrated (cold) → next owner reprocesses

    const round = sm.getCurrentRound();
    const existing = round?.answers.get(env.body.userId);
    const isReplay =
      existing !== undefined &&
      existing.submissionId !== undefined &&
      existing.submissionId === env.body.submissionId;

    // Server-authoritative timing: serverTs is minted here; clientTs is advisory.
    const serverTs = Date.now();
    let result;
    try {
      result = sm.submitAnswer(
        env.body.userId,
        env.body.answer,
        serverTs,
        env.body.submissionId,
      );
    } catch (err) {
      // ROUND_NOT_ACTIVE etc. — a stale/late command that can never apply. Ack
      // it (a RETRY would loop forever); no side effects.
      this.logger.warn(
        `applyAnswerAuthoritative: submitAnswer rejected for ${env.matchId}/${env.body.userId} (acking as no-op): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return "DUPLICATE_SUBMISSION";
    }

    if (isReplay) return "DUPLICATE_SUBMISSION"; // idempotent replay; no side effects

    // Fenced canonical persist (B2c). A non-APPLIED outcome means the lease was
    // lost / fence bumped mid-apply — discard the unpersisted in-memory mutation
    // (snapshot-restore safety) and do NOT broadcast.
    const persisted = await this.matchService.persistStateMachine(env.matchId);
    if (persisted !== "APPLIED") {
      this.matchService.evictStateMachine(env.matchId);
      return "RETRY";
    }

    // Record the eventId only AFTER a successful persist, so a RETRY never
    // marks an unapplied command as applied.
    try {
      await this.redis.sadd(applied, env.eventId);
    } catch {
      // Non-fatal: a redelivery would re-apply idempotently via submissionId.
    }

    const roomId = sm.getState().roomId;
    const roundNo = round?.roundNo ?? sm.getState().currentRoundNo;
    this.sideEffects?.publishAnswerResult(env, roomId, result, roundNo, server);
    await this.sideEffects?.checkEarlyTermination(env.matchId, roomId, server);
    return "APPLIED";
  }

  /**
   * DUPLICATE_EVENT recovery: the first owner persisted the answer but may have
   * crashed before broadcasting. Reload canonical state, re-emit the canonical
   * ANSWER_RESULT idempotently, and re-run early termination before the caller
   * XACKs — so the submitter still receives the outcome.
   */
  private async recoverDuplicateEvent(
    env: CommandEnvelope<SubmitAnswerBody>,
    server: Server,
  ): Promise<CommandOutcome> {
    if (this.ownership.currentFence(env.matchId) == null) return "RETRY";
    const sm = await this.matchService.getStateMachine(env.matchId);
    if (!sm || !this.sideEffects) return "DUPLICATE_EVENT";
    const round = sm.getCurrentRound();
    const answer = round?.answers.get(env.body.userId);
    if (answer) {
      const roomId = sm.getState().roomId;
      this.sideEffects.publishAnswerResult(
        env,
        roomId,
        answer,
        round?.roundNo ?? sm.getState().currentRoundNo,
        server,
      );
      await this.sideEffects.checkEarlyTermination(env.matchId, roomId, server);
    }
    return "DUPLICATE_EVENT";
  }

  /**
   * Runtime schema validation. Returns the typed envelope, or null when the
   * payload is unparseable / wrong schema / mismatched matchId / bad body — the
   * caller dead-letters a null.
   */
  parseAndValidate(
    data: string,
    streamMatchId: string,
  ): CommandEnvelope | null {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const e = raw as Record<string, unknown>;
    if (e.schemaVersion !== 1) return null;
    if (typeof e.eventId !== "string" || e.eventId.length === 0) return null;
    if (e.matchId !== streamMatchId) return null; // cross-stream mismatch
    if (typeof e.emittedByNodeId !== "string") return null;
    if (typeof e.emittedAt !== "number" || !Number.isFinite(e.emittedAt))
      return null;
    if (typeof e.body !== "object" || e.body === null) return null;
    const body = e.body as Record<string, unknown>;
    if (body.type === "submit_answer") {
      if (
        typeof body.userId !== "string" ||
        typeof body.answer !== "string" ||
        typeof body.submissionId !== "string" ||
        typeof body.clientTs !== "number" ||
        !Number.isFinite(body.clientTs)
      ) {
        return null;
      }
    } else if (body.type === "player_disconnect") {
      if (typeof body.userId !== "string") return null;
    } else {
      return null;
    }
    return raw as CommandEnvelope;
  }

  /**
   * Persist an invalid command entry to the command dead-letter store before it
   * is acked/deleted, so a malformed entry is never silently dropped. Returns
   * true only when the persistence succeeded (the caller acks/dels only then).
   */
  private async deadLetterEntry(
    matchId: string,
    entry: StreamEntry,
  ): Promise<boolean> {
    try {
      await this.redis.sadd(CMD_DEAD_LETTER_SET, matchId);
      await this.redis.set(
        `${CMD_DEAD_LETTER_PREFIX}${matchId}:${entry.id}`,
        entry.data,
        CMD_DEAD_LETTER_TTL_SEC,
      );
      this.logger.warn(
        `dead-lettered invalid command entry ${entry.id} on match:cmd:${matchId}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `deadLetterEntry: failed to persist ${entry.id} for ${matchId} (left in PEL): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /** Delete the stream + the applied-eventId dedup set on match finish. */
  async disposeStream(matchId: string): Promise<void> {
    try {
      await this.redis.xdelStream(this.streamKey(matchId));
      await this.redis.del(appliedSetKey(matchId));
    } catch (err) {
      this.logger.warn(
        `disposeStream failed for ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/** Ops-facing set of matches with a dead-lettered command entry. */
export const CMD_DEAD_LETTER_SET = "match:cmd:dead-letter";
const CMD_DEAD_LETTER_PREFIX = "match:cmd:dead-letter:";
const CMD_DEAD_LETTER_TTL_SEC = 604_800; // 7d, matches other dead-letter retention
