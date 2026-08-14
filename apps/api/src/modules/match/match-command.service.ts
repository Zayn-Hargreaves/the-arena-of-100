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
import {
  type CommandEnvelope,
  commandEnvelopeSchema,
  type OwnerCommandBody,
  type SubmitAnswerBody,
  type CardPickBody,
  type CardPlayBody,
  type VoteBanTopicBody,
} from "./dto/match-command.dto";
import {
  applyAnswerCommand,
  applyDisconnectCommand,
  type AuthoritativeCommandContext,
} from "./match-command-authoritative";
import {
  applyCardPickCommand,
  applyCardPlayCommand,
} from "./match-card-command-authoritative";
import { appliedSetKey } from "./match-command.keys";
import { MatchStatus } from "@arena/shared";
import { MatchStateMachine, tallyTopicVotes } from "@arena/game-core";
import { emitTopicVotingSummary } from "./game-loop.events";

export {
  type CommandEnvelope,
  commandEnvelopeSchema,
  type OwnerCommandBody,
  type PlayerDisconnectBody,
  type SubmitAnswerBody,
  type CardPickBody,
  type CardPlayBody,
  type VoteBanTopicBody,
} from "./dto/match-command.dto";

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

export { appliedSetKey } from "./match-command.keys";

export const OWNER_GROUP = "owners";
/** Min-idle before a pending entry is eligible for takeover (XAUTOCLAIM). */
export const CLAIM_MIN_IDLE_MS = 30_000;
const BLOCK_MS = 1_000;
/**
 * Entries drained per XREADGROUP. Must be >= the per-room player cap: at
 * ROUND_STARTED every surviving player answers within the same few ms, so a
 * whole round's commands land in the stream as one burst. A batch smaller
 * than the roster splits that burst across consecutive reads, and the last
 * player's ANSWER_RESULT is delayed by every read in between.
 */
const BATCH = 128;
/**
 * Cap on entries drained per XAUTOCLAIM sweep inside one `pollOnce`. Once
 * the cap is hit, the remaining cursor is left for the next poll so the
 * read loop can pick up new entries instead of starving `xreadgroup`.
 */
const MAX_SWEEP_ENTRIES = BATCH * 4;
/**
 * Safety-net cadence only. The read loop re-arms itself as soon as an
 * iteration completes (see schedulePoll), so this timer exists to restart a
 * loop that bailed out early — it is NOT what drives steady-state reads.
 */
const POLL_INTERVAL_MS = 250;
/**
 * XAUTOCLAIM is the failover takeover path: it only matters once a dead
 * owner's entries have gone CLAIM_MIN_IDLE_MS (30s) untouched. Running it
 * before every read added a Redis round trip to the answer hot path for no
 * benefit, so it gets its own much slower cadence.
 */
const CLAIM_INTERVAL_MS = 5_000;
/**
 * An iteration that returns faster than this consumed no blocking window —
 * the reader pool was saturated, the signal aborted, or Redis errored.
 * Re-arming on such an iteration would spin the event loop, so those fall
 * back to the safety-net tick instead.
 */
const MIN_BLOCKING_ITERATION_MS = BLOCK_MS / 2;

interface Registration {
  server: Server;
  abort: AbortController;
  /** Epoch ms of the last XAUTOCLAIM sweep; 0 = never swept. */
  lastClaimAt: number;
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
    this.registered.set(matchId, {
      server,
      abort: new AbortController(),
      lastClaimAt: 0,
    });
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
    if (this.pollTimer) {
      this.dispatchPolls();
      return;
    }
    this.pollTimer = setInterval(() => this.dispatchPolls(), POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
    // Start reading now instead of waiting out the first tick. setInterval
    // does not fire at t=0, so deferring here charged the very first round of
    // every match a full POLL_INTERVAL_MS before its answers were even read.
    this.dispatchPolls();
  }

  private dispatchPolls(): void {
    for (const [matchId, reg] of this.registered) {
      this.schedulePoll(matchId, reg);
    }
  }

  /**
   * Run one read iteration for a match and, on completion, immediately start
   * the next one. XREADGROUP already blocks (BLOCK_MS), so this is a
   * continuously-listening consumer rather than a busy loop — and, unlike a
   * fixed-interval poll, it leaves no window in which nothing is attached to
   * the stream. That window was the bulk of observed answer latency: commands
   * sat in the stream waiting for a timer rather than for Redis or CPU.
   *
   * The reader is acquired and released inside each xreadgroup call, so a node
   * owning more matches than BLOCKING_READER_POOL_MAX still round-robins
   * through the pool instead of starving the matches that lost the race.
   */
  private schedulePoll(matchId: string, reg: Registration): void {
    if (this.inFlight.has(matchId)) return;
    if (reg.abort.signal.aborted) return;
    if (this.registered.get(matchId) !== reg) return;

    this.inFlight.add(matchId);
    const startedAt = Date.now();
    void this.pollOnce(matchId, reg.server, reg.abort.signal)
      .then(
        (processed) =>
          processed > 0 || Date.now() - startedAt >= MIN_BLOCKING_ITERATION_MS,
        () => false,
      )
      .then((rearm) => {
        this.inFlight.delete(matchId);
        if (!rearm) return;
        const current = this.registered.get(matchId);
        if (current) this.schedulePoll(matchId, current);
      });
  }

  /**
   * One read iteration for a match. XAUTOCLAIM (takeover of idle pending
   * entries left by a dead owner's consumer — plain XREADGROUP ... > would
   * miss them) runs at most every CLAIM_INTERVAL_MS; new entries are read on
   * every iteration. Both are processed in stream order.
   *
   * Returns the number of entries processed, which schedulePoll uses to tell
   * "did real work, come straight back" from "returned without ever blocking".
   */
  async pollOnce(
    matchId: string,
    server: Server,
    signal?: AbortSignal,
  ): Promise<number> {
    const stream = this.streamKey(matchId);
    let processed = 0;
    try {
      processed += await this.claimIdleEntries(matchId, stream, server, signal);
      if (signal?.aborted) return processed;

      const entries = await this.redis.xreadgroup(
        OWNER_GROUP,
        this.consumer,
        stream,
        BATCH,
        BLOCK_MS,
        signal,
      );
      for (const entry of entries) {
        if (signal?.aborted) return processed;
        await this.processEntry(matchId, entry, server);
        processed++;
      }
    } catch (err) {
      this.logger.warn(
        `pollOnce failed for ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return processed;
  }

  private async claimIdleEntries(
    matchId: string,
    stream: string,
    server: Server,
    signal?: AbortSignal,
  ): Promise<number> {
    const reg = this.registered.get(matchId);
    if (!reg) {
      return 0;
    }
    const now = Date.now();
    if (now - reg.lastClaimAt < CLAIM_INTERVAL_MS) {
      return 0;
    }
    let processed = 0;
    let cursor = "0-0";
    let drained = false;
    do {
      if (signal?.aborted) return processed;
      const { nextCursor, claimed } = await this.redis.xautoclaim(
        stream,
        OWNER_GROUP,
        this.consumer,
        CLAIM_MIN_IDLE_MS,
        cursor,
        BATCH,
      );
      for (const entry of claimed) {
        if (signal?.aborted) return processed;
        if (processed >= MAX_SWEEP_ENTRIES) {
          cursor = nextCursor;
          break;
        }
        await this.processEntry(matchId, entry, server);
        processed++;
      }
      cursor = nextCursor;
      if (cursor === "0-0") drained = true;
    } while (cursor !== "0-0" && processed < MAX_SWEEP_ENTRIES);

    if (drained && !reg.abort.signal.aborted && !signal?.aborted) {
      reg.lastClaimAt = Date.now();
    }
    return processed;
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
    // card_pick / card_play → owner-only authoritative apply (sub-task D).
    // Both run inside the same owner-serialised consumer path as
    // submit_answer, so two blind writes on two nodes can never both
    // commit a CARD_PICKED / CARD_RESOLVED event. The apply methods
    // do their own persistence + broadcast; no `sideEffects` hook is
    // needed because the owner is already the single writer.
    if (env.body.type === "card_pick") {
      return this.applyCardPickAuthoritative(
        env as CommandEnvelope<CardPickBody>,
        owner,
        server,
      );
    }
    if (env.body.type === "card_play") {
      return this.applyCardPlayAuthoritative(
        env as CommandEnvelope<CardPlayBody>,
        owner,
        server,
      );
    }
    if (env.body.type === "vote_ban_topic") {
      return this.applyVoteBanTopicAuthoritative(
        env as CommandEnvelope<VoteBanTopicBody>,
        owner,
        server,
      );
    }
    // player_disconnect → B5 (optional until wired). eventId dedup mirrors
    // submit_answer so a redelivery / XAUTOCLAIM of an already-applied
    // disconnect is acked without re-broadcasting PLAYER_LEFT.
    if (this.sideEffects?.handlePlayerDisconnect) {
      return this.applyDisconnectAuthoritative(env, owner, server);
    }
    return "RETRY";
  }

  /**
   * B5 authoritative disconnect apply. eventId-deduped so a redelivery of an
   * already-applied disconnect is an ackable no-op (no second PLAYER_LEFT).
   * Unlike submit_answer there is no heal step — the first owner already
   * broadcast, and a second emit would be a false leave.
   */
  private async applyDisconnectAuthoritative(
    env: CommandEnvelope,
    owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome> {
    return applyDisconnectCommand(
      this.authoritativeContext(),
      env,
      owner,
      server,
    );
  }

  /**
   * The authoritative single-writer answer apply (B4b). Reached by BOTH the
   * owner-local forwarded command and any node's forwarded command through the
   * one consumer path, so there is one ordering + ack path. The per-match
   * consumer serialises entries, and only the current owner (currentFence != null
   * + fenced persist) mutates match:state — so two answers on two nodes can
   * never both blind-write. Outcome contract drives XACK vs retry:
   *   - APPLIED               — persisted; canonical ANSWER_RESULT emitted.
   *   - DUPLICATE_EVENT       — same eventId already applied, or same submissionId
   *                            already in SM (incomplete prior attempt); heal + ack.
   *   - DUPLICATE_SUBMISSION  — late/stale command that can never apply; ack no-op.
   *   - RETRY                 — lease lost / stale fence / persist failed; NOT acked.
   */
  async applyAnswerAuthoritative(
    env: CommandEnvelope<SubmitAnswerBody>,
    _owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome> {
    return applyAnswerCommand(this.authoritativeContext(), env, server);
  }

  /**
   * Build and return an `AuthoritativeCommandContext` snapshot from the
   * service's existing dependencies. Performs no validation, no fence checks,
   * and no duplicate-recovery logic — those live in the individual `apply…`
   * methods (see `recoverDuplicateAnswer` for the DUPLICATE_EVENT path and
   * the fence-revalidation rules used before each side effect).
   */
  private authoritativeContext(): AuthoritativeCommandContext {
    return {
      redis: this.redis,
      matchService: this.matchService,
      ownership: this.ownership,
      sideEffects: this.sideEffects,
      logger: this.logger,
    };
  }

  /**
   * Owner-side authoritative apply for `card_pick` envelopes. Symmetric with
   * `applyAnswerAuthoritative`: eventId dedup → state machine mutate →
   * fenced persist → broadcast → mark applied. State-machine validation
   * failures (CARD_NOT_IN_HAND, etc.) and stale-active checks are acked as
   * `DUPLICATE_SUBMISSION` so the stream entry never loops.
   */
  private async applyCardPickAuthoritative(
    env: CommandEnvelope<CardPickBody>,
    _owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome> {
    return applyCardPickCommand(this.authoritativeContext(), env, server);
  }

  /**
   * Owner-side authoritative apply for `card_play` envelopes. The full
   * authoritative path runs here in ONE serialised consumer step: read
   * current round / AOE count → validate card command → resolve effect
   * → expand targets → state machine playCard → fenced persist →
   * broadcast sanitized to room + full to each target → mark applied.
   *
   * Returning `DUPLICATE_SUBMISSION` on validation / state-machine
   * rejection mirrors `applyAnswerAuthoritative`: stale / late / illegal
   * commands ack no-op so the stream entry never loops. Fenced-persist
   * failure returns `RETRY` so the next owner reprocesses.
   */
  private async applyCardPlayAuthoritative(
    env: CommandEnvelope<CardPlayBody>,
    _owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome> {
    return applyCardPlayCommand(this.authoritativeContext(), env, server);
  }

  /**
   * Owner-side authoritative apply for `vote_ban_topic` envelopes.
   * eventId dedup → state machine mutate → fenced persist → emit summary → mark applied.
   */
  async applyVoteBanTopicAuthoritative(
    env: CommandEnvelope<VoteBanTopicBody>,
    _owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome> {
    const applied = appliedSetKey(env.matchId);
    let alreadyApplied: boolean;
    try {
      alreadyApplied = await this.redis.sismember(applied, env.eventId);
    } catch (error) {
      this.logger.warn(
        `applyVoteBanTopicAuthoritative: dedup read failed for ${env.matchId} (RETRY): ${error instanceof Error ? error.message : String(error)}`,
      );
      return "RETRY";
    }
    if (alreadyApplied) {
      return this.recoverDuplicateVoteBanTopic(env, server);
    }

    const stateMachine = await this.matchService.getStateMachine(env.matchId);
    if (!stateMachine) return "RETRY";

    const state = stateMachine.getState();
    if (
      state.status !== MatchStatus.TOPIC_VOTING ||
      (typeof state.phaseEndsAt === "number" && state.phaseEndsAt <= Date.now())
    ) {
      this.logger.warn(
        `applyVoteBanTopicAuthoritative: voteBanTopic rejected for ${env.matchId}/${env.body.userId} (TOPIC_VOTING_CLOSED)`,
      );
      return "DUPLICATE_SUBMISSION";
    }

    let existingVoteEvent: unknown = null;
    stateMachine.forEachEvent((entry) => {
      if (entry.type === "TOPIC_VOTE_SUBMITTED") {
        const payload = (entry.payload ?? {}) as Record<string, unknown>;
        if (payload.eventId === env.eventId) {
          existingVoteEvent = entry;
          return false;
        }
      }
      return true;
    }, "reverse");

    if (existingVoteEvent) {
      return this.recoverDuplicateVoteBanTopic(env, server);
    }

    const serialized = stateMachine.serialize();

    try {
      stateMachine.voteBanTopic(env.body.userId, env.body.topic, {
        eventId: env.eventId,
      });
    } catch (error) {
      this.logger.warn(
        `applyVoteBanTopicAuthoritative: voteBanTopic rejected for ${env.matchId}/${env.body.userId} (acking as no-op): ${error instanceof Error ? error.message : String(error)}`,
      );
      return "DUPLICATE_SUBMISSION";
    }

    const persistOutcome = await this.matchService.persistStateMachine(
      env.matchId,
    );
    if (persistOutcome !== "APPLIED") {
      this.matchService.evictStateMachine(env.matchId);
      const canonical = MatchStateMachine.deserialize(serialized);
      Object.assign(stateMachine, canonical);
      this.logger.warn(
        `applyVoteBanTopicAuthoritative: persistStateMachine returned ${persistOutcome} for ${env.matchId} (RETRY)`,
      );
      return "RETRY";
    }

    const updatedState = stateMachine.getState();
    const candidateTopics = updatedState.candidateTopics ?? [];
    const votes = updatedState.topicVotes ?? {};
    const voteCounts = tallyTopicVotes(votes, candidateTopics);
    const totalVotes = Object.keys(votes).length;

    const roomId = await this.matchService.getRoomIdByMatchId(env.matchId);
    if (roomId) {
      emitTopicVotingSummary(
        server,
        roomId,
        env.matchId,
        voteCounts,
        totalVotes,
      );
    }

    try {
      await this.redis.sadd(applied, env.eventId);
    } catch (error) {
      this.logger.warn(
        `applyVoteBanTopicAuthoritative: sadd applied failed for ${env.matchId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return "APPLIED";
  }

  private async recoverDuplicateVoteBanTopic(
    env: CommandEnvelope<VoteBanTopicBody>,
    server: Server,
  ): Promise<CommandOutcome> {
    const stateMachine = await this.matchService.getStateMachine(env.matchId);
    if (!stateMachine) return "DUPLICATE_EVENT";

    let canonicalEvent: unknown = null;
    stateMachine.forEachEvent((entry) => {
      if (entry.type === "TOPIC_VOTE_SUBMITTED") {
        const payload = (entry.payload ?? {}) as Record<string, unknown>;
        if (
          payload.eventId === env.eventId ||
          payload.playerId === env.body.userId
        ) {
          canonicalEvent = entry;
          return false;
        }
      }
      return true;
    }, "reverse");

    if (!canonicalEvent) {
      return "DUPLICATE_EVENT";
    }

    const state = stateMachine.getState();
    const candidateTopics = state.candidateTopics ?? [];
    const votes = state.topicVotes ?? {};
    const voteCounts = tallyTopicVotes(votes, candidateTopics);
    const totalVotes = Object.keys(votes).length;

    const roomId = await this.matchService.getRoomIdByMatchId(env.matchId);
    if (roomId) {
      emitTopicVotingSummary(
        server,
        roomId,
        env.matchId,
        voteCounts,
        totalVotes,
      );
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
    try {
      const raw: unknown = JSON.parse(data);
      const parsed = commandEnvelopeSchema.safeParse(raw);
      if (!parsed.success || parsed.data.matchId !== streamMatchId) {
        return null;
      }
      return parsed.data as CommandEnvelope;
    } catch {
      return null;
    }
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
