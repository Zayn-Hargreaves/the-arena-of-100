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
import { RedisService } from "../redis/redis.service";
import { ClusterService } from "../cluster/cluster.service";
import {
  ACTIVE_SET,
  ownerKey,
  fenceKey,
  addActiveMatch,
} from "./match-ownership.store";

/** Lease TTL. Heartbeat (B2c) renews it 3× before expiry (every 5s). */
export const LEASE_TTL_SEC = 15;
/** Heartbeat cadence — renews the 15s lease 3× before it can expire. */
export const HEARTBEAT_MS = 5000;
/** Bounded renew attempts at a mutating boundary (assertOwnership) before an
 *  UNAVAILABLE renewal is treated as unrecoverable and the match is relinquished
 *  for failover. */
export const ASSERT_RENEW_ATTEMPTS = 3;
/** Per-node clock-offset key TTL (short; pruned on read when expired). */
export const NODE_CLOCK_TTL_SEC = 15;
/** SET index of live node ids publishing a clock offset. */
export const NODE_CLOCKS_INDEX = "node:clocks";
const nodeClockKey = (nodeId: string): string => `node:clock:${nodeId}`;

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

@Injectable()
export class MatchOwnershipService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchOwnershipService.name);
  private readonly owned = new Map<string, OwnedEntry>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isBeating = false;
  private roundRunner: RelinquishTarget | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly cluster: ClusterService,
  ) {}

  onModuleInit(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, HEARTBEAT_MS);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Wire the runner GameLoopService owns so the heartbeat can cancel a
   *  match's timers when this node loses the lease. */
  setRoundRunner(runner: RelinquishTarget): void {
    this.roundRunner = runner;
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
    let acquired: { fence: number; leaseValue: string } | null;
    try {
      acquired = await this.redis.acquireLeaseWithFence(
        ownerKey(matchId),
        fenceKey(matchId),
        this.cluster.nodeId,
        LEASE_TTL_SEC,
      );
    } catch (err) {
      // Post-write infrastructure error: the script may already have written a
      // lease we cannot see. B0 throws generic errors here (no verified
      // writtenLease), so treat it as "unknown" and hand the match to B3b's
      // recovery via the match:active index; the lease self-expires via TTL.
      this.logger.error(
        `acquireOnLaunch: acquireLeaseWithFence threw for ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.recoveryHandoff(matchId);
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
}
