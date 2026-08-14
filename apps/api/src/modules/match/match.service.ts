// ============================================================
// Match Service - Match Management Logic
// ============================================================

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MatchOwnershipService } from "./match-ownership.service";
import { ownerKey, fenceKey } from "./match-ownership.store";
import { MatchStateMachine } from "@arena/game-core";
import {
  MatchStatus,
  MatchEventType,
  RoomStatus,
  PlayerStatus,
  ErrorCode,
  type CardEffectEvent,
  type ClassAssignedEvent,
  type PlayerInfo,
  RoomError,
} from "@arena/shared";

/** Bootstrap revision for the fenced match:state CAS (B2c). */
const INITIAL_STATE_REVISION = 0;
const STATE_TTL_SEC = 86400; // 24h
const stateKey = (matchId: string): string => `match:state:${matchId}`;
const revisionKey = (matchId: string): string =>
  `match:state-revision:${matchId}`;

/** Outcome of a canonical persist. BLIND = non-owned/legacy path (unfenced,
 *  pre-B4 behavior); RETRY = fenced CAS rejected (lost ownership). */
export type PersistOutcome = "APPLIED" | "RETRY" | "BLIND";

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);
  private readonly stateMachines = new Map<string, MatchStateMachine>();
  // Per-match state revision this node has applied (B2c fenced CAS), BOUND to
  // the ownership fence it was written under. A cached revision is only valid
  // for its own ownership epoch: after a takeover / handoff the fence advances
  // and the persisted revision may have moved past our cached value, so a
  // revision from a stale fence must be discarded (reloaded from Redis) rather
  // than fed into the CAS — otherwise every persist RETRYs forever.
  private readonly revisions = new Map<
    string,
    { fence: number; revision: number }
  >();
  // Per-match serialization for the fenced persist path. Concurrent persists
  // for the same match (e.g. a disconnect handler racing a round timer) would
  // otherwise both read the same expected revision and the loser's CAS would
  // spuriously RETRY, dropping a legitimate owner's canonical write.
  private readonly persistChains = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly matchOwnership: MatchOwnershipService,
  ) {}

  // Create match from room
  async createMatch(roomId: string) {
    // Get room with players
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        players: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (!room) {
      throw new NotFoundException(ErrorCode.ROOM_NOT_FOUND);
    }

    if (room.players.length < 2) {
      throw new RoomError(ErrorCode.NOT_ENOUGH_PLAYERS);
    }

    // Create match in DB
    const match = await this.prisma.match.create({
      data: {
        roomId: room.id,
        status: MatchStatus.CREATED,
      },
    });

    // Create player records
    const playerInfos: PlayerInfo[] = room.players.map((p) => ({
      id: p.user.id,
      name: p.user.username,
      status: PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    }));

    // Create match players
    await this.prisma.matchPlayer.createMany({
      data: room.players.map((p) => ({
        matchId: match.id,
        userId: p.user.id,
      })),
    });

    // Initialize state machine
    const stateMachine = new MatchStateMachine(match.id, roomId, playerInfos);
    this.stateMachines.set(match.id, stateMachine);

    // Update room status
    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        status: RoomStatus.STARTING,
        currentMatchId: match.id,
      },
    });

    // Persist state machine to Redis for crash recovery. This is the explicit
    // bootstrap write: it runs BEFORE ownership is acquired (no owner/fence/
    // revision exists yet), so it is the one path permitted to blind-write
    // canonical match:state.
    try {
      await this.persistStateMachine(match.id, { allowBlindBootstrap: true });
    } catch (error) {
      this.logger.error(
        `Failed to persist state machine to Redis for match ${match.id} — state exists in-memory only`,
        error,
      );
    }

    this.logger.log(`Match created: ${match.id} for room ${roomId}`);
    return match;
  }

  // Lightweight match→room lookup for auth gates that must not load
  // the full state machine (Redis deserialize + answer rehydrate).
  // Cache-first: stateMachines stores the roomId alongside the match,
  // so a hot match avoids a DB round-trip. Falls back to Prisma only
  // on cache miss (e.g. recovery from Redis before this entry exists).
  async getRoomIdByMatchId(matchId: string): Promise<string | undefined> {
    const cached = this.stateMachines.get(matchId);
    if (cached) return cached.getState().roomId;
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { roomId: true },
    });
    return match?.roomId;
  }

  /**
   * B4b snapshot-restore safety: drop the cached in-memory state machine so the
   * next `getStateMachine` reloads the canonical `match:state` from Redis. The
   * authoritative answer apply calls this after a fenced-persist RETRY (lease
   * lost / stale fence) so an unpersisted in-memory mutation can never be
   * observed by a later apply, resume, or presence sweep.
   */
  evictStateMachine(matchId: string): void {
    this.stateMachines.delete(matchId);
  }

  // Get state machine for match (restores from Redis if not in memory)
  async getStateMachine(
    matchId: string,
  ): Promise<MatchStateMachine | undefined> {
    const cached = this.stateMachines.get(matchId);
    if (cached) return cached;

    // Try restore from Redis
    const json = await this.redis.get(`match:state:${matchId}`);
    if (!json) return undefined;

    let restored: MatchStateMachine;
    try {
      restored = MatchStateMachine.deserialize(json);
      this.logger.log(`Match state restored from Redis: ${matchId}`);
    } catch (error) {
      this.logger.error(
        `Failed to deserialize match state for ${matchId}`,
        error,
      );
      // Optionally remove corrupted key
      await this.redis.del(`match:state:${matchId}`);
      return undefined;
    }

    // L3 fix: re-attach the correct answer from the DB. The
    // serialized state in Redis no longer contains correctAnswer
    // (it was a leak vector), so any in-flight round would fail
    // to grade without this lookup. The questionId is on the
    // restored state; we read the Question row to get the answer
    // key. The Question table has stricter access than the Redis
    // cache and is the natural single source of truth.
    await this.rehydrateCorrectAnswer(restored);

    this.stateMachines.set(matchId, restored);
    return restored;
  }

  // Look up the correct answer for the in-flight round's question
  // and attach it to the state machine. No-op if there is no
  // in-flight round or the round is already past ACTIVE.
  private async rehydrateCorrectAnswer(sm: MatchStateMachine): Promise<void> {
    const round = sm.getCurrentRound();
    if (!round) return;
    if (round.status !== "ACTIVE") return;
    const questionId = round.question?.id;
    if (!questionId) return;

    // This runs inside getStateMachine, which is on nearly every hot
    // path (submit answer, snapshot, disconnect, reconnect, every
    // timer callback). A throw here would propagate up and make a
    // recovered match with a missing/renamed Question PERMANENTLY
    // unrecoverable — every subsequent getStateMachine would throw.
    // So we log and degrade gracefully instead of throwing: the
    // round proceeds without an attached answer. evaluateRound will
    // then grade everyone as wrong for this round (no correctAnswer
    // to match), which is the same outcome as a round nobody got
    // right — the match still completes. Operators see an error-level
    // log to investigate the missing Question.
    try {
      const question = await this.prisma.question.findUnique({
        where: { id: questionId },
        select: { correctAnswer: true },
      });
      if (!question) {
        this.logger.error(
          `rehydrateCorrectAnswer: Question ${questionId} not found in DB; round ${round.roundNo} will be graded without a correct answer (all players eliminated this round). Match remains recoverable.`,
        );
        return;
      }
      sm.attachCorrectAnswer(question.correctAnswer);
      this.logger.log(
        `rehydrateCorrectAnswer: attached correct answer for question ${questionId} to round ${round.roundNo}`,
      );
    } catch (error) {
      // DB blip (connection error, timeout). Log and degrade rather
      // than throwing — see rationale above. The match stays
      // recoverable; a later getStateMachine call may succeed.
      this.logger.error(
        `rehydrateCorrectAnswer: DB lookup failed for question ${questionId}; round ${round.roundNo} will proceed without a re-attached answer. Match remains recoverable.`,
        error,
      );
    }
  }

  // Persist current state machine to Redis
  // H5 fix: 24-hour TTL (was 2h). The previous 2h TTL was too short
  // for long matches with extended pauses. The match state machine
  // is the only authoritative in-memory representation of an
  // in-flight match; losing it to a Redis expiry leaves a match
  // with a DB row but no runtime state. 24h is a generous upper
  // bound — no legitimate match should run that long. The state
  // machine is also deleted explicitly in finishMatch, so the TTL
  // is only the safety net for the crash-recovery case.
  async persistStateMachine(
    matchId: string,
    opts: { allowBlindBootstrap?: boolean } = {},
  ): Promise<PersistOutcome> {
    // Serialize persists for the SAME match so a concurrent pair cannot both
    // read the same expected revision and CAS with the same nextRevision — the
    // loser would RETRY and its canonical write would be silently dropped even
    // though this node is the legitimate owner. Each persist runs after the
    // previous one, observing its advanced revision.
    return this.runPersistExclusive(matchId, () =>
      this.persistStateMachineInner(matchId, opts),
    );
  }

  private async persistStateMachineInner(
    matchId: string,
    opts: { allowBlindBootstrap?: boolean },
  ): Promise<PersistOutcome> {
    const machine = this.stateMachines.get(matchId);
    if (!machine) return "BLIND";
    const blob = machine.serialize();

    // B2c: when this node owns the match, route the canonical write through the
    // fenced Lua CAS so a stale/resurrected owner (lease expired or fence
    // bumped by a takeover) cannot clobber match:state.
    const snapshot = this.matchOwnership.getOwnershipSnapshot(matchId);
    if (!snapshot) {
      // A node that does NOT own the match must not blind-write canonical
      // match:state — an unfenced write would clobber the owner's fenced CAS
      // writes and defeat the single-writer invariant. The only permitted blind
      // write is the explicit bootstrap at match creation, before any owner /
      // fence / revision exists. Every other no-snapshot path returns RETRY
      // (broadcast must be skipped) rather than clobber.
      if (opts.allowBlindBootstrap) {
        await this.redis.set(stateKey(matchId), blob, STATE_TTL_SEC);
        return "BLIND";
      }
      this.logger.warn(
        `persistStateMachine: no ownership snapshot for ${matchId} and not a bootstrap write; refusing blind canonical write (RETRY, broadcast must be skipped)`,
      );
      return "RETRY";
    }

    // B2c fenced path. The cached revision is valid ONLY when it was written
    // under the SAME ownership fence we now hold. On a fence mismatch (takeover
    // / ownership handoff — the local cache is empty or belongs to a prior
    // epoch) reload the canonical revision from Redis; the persisted revision
    // may be well past INITIAL, and a stale/default 0 would make the fenced CAS
    // RETRY forever, stranding the restored owner.
    const cached = this.revisions.get(matchId);
    const expectedRevision =
      cached?.fence === snapshot.fence
        ? cached.revision
        : await this.readPersistedRevision(matchId);
    const nextRevision = expectedRevision + 1;
    const outcome = await this.redis.fencedStateSet(
      ownerKey(matchId),
      fenceKey(matchId),
      stateKey(matchId),
      revisionKey(matchId),
      {
        leaseValue: snapshot.leaseValue,
        expectedFence: snapshot.fence,
        blob,
        ttlSec: STATE_TTL_SEC,
        expectedRevision,
        nextRevision,
      },
    );
    if (outcome === "APPLIED") {
      // Bind the advanced revision to the fence it was written under.
      this.revisions.set(matchId, {
        fence: snapshot.fence,
        revision: nextRevision,
      });
    } else {
      this.logger.warn(
        `persistStateMachine: fenced CAS RETRY for ${matchId} (lost ownership / stale fence); state NOT written, broadcast must be skipped`,
      );
    }
    return outcome;
  }

  // Run `fn` after any in-flight persist for the same match completes, so
  // fenced CAS operations on one match never overlap (see `persistChains`).
  // The stored chain tail never rejects (so a thrown persist can't orphan the
  // chain as an unhandled rejection); the returned promise still surfaces the
  // real outcome — including a throw — to the caller.
  private runPersistExclusive(
    matchId: string,
    fn: () => Promise<PersistOutcome>,
  ): Promise<PersistOutcome> {
    const prev = this.persistChains.get(matchId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.persistChains.set(
      matchId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  // Read the persisted match:state-revision from Redis for a match this node
  // has no local revision for (recovery / ownership handoff). Returns
  // INITIAL_STATE_REVISION when the key is absent, malformed, or unreadable so
  // the caller can still attempt a bootstrap/CAS rather than throw.
  private async readPersistedRevision(matchId: string): Promise<number> {
    try {
      const raw = await this.redis.get(revisionKey(matchId));
      if (raw !== null && raw !== undefined) {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 0) return parsed;
      }
    } catch (error) {
      this.logger.warn(
        `readPersistedRevision: failed to read revision for ${matchId}; defaulting to INITIAL: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return INITIAL_STATE_REVISION;
  }

  // Get match by ID
  async getMatch(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: {
          include: { user: { select: { id: true, username: true } } },
        },
        rounds: true,
      },
    });

    if (!match) {
      throw new NotFoundException(ErrorCode.MATCH_NOT_FOUND);
    }

    return match;
  }

  // Save match result
  //
  // H2 + M4 fix: the score persistence, the match status update, and
  // the room status update now run inside a SINGLE Prisma
  // transaction. Previously they were three separate awaits, so a
  // partial failure (DB blip between the second and third await)
  // could leave the database in an inconsistent state where the
  // match was FINISHED in the Match table but the Room was still
  // IN_GAME (or vice versa). Players would see a finished match
  // but the room would still be playable.
  //
  // The cleanup order is also fixed: Redis delete runs BEFORE the
  // in-memory stateMachines.delete. The old order meant a Redis
  // failure left a zombie state in Redis pointing at a deleted
  // in-memory entry; getStateMachine would then restore a stale
  // state on the next call. The new order ensures Redis is clean
  // before the in-memory map is, so a late getStateMachine call
  // (after finishMatch) returns undefined and the handler short-
  // circuits cleanly.
  //
  // The `roomId` argument replaces an inline DB lookup. The caller
  // (GameLoopService or AdminService) has it on hand: the game loop
  // gets it from the state machine, the admin path gets it via a
  // one-shot match query. This keeps the transaction list short
  // and avoids a `findUnique` inside `$transaction` (which is
  // awkward in Prisma's typed transaction API).
  async finishMatch(
    matchId: string,
    winnerId: string | null,
    roomId: string,
    isAdminTermination = false,
  ) {
    // 2d fix — two-phase claim. The match row is claimed as FINISHED
    // BEFORE any score / room update ops are built or executed, so a
    // concurrent or post-restart `finishMatch` call that races us
    // cannot trigger score / cardsPlayed / classId writes on a match
    // that is already FINISHED. The pre-check is a single
    // `updateMany` with `status: { not: FINISHED }`; a `count === 0`
    // result means another finisher won the race — we return
    // immediately with the canonical row and never read the state
    // machine for score computation.
    //
    // For the admin-termination path we still want the claim gate
    // (skipping it would let a force-terminator overwrite a winner
    // that a normal finish had already committed), so the pre-check
    // runs unconditionally. The only thing the admin path skips is
    // the SCORE UPDATE OPS — the match / room status updates still
    // run in the main transaction below.
    const claimResult = await this.prisma.match.updateMany({
      where: { id: matchId, status: { not: MatchStatus.FINISHED } },
      data: {
        status: MatchStatus.FINISHED,
        winnerId,
        endedAt: new Date(),
      },
    });
    if (claimResult.count === 0) {
      this.logger.warn(
        `finishMatch: match ${matchId} was already FINISHED; treating this call as a no-op (claim gate). winnerId/endedAt left untouched.`,
      );
      return this.prisma.match.findUnique({ where: { id: matchId } });
    }

    // Claim succeeded — only the claimant computes score updates.
    // Skipped for admin termination: the match was force-stopped and
    // the state machine reference is dropped without computing final
    // scores. Reading the in-memory state machine AFTER the claim
    // means a loser of the claim race never paid the read cost.
    const scoreUpdateOps = !isAdminTermination
      ? await this.buildScoreUpdateOps(matchId)
      : [];

    // H2: ONE transaction for the remaining work. Either all of
    // {scores, room} commit or none do. If Prisma throws, the database
    // is left untouched.
    //
    // The `match.updateMany` claim has already committed in the
    // pre-check above; the `match.updateMany` re-issued here is a
    // safety-net no-op (status is now FINISHED so the
    // `status: { not: FINISHED }` filter rejects every row, returning
    // `count: 0`). Keeping it in the same array preserves the H2
    // single-transaction contract from the original implementation
    // and the `updateResult` slot is still read for diagnostics.
    //
    // Prisma's $transaction returns results in the same order as the
    // input array. With the `...scoreUpdateOps` spread the
    // match.updateMany operation lives at index `scoreUpdateOps.length`
    // (which is 0 for the admin-termination path and N for the
    // normal-finish path). We read that slot explicitly to get the
    // `{ count }` result of the idempotent re-claim.
    //
    // 1f/2a fix: the match update is idempotent at the DB layer. The
    // in-memory `finishingMatches` guard in GameLoopService only covers
    // a single process; a cross-process finish or a post-restart
    // re-call could otherwise overwrite winnerId/endedAt on an
    // already-FINISHED match. `updateMany` with a
    // `status: { not: FINISHED }` filter makes the second finish a
    // no-op (count: 0) instead of a clobbering write.
    const txResults = await this.prisma.$transaction([
      ...scoreUpdateOps,
      this.prisma.match.updateMany({
        where: { id: matchId, status: { not: MatchStatus.FINISHED } },
        data: {
          status: MatchStatus.FINISHED,
          winnerId,
          endedAt: new Date(),
        },
      }),
      this.prisma.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.FINISHED },
      }),
    ]);
    // `txResults[scoreUpdateOps.length].count` is the in-transaction
    // re-claim's `{ count }`. The re-claim returning count: 0 is the
    // EXPECTED outcome (the row was already set to FINISHED by the
    // pre-claim above, so the `status: { not: FINISHED }` filter
    // rejects it). No assertion / no warning — we read past the
    // slot and continue to Redis cleanup so the winner's match
    // reaches a consistent FINISHED state. The expression below is
    // bound here only to document the slot's semantics; it is
    // intentionally not used otherwise.
    void txResults[scoreUpdateOps.length];

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
    });

    // M4 fix: Redis cleanup BEFORE in-memory cleanup. If Redis throws,
    // the in-memory state is still present, so getStateMachine will
    // keep returning the (now-fully-FINISHED) machine and the API
    // stays consistent. Operators see a logged warning; the state
    // is functionally clean for new requests.
    try {
      const snapshot = this.matchOwnership.getOwnershipSnapshot(matchId);
      if (snapshot) {
        // Owner-path cleanup: fence the delete so a superseded owner's late
        // finish cannot remove canonical state a NEW owner has since written.
        // A no-op (false) means ownership already moved on — leave it intact.
        const deleted = await this.redis.fencedStateDelete(
          ownerKey(matchId),
          fenceKey(matchId),
          stateKey(matchId),
          revisionKey(matchId),
          { leaseValue: snapshot.leaseValue, expectedFence: snapshot.fence },
        );
        if (!deleted) {
          this.logger.warn(
            `finishMatch: fenced state cleanup for ${matchId} was a no-op (ownership moved on); leaving canonical state for the current owner`,
          );
        }
      } else {
        // No ownership snapshot (admin force-termination / legacy path): delete
        // unconditionally so a terminated match never strands Redis state.
        await this.redis.del(stateKey(matchId));
        // B2c: drop the fenced-CAS revision key alongside the state.
        await this.redis.del(revisionKey(matchId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to delete Redis state for match ${matchId} (will be cleaned on next Redis flush): ${message}`,
      );
    }

    // Only after Redis is clean do we drop the in-memory entry.
    this.stateMachines.delete(matchId);
    this.revisions.delete(matchId);
    this.persistChains.delete(matchId);

    const winnerDetails = winnerId
      ? `, winner: ${winnerId}`
      : " (admin termination, no winner)";
    this.logger.log(`Match finished: ${matchId}${winnerDetails}`);
    return match;
  }

  // Build the score-update Prisma operations for the transaction.
  // Returns an empty array if the state machine is gone or has no
  // players. Extracted to keep finishMatch's transaction list
  // readable.
  private async buildScoreUpdateOps(matchId: string) {
    const stateMachine = this.stateMachines.get(matchId);
    if (!stateMachine) {
      // 2d fix: surface silent score loss. This is the normal-finish
      // path (isAdminTermination === false), so the state machine
      // SHOULD be present. If it's gone (Redis expired, prior partial
      // cleanup, or a getStateMachine that never repopulated the
      // in-memory map), the match finishes with NO score persistence.
      // Previously this returned [] silently — players' final scores
      // were lost with no trace. Log a warning so operators notice.
      this.logger.warn(
        `buildScoreUpdateOps: no state machine for match ${matchId} on a normal finish; final scores will NOT be persisted. This indicates the state machine was lost (Redis expiry or partial cleanup) before finishMatch ran.`,
      );
      return [];
    }
    const playerScores = stateMachine.getPlayerScores();
    if (playerScores.length === 0) return [];

    // Phase 3 — count CARD_RESOLVED events per player from the event
    // log so the daily leaderboard can aggregate "most cards played
    // this week". Read-only traversal of the in-memory event log; the
    // state machine is NOT modified.
    const cardsPlayedByUser = new Map<string, number>();
    // Phase 3 — class assignment per match, derived from the
    // CLASS_ASSIGNED event emitted by MatchStateMachine.classAssignment.
    // Stored on MatchPlayer.classId so the profile page can compute
    // class winrate (per spec §2 Decision 19 follow-up: class-specific
    // winrate is part of Phase 3 reporting). Players with no
    // CLASS_ASSIGNED event (legacy / admin-terminated matches) keep
    // classId = NULL.
    const classByUser = new Map<string, string>();
    for (const entry of stateMachine.getEventLog()) {
      if (entry.type === MatchEventType.CARD_RESOLVED) {
        // `CardEffectEvent = MutationEffect | TemporaryEffect` — both
        // share a `playedByPlayerId` field; the union is already
        // narrowed by `entry.type` matching the discriminator, so the
        // cast is safe (the runtime value is one of the two).
        const payload = entry.payload as CardEffectEvent;
        const playerId = payload.playedByPlayerId;
        if (playerId) {
          cardsPlayedByUser.set(
            playerId,
            (cardsPlayedByUser.get(playerId) ?? 0) + 1,
          );
        }
      } else if (entry.type === MatchEventType.CLASS_ASSIGNED) {
        // `ClassAssignedEvent` is the canonical payload schema for the
        // CLASS_ASSIGNED event; reading `assignments` is type-safe.
        const payload = entry.payload as ClassAssignedEvent;
        const assignments = payload.assignments ?? [];
        for (const a of assignments) {
          classByUser.set(a.playerId, a.classId);
        }
      }
    }

    return playerScores.map((p) =>
      this.prisma.matchPlayer.updateMany({
        where: { matchId, userId: p.userId },
        data: {
          score: p.score,
          cardsPlayed: cardsPlayedByUser.get(p.userId) ?? 0,
          classId: classByUser.get(p.userId) ?? null,
        },
      }),
    );
  }

  // Save round result
  async saveRound(matchId: string, roundNo: number, questionId: string) {
    return this.prisma.matchRound.create({
      data: {
        matchId,
        roundNo,
        questionId,
      },
    });
  }

  // Save the round row and its batched answers in a single Prisma
  // $transaction. Used by GameLoopService.endRound so a partial
  // failure (e.g. saveAnswers throws after saveRound commits) can
  // never leave the database in a state where the round row exists
  // without its answers — which would (a) silently lose answer
  // history for the round and (b) trip @@unique([matchId, roundNo])
  // on the next retry after a process restart (Redis still holds
  // the pre-transition state, the timer re-fires endRound, and
  // P2002 on the second create would permanently stall the match).
  //
  // Returns the created round row so the caller can correlate the
  // result with subsequent answer writes (the roundId is also
  // stamped onto every Answer row inside the transaction).
  async saveRoundAndAnswers(
    matchId: string,
    roundNo: number,
    questionId: string,
    answers: Array<{
      userId: string;
      answer: string;
      isCorrect: boolean;
      responseTimeMs: number;
    }>,
  ) {
    // 2b fix: idempotency against a post-commit retry. The single
    // $transaction makes round + answers atomic, but atomic is not
    // idempotent: if endRound runs twice with the round already
    // committed the first time (e.g. process restart with Redis still
    // holding ROUND_ACTIVE, timer re-fires), the second
    // matchRound.create hits @@unique([matchId, roundNo]) with a
    // P2002 — which would propagate up and permanently stall the
    // match. We pre-check for an existing round inside the
    // transaction and short-circuit to a no-op if it's already there,
    // and we also catch P2002 defensively in case two callers race
    // past the pre-check concurrently.
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.matchRound.findUnique({
          where: { matchId_roundNo: { matchId, roundNo } },
        });
        if (existing) {
          this.logger.warn(
            `saveRoundAndAnswers: round ${roundNo} for match ${matchId} already persisted; treating as no-op (idempotent retry).`,
          );
          return existing;
        }

        const round = await tx.matchRound.create({
          data: { matchId, roundNo, questionId },
        });
        if (answers.length > 0) {
          await tx.answer.createMany({
            data: answers.map((a) => ({
              matchId,
              roundId: round.id,
              userId: a.userId,
              answer: a.answer,
              isCorrect: a.isCorrect,
              responseTimeMs: a.responseTimeMs,
            })),
          });
        }
        return round;
      });
    } catch (error) {
      // P2002 = unique constraint violation. A concurrent caller
      // committed the same round between our pre-check and create.
      // Treat as already-saved (idempotent) rather than stalling the
      // match.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        this.logger.warn(
          `saveRoundAndAnswers: P2002 on round ${roundNo} for match ${matchId} (concurrent retry won the race); treating as already-saved.`,
        );
        const existing = await this.prisma.matchRound.findUnique({
          where: { matchId_roundNo: { matchId, roundNo } },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  // Save answer
  async saveAnswer(
    matchId: string,
    roundId: string,
    userId: string,
    answer: string,
    isCorrect: boolean,
    responseTimeMs: number,
  ) {
    return this.prisma.answer.create({
      data: {
        matchId,
        roundId,
        userId,
        answer,
        isCorrect,
        responseTimeMs,
      },
    });
  }

  // Save multiple answers in a single batch
  async saveAnswers(
    answers: Array<{
      matchId: string;
      roundId: string;
      userId: string;
      answer: string;
      isCorrect: boolean;
      responseTimeMs: number;
    }>,
  ) {
    if (answers.length === 0) return { count: 0 };
    return this.prisma.answer.createMany({
      data: answers,
    });
  }
}
