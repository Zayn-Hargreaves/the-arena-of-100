// ============================================================
// MatchOwnershipService (B2b) — single-owner-at-launch
//
// Claims a Redis owner lease (via B0's acquireLeaseWithFence) when a match
// launches, tracks owned matches in-memory, and supersedes the Stage-A
// ClusterService.getOwnedMatchIds scan. No heartbeat / fencing yet — that is
// B2c; here the lease simply establishes "exactly one node owns this match at
// launch" and self-expires within LEASE_TTL_SEC if not renewed.
// ============================================================

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Server } from "socket.io";
import { MatchStateMachine } from "@arena/game-core";
import { RedisService } from "../redis/redis.service";
import { ClusterService } from "../cluster/cluster.service";
import {
  ACTIVE_SET,
  DEAD_LETTER_SET,
  TOMBSTONE_TTL_SEC,
  ownerKey,
  fenceKey,
  tombstoneKey,
  addActiveMatch,
  listActiveMatchIds,
} from "./match-ownership.store";

/** Lease TTL. Heartbeat (B2c) renews it 3× before expiry (every 5s). */
export const LEASE_TTL_SEC = 15;
/** Heartbeat cadence — renews the 15s lease 3× before it can expire. */
export const HEARTBEAT_MS = 5000;
/** Periodic orphan-sweep cadence — catches a crashed owner between boots. */
export const ORPHAN_SWEEP_MS = 5000;
/** Max resume/hydrate retries before a match is dead-lettered (B3b). */
export const RECOVERY_MAX_RETRIES = 5;
/** Bounded renew attempts at a mutating boundary (assertOwnership) before an
 *  UNAVAILABLE renewal is treated as unrecoverable and the match is relinquished
 *  for failover. */
export const ASSERT_RENEW_ATTEMPTS = 3;
/** Per-node clock-offset key TTL (short; pruned on read when expired). */
export const NODE_CLOCK_TTL_SEC = 15;
/** SET index of live node ids publishing a clock offset. */
export const NODE_CLOCKS_INDEX = "node:clocks";
const nodeClockKey = (nodeId: string): string => `node:clock:${nodeId}`;
/** Canonical match:state blob key (same string MatchService uses). */
const stateKey = (matchId: string): string => `match:state:${matchId}`;

interface OwnedEntry {
  roomId: string;
  fence: number;
  leaseValue: string;
}

/** The relinquish target — MatchRoundRunner's timer-cancel entry point. Set by
 *  GameLoopService (the runner is `new`'d there, not DI) to avoid a cycle. */
interface RelinquishTarget {
  cancelMatchLoop(matchId: string): void;
}

/**
 * Recovery collaborators wired by GameLoopService (avoids a DI cycle:
 * MatchService already depends on MatchOwnershipService). `getStateMachine` /
 * `getRoomIdByMatchId` come from MatchService; `resumeMatchLoop` from the
 * `new`'d MatchRoundRunner (B3a).
 */
interface RecoveryDeps {
  getStateMachine(matchId: string): Promise<MatchStateMachine | undefined>;
  getRoomIdByMatchId(matchId: string): Promise<string | undefined>;
  resumeMatchLoop(
    matchId: string,
    hydratedSm: MatchStateMachine,
    roomId: string,
    server: Server,
  ): Promise<void>;
}

/** Per-match recovery retry bookkeeping (exponential backoff + dead-letter). */
interface RetryContext {
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
}

@Injectable()
export class MatchOwnershipService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchOwnershipService.name);
  private readonly owned = new Map<string, OwnedEntry>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private isBeating = false;
  private isSweeping = false;
  private roundRunner: RelinquishTarget | null = null;
  private recovery: RecoveryDeps | null = null;
  private server: Server | null = null;
  // B3b: matchIds discovered at boot before the socket server was wired
  // (afterInit runs after onModuleInit). Buffer ONLY the id — the full
  // acquire/hydrate/revalidate/resume runs during drain with a live server.
  private pendingRecovery: string[] = [];
  // In-flight guard so boot + sweep (or two sweeps) never double-recover a match.
  private readonly recovering = new Set<string>();
  // Per-match exponential-backoff retry state.
  private readonly retries = new Map<string, RetryContext>();

  constructor(
    private readonly redis: RedisService,
    private readonly cluster: ClusterService,
  ) {}

  onModuleInit(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, HEARTBEAT_MS);
    this.sweepInterval = setInterval(() => {
      void this.orphanSweep();
    }, ORPHAN_SWEEP_MS);
    // Boot recovery: fire-and-forget so DI init is not blocked on Redis.
    void this.recoverOnBoot();
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    for (const ctx of this.retries.values()) {
      if (ctx.timer) clearTimeout(ctx.timer);
    }
    this.retries.clear();
  }

  /** Wire the runner GameLoopService owns so the heartbeat can cancel a
   *  match's timers when this node loses the lease. */
  setRoundRunner(runner: RelinquishTarget): void {
    this.roundRunner = runner;
  }

  /** Wire the recovery collaborators (MatchService + MatchRoundRunner).
   *  GameLoopService calls this in its constructor, before any onModuleInit. */
  setRecoveryDeps(deps: RecoveryDeps): void {
    this.recovery = deps;
  }

  /** Inject the Socket.io server (gateway afterInit). Drains buffered boot
   *  recovery discovered before the server was wired. */
  setServer(server: Server): void {
    this.server = server;
    this.drainPendingRecovery();
  }

  /**
   * Claim the owner lease for a launching match. Called by
   * GameLoopService.launchRoomMatch AFTER the match row exists. Returns true
   * only when this node holds the lease AND the match is indexed in
   * match:active AND the lease was revalidated immediately before returning.
   *
   * On every failure path it fully reconciles ownership before returning false
   * (verified lease release, or — if release cannot be proven — a match:active
   * handoff so B3b's orphan sweep adopts the match once the lease TTL lapses),
   * so the caller only ever sees the boolean and rolls back the launch state.
   */
  async acquireOnLaunch(matchId: string, roomId: string): Promise<boolean> {
    let acquired: { fence: number; leaseValue: string } | null | "TERMINAL";
    try {
      // B3b: route through the tombstone-aware acquisition so a launch can never
      // acquire a finalized match (a launch against a tombstoned match is a bug).
      acquired = await this.redis.acquireMatchLease(
        ownerKey(matchId),
        fenceKey(matchId),
        tombstoneKey(matchId),
        this.cluster.nodeId,
        LEASE_TTL_SEC,
      );
    } catch (err) {
      // Post-write infrastructure error: the script may already have written a
      // lease we cannot see. B0 throws generic errors here (no verified
      // writtenLease), so treat it as "unknown" and hand the match to B3b's
      // recovery via the match:active index; the lease self-expires via TTL.
      this.logger.error(
        `acquireOnLaunch: acquireMatchLease threw for ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.recoveryHandoff(matchId);
      return false;
    }

    if (acquired === "TERMINAL") {
      this.logger.error(
        `acquireOnLaunch: match ${matchId} is tombstoned (finalized); refusing launch`,
      );
      return false;
    }
    if (!acquired) return false; // lease already held by another node
    const { fence, leaseValue } = acquired;

    // Index into match:active, then revalidate the lease. A match absent from
    // the index is invisible to recovery, so retry a bounded number of times;
    // do NOT record local ownership until the lease is confirmed still ours.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await addActiveMatch(this.redis, matchId);
        const stillHeld = await this.redis.renewLease(
          ownerKey(matchId),
          leaseValue,
          LEASE_TTL_SEC,
        );
        if (!stillHeld) {
          this.logger.warn(
            `acquireOnLaunch: lease for ${matchId} no longer held after active-index write`,
          );
          return false;
        }
        this.owned.set(matchId, { roomId, fence, leaseValue });
        return true;
      } catch (err) {
        this.logger.warn(
          `acquireOnLaunch: addActiveMatch failed (attempt ${attempt + 1}) for ${matchId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Retry-exhaustion compensation: a prior attempt may have SADD'd the match
    // into match:active before renewLease failed, so release the lease AND the
    // index entry ATOMICALLY (releaseLeaseAndIndex) — a lease-only release would
    // strand an owner-less matchId in match:active for B3b to adopt. Verify the
    // release (CAS false + a confirming read) before trusting it.
    let released = false;
    for (let attempt = 0; attempt < 3 && !released; attempt++) {
      try {
        released = await this.redis.releaseLeaseAndIndex(
          ownerKey(matchId),
          leaseValue,
          ACTIVE_SET,
          matchId,
        );
        if (!released) {
          const cur = await this.redis.get(ownerKey(matchId));
          released = cur !== leaseValue; // no longer ours ⇒ safely relinquished
        }
      } catch (err) {
        this.logger.warn(
          `acquireOnLaunch: releaseLeaseAndIndex retry ${attempt + 1} failed for ${matchId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (!released) {
      // Could not prove relinquishment. Hand off to B3b: ensure match:active so
      // the orphan sweep adopts the match once our un-released lease TTL lapses.
      await this.recoveryHandoff(matchId);
    }
    this.owned.delete(matchId);
    return false;
  }

  getOwnedMatchIds(): string[] {
    return [...this.owned.keys()];
  }

  isOwner(matchId: string): boolean {
    return this.owned.has(matchId);
  }

  getLeaseValue(matchId: string): string | undefined {
    return this.owned.get(matchId)?.leaseValue;
  }

  /** Ownership snapshot for the fenced CAS on the canonical match:state write.
   *  Undefined when this node does not own the match (persist falls back to a
   *  blind write for non-owned / legacy paths — B4 routes those to the owner). */
  getOwnershipSnapshot(
    matchId: string,
  ): { fence: number; leaseValue: string } | undefined {
    const entry = this.owned.get(matchId);
    return entry
      ? { fence: entry.fence, leaseValue: entry.leaseValue }
      : undefined;
  }

  /**
   * B4a: the live ownership fence for the owner command channel's authoritative
   * apply. Returns the `{ fence, leaseValue }` pair while this node owns the
   * match, or `null` when the lease is lost — so `apply` can abort WITHOUT
   * acking (the entry stays pending for the next owner) instead of applying on
   * a stale claim.
   */
  currentFence(matchId: string): { fence: number; leaseValue: string } | null {
    return this.getOwnershipSnapshot(matchId) ?? null;
  }

  /**
   * Fence check at a mutating boundary. Returns false if we don't own the
   * match; otherwise renews the lease. The renew has three outcomes, which we
   * deliberately distinguish:
   *   - held === true  → we still own it (fence intact) → proceed.
   *   - held === false → the lease is CONFIRMED lost (expired then taken, or
   *                      fence bumped by a takeover) → relinquish, return false.
   *   - throws         → renewal is temporarily UNAVAILABLE (Redis blip). We
   *                      retry within the same boundary a bounded number of
   *                      times so a single blip does not force a decision.
   *
   * If renewal stays UNAVAILABLE across every attempt we do NOT proceed on an
   * unverified ownership claim AND we do NOT retain a lease we can no longer
   * prove/renew: retaining it would stall this match (the boundary callback has
   * already been abandoned) while simultaneously blocking failover. Instead we
   * relinquish — cancel this match's timers and drop local ownership — so the
   * lease self-expires within LEASE_TTL_SEC and another node's recovery adopts
   * it (with a bumped fence that invalidates any late write from us).
   */
  async assertOwnership(matchId: string): Promise<boolean> {
    const entry = this.owned.get(matchId);
    if (!entry) return false;

    let lastErr: unknown;
    for (let attempt = 0; attempt < ASSERT_RENEW_ATTEMPTS; attempt++) {
      if (this.owned.get(matchId) !== entry) return false;

      try {
        const held = await this.redis.renewLease(
          ownerKey(matchId),
          entry.leaseValue,
          LEASE_TTL_SEC,
        );

        if (this.owned.get(matchId) !== entry) return false;

        if (!held) {
          // Confirmed loss — no retry; the lease is someone else's now.
          this.relinquish(matchId);
          return false;
        }
        return true;
      } catch (err) {
        lastErr = err;
      }
    }

    if (this.owned.get(matchId) !== entry) return false;

    // Unrecoverable: renewal never succeeded across the bounded attempts.
    this.logger.warn(
      `assertOwnership: renew UNAVAILABLE for ${matchId} after ${ASSERT_RENEW_ATTEMPTS} attempts; relinquishing so the lease self-expires and another node can take over: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
    this.relinquish(matchId);
    return false;
  }

  /**
   * Heartbeat tick: renew every owned lease FIRST (lease liveness is the
   * critical work — it must not wait behind health telemetry), THEN publish
   * this node's clock offset for skew measurement. Renewals run concurrently
   * (one Redis round-trip each, fired together) rather than serially, so a
   * large owned set cannot let the tail leases drift toward expiry. A lease
   * that no longer renews (expired then taken, or fence bumped) is relinquished
   * immediately — cancel its timers WITHOUT firing and drop local ownership;
   * the new owner holds the lease now. A transient renew error retains
   * ownership (unproven loss); the next tick retries.
   */
  async heartbeat(): Promise<void> {
    if (this.isBeating) return;
    this.isBeating = true;
    try {
      // Renewal phase: fire all owned-lease renewals concurrently, preserving
      // per-match error handling and the relinquish-on-lost-lease behaviour.
      await Promise.all(
        [...this.owned].map(async ([matchId, entry]) => {
          let held: boolean;
          try {
            held = await this.redis.renewLease(
              ownerKey(matchId),
              entry.leaseValue,
              LEASE_TTL_SEC,
            );
          } catch (err) {
            // Transient error — do not relinquish on an unproven loss.
            this.logger.warn(
              `heartbeat: renew errored for ${matchId} (keeping ownership): ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            return;
          }
          if (!held) {
            // The renewal we awaited belongs to a specific ownership epoch. If
            // this match was released and reacquired while our renew was in
            // flight, `owned` now holds a fresh entry (new lease/fence) that a
            // stale "lost" result must NOT relinquish — that would cancel the
            // newly reacquired match's timers and drop live ownership.
            if (this.owned.get(matchId) !== entry) return;
            this.logger.warn(
              `heartbeat: lost lease for ${matchId}; relinquishing (timers cancelled without firing)`,
            );
            this.relinquish(matchId);
          }
        }),
      );

      // Health telemetry only after the renewal phase has completed.
      await this.publishClockOffset();
    } finally {
      this.isBeating = false;
    }
  }

  /** Cancel a match's timers without firing and drop local ownership. Does NOT
   *  releaseLease — the new owner already holds it. */
  private relinquish(matchId: string): void {
    try {
      this.roundRunner?.cancelMatchLoop(matchId);
    } catch (err) {
      this.logger.warn(
        `relinquish: cancelMatchLoop threw for ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    this.owned.delete(matchId);
  }

  /**
   * Publish this node's offset from the shared Redis clock (Date.now() minus the
   * Redis server time), NOT a raw Date.now(). Comparing offsets against a common
   * reference makes skew independent of heartbeat age, so synchronized nodes
   * report ~0 skew even when their heartbeats fired a cycle apart.
   */
  private async publishClockOffset(): Promise<void> {
    try {
      const redisMs = await this.redis.serverTimeMs();
      const offset = Date.now() - redisMs;
      await this.redis.set(
        nodeClockKey(this.cluster.nodeId),
        String(offset),
        NODE_CLOCK_TTL_SEC,
      );
      await this.redis.sadd(NODE_CLOCKS_INDEX, this.cluster.nodeId);
    } catch (err) {
      this.logger.warn(
        `publishClockOffset failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Max inter-node clock skew across live members = max(offset) - min(offset)
   * (the reference-free peer-to-peer spread, computed identically on every
   * node). Expired clock keys are pruned from the index on read. Returns 0 when
   * fewer than two live members. Surfaced on /health/cluster.
   */
  async computeMaxSkew(): Promise<number> {
    const members = await this.redis.smembers(NODE_CLOCKS_INDEX);
    const offsets: number[] = [];
    for (const nodeId of members) {
      const raw = await this.redis.get(nodeClockKey(nodeId));
      if (raw === null) {
        // Clock key expired ⇒ dead node; prune it from the index.
        await this.redis.srem(NODE_CLOCKS_INDEX, nodeId);
        continue;
      }
      const offset = Number(raw);
      if (Number.isFinite(offset)) offsets.push(offset);
    }
    if (offsets.length < 2) return 0;
    return Math.max(...offsets) - Math.min(...offsets);
  }

  /**
   * Atomically release the owner lease AND the match:active index entry in one
   * Lua CAS, so no observer can ever see "owner gone, index present" for a
   * lease we released (which would let the orphan sweep adopt a finished
   * match). A CAS failure means ownership already moved on — the new owner's
   * lease and the index entry are both left untouched.
   */
  async release(matchId: string): Promise<void> {
    const entry = this.owned.get(matchId);
    this.owned.delete(matchId); // always drop local ownership
    if (!entry) return;

    let outcome: boolean | undefined;
    for (let attempt = 0; attempt < 3 && outcome === undefined; attempt++) {
      try {
        outcome = await this.redis.releaseLeaseAndIndex(
          ownerKey(matchId),
          entry.leaseValue,
          ACTIVE_SET,
          matchId,
        );
      } catch (err) {
        this.logger.warn(
          `release: releaseLeaseAndIndex retry ${attempt + 1} failed for ${matchId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (outcome === undefined) {
      // All attempts threw: lease + index state unknown. The un-renewed lease
      // self-expires within LEASE_TTL_SEC and the entry stays in match:active,
      // so B3b's sweep adopts or cleans it — surface for ops either way.
      this.logger.error(
        `release: releaseLeaseAndIndex for ${matchId} failed after retries; lease will self-expire, entry left for B3b recovery/cleanup`,
      );
    } else if (!outcome) {
      this.logger.warn(
        `release: lease for ${matchId} no longer ours; keeping match:active`,
      );
    }
  }

  /**
   * Best-effort recovery handoff: ensure `matchId` is in match:active so B3b's
   * orphan sweep can adopt whatever lease exists once its TTL lapses. Logs at
   * error level if even this fails (the match is then neither driven nor
   * discoverable until manual recovery — the lease still self-expires via TTL).
   */
  private async recoveryHandoff(matchId: string): Promise<void> {
    try {
      await addActiveMatch(this.redis, matchId);
      this.logger.error(
        `acquireOnLaunch: lease for ${matchId} unresolved; left in match:active for recovery (lease self-expires in ${LEASE_TTL_SEC}s)`,
      );
    } catch (err) {
      this.logger.error(
        `acquireOnLaunch: recovery handoff for ${matchId} FAILED (match not discoverable): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ============================================================
  // B3b — boot recovery, orphan sweep, retry/dead-letter, requeue
  // ============================================================

  /**
   * Boot recovery: scan `match:active` for matches whose owner died. Runs the
   * atomic conditional stale-index cleanup FIRST (removes an id whose canonical
   * state is gone in the same op, so a fresh match cannot lose its index entry
   * to two unfenced reads). For a match with live state, defer to the sweep /
   * drain — but if the server is not wired yet, buffer ONLY the matchId and
   * complete the full acquire/hydrate/resume during drain with a live server.
   */
  private async recoverOnBoot(): Promise<void> {
    let matchIds: string[];
    try {
      matchIds = await listActiveMatchIds(this.redis);
    } catch (err) {
      this.logger.error(
        `recoverOnBoot: listActiveMatchIds failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    for (const matchId of matchIds) {
      try {
        const cleanup = await this.redis.removeActiveIfStateAbsent(
          stateKey(matchId),
          ACTIVE_SET,
          matchId,
        );
        if (cleanup === "REMOVED") continue; // stale index; nothing to recover
        if (!this.server) {
          this.pendingRecovery.push(matchId);
          continue;
        }
        void this.attemptRecovery(matchId, this.server);
      } catch (err) {
        this.logger.error(
          `recoverOnBoot: recovery scan failed for ${matchId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** Drain buffered boot recovery once the server is wired. */
  private drainPendingRecovery(): void {
    if (this.pendingRecovery.length === 0 || !this.server) return;
    const buffered = this.pendingRecovery;
    this.pendingRecovery = [];
    const server = this.server;
    for (const matchId of buffered) {
      void this.attemptRecovery(matchId, server);
    }
  }

  /**
   * Periodic orphan sweep: re-scan `match:active` and try to take over any
   * match this node does not already drive. `attemptRecovery` acquires through
   * the tombstone-aware `acquireMatchLease`, so a live-owner match yields `null`
   * (retried on a later tick) and a tombstoned match yields `"TERMINAL"`
   * (dropped for good) — atomically, never as a separate read. An in-flight
   * guard prevents overlapping sweeps.
   */
  async orphanSweep(): Promise<void> {
    if (this.isSweeping || !this.server) return;
    this.isSweeping = true;
    const server = this.server;
    try {
      const matchIds = await listActiveMatchIds(this.redis);
      for (const matchId of matchIds) {
        if (this.owned.has(matchId)) continue; // we already drive it
        await this.attemptRecovery(matchId, server);
      }
    } catch (err) {
      this.logger.error(
        `orphanSweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.isSweeping = false;
    }
  }

  /**
   * One recovery attempt for a match: acquire (or re-verify) the lease, hydrate
   * the canonical state, revalidate ownership, and resume the loop — closing the
   * TOCTOU by passing the already-hydrated state machine into `resumeMatchLoop`.
   * A recoverable hydrate/Redis failure or a `resumeMatchLoop` throw schedules a
   * backoff retry; a confirmed-absent state is finalized as `cleaned`; a
   * tombstone is dropped for good; a lost lease aborts (preserving `match:active`
   * for the real owner).
   */
  private async attemptRecovery(
    matchId: string,
    server: Server,
  ): Promise<void> {
    if (this.recovering.has(matchId)) return;
    if (!this.recovery) return;
    this.recovering.add(matchId);
    try {
      let entry = this.owned.get(matchId);

      // Acquire (first attempt) or re-verify the retained lease (retry).
      if (entry) {
        const held = await this.redis.renewLease(
          ownerKey(matchId),
          entry.leaseValue,
          LEASE_TTL_SEC,
        );
        if (!held) {
          const reacquired = await this.acquireForRecovery(matchId);
          if (reacquired === "abort") {
            this.owned.delete(matchId);
            this.clearRecoveryRetry(matchId);
            return;
          }
          entry = this.owned.get(matchId);
        }
      } else {
        const acquired = await this.acquireForRecovery(matchId);
        if (acquired === "abort") {
          this.clearRecoveryRetry(matchId);
          return;
        }
        if (acquired === "held") return; // live owner; leave in match:active
        entry = this.owned.get(matchId);
      }
      if (!entry) return;

      // Hydrate the canonical state. A recoverable Redis/hydrate failure keeps
      // the lease (heartbeat renews it) and retries; it must NOT clean the index.
      let sm: MatchStateMachine | undefined;
      try {
        sm = await this.recovery.getStateMachine(matchId);
      } catch (err) {
        this.logger.warn(
          `attemptRecovery: hydrate failed for ${matchId} (retrying, match:active preserved): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.scheduleRecoveryRetry(matchId, server);
        return;
      }

      // Final revalidation: canonical state gone/unparseable → finalize cleaned.
      if (!sm) {
        await this.finalizeTerminal(matchId, "cleaned");
        return;
      }

      // Revalidate ownership immediately before recording + resuming.
      const stillOwner = await this.redis.renewLease(
        ownerKey(matchId),
        entry.leaseValue,
        LEASE_TTL_SEC,
      );
      if (!stillOwner) {
        this.owned.delete(matchId);
        this.logger.warn(
          `attemptRecovery: lost lease for ${matchId} before resume; preserving match:active for the new owner`,
        );
        return;
      }

      const roomId =
        sm.getState().roomId ||
        (await this.recovery.getRoomIdByMatchId(matchId)) ||
        "";
      this.owned.set(matchId, {
        roomId,
        fence: entry.fence,
        leaseValue: entry.leaseValue,
      });

      try {
        await this.recovery.resumeMatchLoop(matchId, sm, roomId, server);
        this.clearRecoveryRetry(matchId);
      } catch (err) {
        this.logger.warn(
          `attemptRecovery: resumeMatchLoop threw for ${matchId} (scheduling retry): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.scheduleRecoveryRetry(matchId, server);
      }
    } finally {
      this.recovering.delete(matchId);
    }
  }

  /**
   * Acquire the lease for recovery via the tombstone-aware primitive. Records
   * ownership (roomId filled in later) on success. Returns:
   *   - "acquired": lease held (this.owned updated);
   *   - "held":     a live owner holds it — not ours this tick (retryable);
   *   - "abort":    tombstoned/terminal (drop retry) — the TERMINAL path also
   *                 removes the id from match:active atomically.
   */
  private async acquireForRecovery(
    matchId: string,
  ): Promise<"acquired" | "held" | "abort"> {
    let result: { fence: number; leaseValue: string } | null | "TERMINAL";
    try {
      result = await this.redis.acquireMatchLease(
        ownerKey(matchId),
        fenceKey(matchId),
        tombstoneKey(matchId),
        this.cluster.nodeId,
        LEASE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `acquireForRecovery: acquireMatchLease threw for ${matchId} (leaving in match:active): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return "held";
    }
    if (result === "TERMINAL") {
      try {
        await this.redis.removeActiveIfTombstoned(
          tombstoneKey(matchId),
          ACTIVE_SET,
          matchId,
        );
      } catch (err) {
        this.logger.warn(
          `acquireForRecovery: tombstoned index cleanup failed for ${matchId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return "abort";
    }
    if (result === null) return "held";
    this.owned.set(matchId, {
      roomId: "",
      fence: result.fence,
      leaseValue: result.leaseValue,
    });
    return "acquired";
  }

  /**
   * Single atomic fenced finalization (cleaned / dead-letter). Validates the
   * captured lease/fence, writes the tombstone, removes `match:active`, and (for
   * dead-letter) SADDs the ops index — all in one Lua transaction. Only after
   * FINALIZED do we release the lease. A STALE result means a newer lease took
   * over: abort, preserve `match:active` for the new owner.
   */
  private async finalizeTerminal(
    matchId: string,
    reason: "cleaned" | "dead-letter",
  ): Promise<void> {
    const entry = this.owned.get(matchId);
    if (!entry) {
      this.clearRecoveryRetry(matchId);
      return;
    }
    let outcome: "FINALIZED" | "STALE";
    try {
      outcome = await this.redis.finalizeMatchTombstone(
        ownerKey(matchId),
        fenceKey(matchId),
        tombstoneKey(matchId),
        ACTIVE_SET,
        DEAD_LETTER_SET,
        matchId,
        {
          leaseValue: entry.leaseValue,
          expectedFence: entry.fence,
          reason,
          ttlSec: TOMBSTONE_TTL_SEC,
        },
      );
    } catch (err) {
      this.logger.error(
        `finalizeTerminal(${reason}): finalize threw for ${matchId} (match:active preserved): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.owned.delete(matchId);
      this.clearRecoveryRetry(matchId);
      return;
    }
    if (outcome === "FINALIZED") {
      // Release the lease only after the finalize landed.
      try {
        await this.redis.releaseLease(ownerKey(matchId), entry.leaseValue);
      } catch {
        // Lease self-expires within LEASE_TTL_SEC; tombstone blocks reacquire.
      }
      this.logger.warn(
        `finalizeTerminal: match ${matchId} finalized as ${reason} (tombstone written, match:active removed)`,
      );
    } else {
      this.logger.warn(
        `finalizeTerminal(${reason}): STALE for ${matchId} — a newer lease took over; preserving match:active`,
      );
    }
    this.owned.delete(matchId);
    this.clearRecoveryRetry(matchId);
  }

  /** Schedule a backoff retry, or dead-letter the match once retries exhaust. */
  private scheduleRecoveryRetry(matchId: string, server: Server): void {
    const ctx = this.retries.get(matchId) ?? { count: 0, timer: null };
    if (ctx.timer) return; // already scheduled
    if (ctx.count >= RECOVERY_MAX_RETRIES) {
      this.logger.error(
        `[ALERT][RECOVERY_ABORTED] match ${matchId} failed recovery after ${RECOVERY_MAX_RETRIES} retries; dead-lettering`,
      );
      void this.finalizeTerminal(matchId, "dead-letter");
      return;
    }
    ctx.count += 1;
    const delay = Math.min(1000 * Math.pow(2, ctx.count - 1), 8000);
    const timer = setTimeout(() => {
      const cur = this.retries.get(matchId);
      if (cur) cur.timer = null;
      void this.attemptRecovery(matchId, server);
    }, delay);
    timer.unref?.();
    ctx.timer = timer;
    this.retries.set(matchId, ctx);
  }

  private clearRecoveryRetry(matchId: string): void {
    const ctx = this.retries.get(matchId);
    if (ctx?.timer) clearTimeout(ctx.timer);
    this.retries.delete(matchId);
  }

  /**
   * Ops action: requeue a dead-lettered match. Delegates to the single gated
   * Lua op (validate-first, mutate-last) so every rejection touches nothing.
   * `force` allows requeue over a live owner lease (fencing it out atomically).
   */
  async requeueMatch(
    matchId: string,
    force = false,
  ): Promise<
    | "REQUEUED"
    | "NOT_TERMINAL"
    | "INVALID_TOMBSTONE"
    | "FINALIZED"
    | "NO_STATE"
    | "CONFLICT"
  > {
    return this.redis.requeueDeadLetter(
      tombstoneKey(matchId),
      stateKey(matchId),
      ownerKey(matchId),
      fenceKey(matchId),
      ACTIVE_SET,
      DEAD_LETTER_SET,
      matchId,
      { force },
    );
  }
}
