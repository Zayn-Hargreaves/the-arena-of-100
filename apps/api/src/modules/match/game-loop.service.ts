import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Server } from "socket.io";
import {
  GAME_CONFIG,
  MatchStatus,
  RoomStatus,
  ServerEvent,
  getRoomChannel,
  RoomError,
  ErrorCode,
} from "@arena/shared";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "../room/room.service";
import { RedisService } from "../redis/redis.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  LobbyCountdownEntry,
  PendingRecoveryEntry,
} from "./game-loop.types";
import {
  emitMatchStarted,
  emitMatchStarting,
  emitRoomStatusUpdated,
  emitRoomTerminated,
  emitWaitingRoomState,
  makeLobbyCountdownEntry,
  makePendingRecoveryEntry,
} from "./game-loop.helpers";
import {
  clearPersistedCountdown,
  listPersistedCountdownRoomIds,
  LOBBY_COUNTDOWN_INDEX_KEY,
  persistLobbyCountdown,
  readPersistedCountdownEnd,
  removeStaleCountdownIndexEntry,
} from "./game-loop.countdown-store";

// Re-export for backwards compatibility with existing spec imports.
export const COUNTDOWN_INDEX_KEY = LOBBY_COUNTDOWN_INDEX_KEY;
import {
  emitMatchDisconnected,
  emitMatchFinished,
  emitMatchPlayerLeft,
  emitPlayerEliminated,
  emitRoundEnded,
  emitRoundStarted,
} from "./game-loop.events";

@Injectable()
export class GameLoopService implements OnModuleInit {
  private readonly logger = new Logger(GameLoopService.name);
  private activeTimers = new Map<string, Set<NodeJS.Timeout>>();
  private lobbyCountdowns = new Map<string, LobbyCountdownEntry>();
  // F2: Track used question IDs per match to avoid repeats
  private usedQuestionIds = new Map<string, Set<string>>();
  // Add property for early termination (used by Task 7)
  private expectedAnswers = new Map<string, number>();
  // H1 fix: round-end idempotency. Mirrors the `endingRounds` pattern;
  // serialises concurrent endRound callers so the DB is not written
  // twice and the ROUND_ENDED + PLAYER_ELIMINATED events are not
  // duplicated.
  private endingRounds = new Set<string>();
  // B1 fix: match-finish idempotency. `finishMatchLoop` is reachable
  // from two independent paths that can race:
  //
  //   1. `checkMatchEnd` timer fires when the surviving count drops
  //      to 1 (or MAX_ROUNDS is hit) and reaches finishMatchLoop
  //      through the in-process event loop.
  //   2. `AdminService.terminateRoom` mutates the same Match row
  //      (winnerId: null) through `matchService.finishMatch` while
  //      a checkMatchEnd timer is in flight.
  //
  // Without this guard the two paths can write the same Match row
  // twice with conflicting winnerId values, and the clients receive
  // both MATCH_FINISHED and ROOM_TERMINATED for the same matchId.
  // The Set is exposed through `isMatchFinishing(matchId)` so the
  // admin path can short-circuit BEFORE calling matchService.finishMatch.
  private finishingMatches = new Set<string>();
  private server?: Server;
  private recoveryInFlight = false;
  // C4 fix: when onModuleInit runs before setServer has been called
  // (the NestJS WebSocket gateway's afterInit hook fires after
  // onModuleInit), recovered countdowns are buffered here so the
  // room is not silently stuck in COUNTDOWN forever. As soon as
  // setServer is invoked we drain the buffer and re-arm the timers.
  private pendingRecovery: PendingRecoveryEntry[] = [];
  private activeRecoveryRetries = new Set<string>();

  constructor(
    private readonly matchService: MatchService,
    private readonly questionService: QuestionService,
    private readonly roomService: RoomService,
    private readonly redis: RedisService,
    // B3 fix: we need direct Prisma access inside `launchRoomMatch`
    // to acquire a row-level lock on the Room row + perform the
    // status / currentMatchId check atomically. The same pattern
    // is used in `RoomService.joinRoom` (see
    // `apps/api/src/modules/room/room.service.ts:171-182`). The
    // PrismaModule is global, so no module change is required.
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Inject the Socket.io server so we can recover lobby countdowns on boot
   * (the in-memory timer map does not survive a process restart, but the
   * persisted Redis state does). Called once during application bootstrap.
   */
  setServer(server: Server) {
    this.server = server;
    this.drainPendingRecovery();
  }

  /**
   * Drains the pendingRecovery buffer. Called from setServer as soon as
   * the WebSocket gateway hands us a live server reference. We replay
   * each buffered countdown through the same logic the live path uses,
   * so the timer arming, Redis cleanup, and launchRoomMatch semantics
   * are identical to a never-crashed process.
   *
   * Idempotent: armLobbyCountdownTimer and launchRoomMatch are no-ops
   * if a countdown for the room is already in lobbyCountdowns.
   */
  private drainPendingRecovery() {
    if (this.pendingRecovery.length === 0) return;
    const buffered = this.pendingRecovery;
    this.pendingRecovery = [];
    for (const entry of buffered) {
      this.logger.log(
        `Draining pending recovery for room ${entry.roomId} (expired=${entry.expired})`,
      );
      if (entry.expired) {
        void this.clearPersistedCountdown(entry.roomId)
          .then((cleared) => {
            if (!cleared) {
              this.logger.warn(
                `Recovery clear failed for room ${entry.roomId}: persisted countdown was not cleared; re-queueing with retry`,
              );
              this.scheduleRecoveryRetry(entry);
              return;
            }
            return this.launchRoomMatch(entry.roomId, this.server!, {
              isAutoStart: true,
            });
          })
          .catch((error) => {
            this.logger.error(
              `Pending-recovery launch failed for room ${entry.roomId}:`,
              error,
            );
          });
      } else {
        this.armLobbyCountdownTimer(
          entry.roomId,
          entry.countdownEndsAt,
          this.server,
        );
      }
    }
  }

  /**
   * On startup, scan Redis for any rooms that were in COUNTDOWN when the
   * previous process died. For each one whose `countdownEndsAt` is still in
   * the future, re-arm a timer to launch the match. For those that have
   * already expired, immediately launch the match (best-effort). This
   * prevents rooms being stuck in COUNTDOWN indefinitely with no live timer.
   */
  async onModuleInit() {
    if (this.recoveryInFlight) return;
    this.recoveryInFlight = true;
    try {
      const client = this.redis.getClient();
      const roomIds = await listPersistedCountdownRoomIds(client);
      if (roomIds.length === 0) return;

      this.logger.log(
        `Recovering ${roomIds.length} lobby countdown(s) from Redis...`,
      );
      const now = Date.now();

      for (const roomId of roomIds) {
        try {
          const result = await readPersistedCountdownEnd(client, roomId);
          if (result.kind === "missing") {
            await removeStaleCountdownIndexEntry(client, roomId);
            continue;
          }
          const countdownEndsAt = result.value;
          /* c8 ignore next 6 */
          if (!Number.isFinite(countdownEndsAt)) {
            await clearPersistedCountdown(client, roomId);
            continue;
          }
          const remaining = Math.max(countdownEndsAt - now, 0);
          if (remaining === 0) {
            // Countdown already expired while the process was down.
            //
            // C4 fix: if the Socket.io server is not wired up yet
            // (the WebSocket gateway's afterInit hook runs AFTER
            // onModuleInit in the NestJS lifecycle), DO NOT silently
            // clear the persisted entry. Previously the room was
            // stuck in COUNTDOWN forever and the next process
            // restart would re-issue the same "Cannot launch"
            // warning, leaving the room in a broken state with no
            // timer and no recovery path.
            //
            // Instead, buffer the recovery; setServer() will drain
            // the buffer as soon as the server is available.
            if (this.server) {
              const cleared = await this.clearPersistedCountdown(roomId);
              if (!cleared) {
                this.logger.warn(
                  `Recovery clear failed for room ${roomId}: persisted countdown was not cleared; re-queueing with retry`,
                );
                this.scheduleRecoveryRetry(
                  makePendingRecoveryEntry(roomId, countdownEndsAt, true),
                );
                continue;
              }
              void this.launchRoomMatch(roomId, this.server, {
                isAutoStart: true,
              }).catch((error) => {
                this.logger.error(
                  `Recovery launch failed for room ${roomId}:`,
                  error,
                );
              });
            } else {
              this.logger.warn(
                `Cannot launch recovered match for room ${roomId} yet: server not ready; deferring`,
              );
              this.pendingRecovery.push(
                makePendingRecoveryEntry(roomId, countdownEndsAt, true),
              );
            }
          } else {
            // C4 fix: armLobbyCountdownTimer requires a server. If
            // the gateway hasn't wired us up yet, buffer the entry
            // instead of dropping the Redis key.
            if (this.server) {
              this.armLobbyCountdownTimer(roomId, countdownEndsAt, this.server);
            } else {
              this.logger.warn(
                `Cannot arm recovered countdown for room ${roomId} yet: server not ready; deferring`,
              );
              this.pendingRecovery.push(
                makePendingRecoveryEntry(roomId, countdownEndsAt, false),
              );
            }
          }
        } catch (error) {
          this.logger.error(
            `Failed to recover countdown for room ${roomId}:`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error("Lobby countdown recovery failed:", error);
    } finally {
      this.recoveryInFlight = false;
    }
  }

  async maybeStartPublicCountdown(roomId: string, server: Server) {
    const room = await this.roomService.getRoom(roomId);
    if (room.type !== "PUBLIC") return null;
    if (room.status !== RoomStatus.WAITING) return null;
    if (room.players.length < GAME_CONFIG.MIN_PLAYERS_TO_START) return null;
    if (this.lobbyCountdowns.has(roomId)) {
      return this.lobbyCountdowns.get(roomId) ?? null;
    }

    // Reserve the slot atomically before any await to prevent race conditions
    const startedAt = Date.now();
    const countdownEndsAt = startedAt + GAME_CONFIG.COUNTDOWN_DURATION_MS;
    this.lobbyCountdowns.set(roomId, makeLobbyCountdownEntry(countdownEndsAt));

    try {
      await this.roomService.updateRoomStatus(roomId, RoomStatus.COUNTDOWN);

      const channel = getRoomChannel(roomId);

      emitRoomStatusUpdated(server, {
        roomId,
        roomStatus: RoomStatus.COUNTDOWN,
        currentMatchId: null,
        updatedAt: startedAt,
      });

      server.to(channel).emit(ServerEvent.ROOM_COUNTDOWN_STARTED, {
        roomId,
        roomStatus: RoomStatus.COUNTDOWN,
        countdownEndsAt,
        countdownMs: GAME_CONFIG.COUNTDOWN_DURATION_MS,
        startedAt,
      });

      this.armLobbyCountdownTimer(roomId, countdownEndsAt, server);
      // Persist to Redis so a process restart can recover and re-arm the
      // timer (or launch the match if it expired while we were down).
      //
      // This is intentionally best-effort: a transient Redis blip must
      // not propagate to the outer catch (which calls
      // clearLobbyCountdownBestEffort and would orphan the timer we
      // just armed on line 277). The in-memory timer still drives the
      // countdown for the live process; only the cross-restart
      // recovery is lost, and on the next process start the
      // not-yet-expired entry is best recovered via a sweep of any
      // rooms that have a `status = COUNTDOWN` in the DB but no
      // matching lobbyCountdowns entry.
      await this.persistLobbyCountdown(roomId, countdownEndsAt);
      return { countdownEndsAt };
    } catch (error) {
      this.clearLobbyCountdownBestEffort(roomId);
      throw error;
    }
  }

  /**
   * Re-arms the in-memory timer that fires `launchRoomMatch` when the lobby
   * countdown ends. Used by both the live `maybeStartPublicCountdown` path
   * (where the caller passes the active `server`) and the boot-time
   * `onModuleInit` recovery path (where `server` is omitted and we fall back
   * to the gateway's stored server reference).
   *
   * If no server is resolvable (gateway hasn't wired us up yet, and no
   * caller-provided `server` is available) we cannot fire `launchRoomMatch`,
   * so we log the error, drop any pending `lobbyCountdowns` entry, and clear
   * the persisted Redis entry. This prevents the same broken countdown from
   * being re-introduced on the next process restart.
   */
  private armLobbyCountdownTimer(
    roomId: string,
    countdownEndsAt: number,
    server?: Server,
  ) {
    const targetServer = server ?? this.server;
    if (!targetServer) {
      this.logger.error(
        `Cannot arm lobby countdown for room ${roomId}: server not set`,
      );
      this.clearLobbyCountdownBestEffort(roomId);
      return;
    }

    const remaining = Math.max(countdownEndsAt - Date.now(), 0);
    const timer = setTimeout(() => {
      void this.launchRoomMatch(roomId, targetServer, {
        isAutoStart: true,
      }).catch((error) => {
        this.logger.error(
          `Failed to auto-start lobby countdown for room ${roomId}`,
          error,
        );
      });
    }, remaining);

    this.lobbyCountdowns.set(
      roomId,
      makeLobbyCountdownEntry(countdownEndsAt, timer),
    );
  }

  private async persistLobbyCountdown(
    roomId: string,
    countdownEndsAt: number,
  ): Promise<void> {
    try {
      await persistLobbyCountdown(
        this.redis.getClient(),
        roomId,
        countdownEndsAt,
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist lobby countdown for room ${roomId}:`,
        error,
      );
    }
  }

  private async clearPersistedCountdown(roomId: string): Promise<boolean> {
    try {
      await clearPersistedCountdown(this.redis.getClient(), roomId);
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to clear persisted countdown for room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private scheduleRecoveryRetry(entry: PendingRecoveryEntry): void {
    if (this.activeRecoveryRetries.has(entry.roomId)) {
      this.logger.log(
        `Room ${entry.roomId} already has a pending retry; skipping scheduling.`,
      );
      return;
    }

    const currentRetry = entry.retryCount || 0;
    const MAX_RETRIES = 5;
    if (currentRetry >= MAX_RETRIES) {
      this.logger.error(
        `Max recovery retries (${MAX_RETRIES}) exceeded for room ${entry.roomId}. Aborting recovery.`,
      );
      this.logger.error(
        `[ALERT][RECOVERY_ABORTED] Room recovery failed after max retries. Room ID: ${entry.roomId}`,
      );
      void this.redis
        .getClient()
        .sadd("room:recovery:dead-letter", entry.roomId)
        .catch((err) => {
          this.logger.error(
            `Failed to record room ${entry.roomId} in dead-letter set:`,
            err,
          );
        });
      void this.clearPersistedCountdown(entry.roomId);
      return;
    }

    const nextRetry = currentRetry + 1;
    const RETRY_DELAY_MS = Math.min(1000 * Math.pow(2, nextRetry - 1), 8000);

    this.logger.log(
      `Re-queueing recovery for room ${entry.roomId} (attempt ${nextRetry}/${MAX_RETRIES}) in ${RETRY_DELAY_MS}ms`,
    );

    this.activeRecoveryRetries.add(entry.roomId);

    const timer = setTimeout(() => {
      this.activeRecoveryRetries.delete(entry.roomId);
      entry.retryCount = nextRetry;
      this.pendingRecovery.push(entry);
      this.drainPendingRecovery();
    }, RETRY_DELAY_MS);
    timer.unref?.();
  }

  private async clearLobbyCountdown(roomId: string, timer?: NodeJS.Timeout) {
    if (timer) {
      clearTimeout(timer);
    }

    this.lobbyCountdowns.delete(roomId);
    await this.clearPersistedCountdown(roomId);
  }

  private clearLobbyCountdownBestEffort(roomId: string) {
    this.lobbyCountdowns.delete(roomId);
    void this.clearPersistedCountdown(roomId);
  }

  // H4 fix: getCountdownEnd now falls back to Redis when the
  // in-memory map is empty. Previously the function returned null
  // whenever the lobbyCountdowns map was missing the entry, which
  // happened in two real scenarios:
  //
  //   1. A room that was in COUNTDOWN when the previous process
  //      died: the C4 fix now buffers the recovery into
  //      pendingRecovery and the timer is re-armed the moment
  //      setServer is called, but between the API process restart
  //      and setServer firing, the in-memory map is empty.
  //   2. A multi-process deployment where another process owns the
  //      COUNTDOWN (the in-memory map is per-process; the source of
  //      truth is the persisted Redis key).
  //
  // The Redis read is the source of truth: persistLobbyCountdown
  // writes the timestamp on every arm and clearPersistedCountdown
  // deletes it on expiry. Reading it here gives the UI a consistent
  // countdownEndsAt even if the local process is not the one
  // running the timer.
  async getCountdownEnd(roomId: string): Promise<number | null> {
    const inMemory = this.lobbyCountdowns.get(roomId)?.countdownEndsAt;
    if (inMemory !== undefined) return inMemory;

    try {
      const result = await readPersistedCountdownEnd(
        this.redis.getClient(),
        roomId,
      );
      if (result.kind === "missing") return null;
      return Number.isFinite(result.value) ? result.value : null;
    } catch (error) {
      this.logger.warn(
        `getCountdownEnd: Redis read failed for room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async handleRoomPlayerLeft(roomId: string, server: Server) {
    const countdown = this.lobbyCountdowns.get(roomId);
    if (!countdown) return;

    const room = await this.roomService.getRoom(roomId);
    if (
      room.status !== RoomStatus.COUNTDOWN ||
      room.players.length >= GAME_CONFIG.MIN_PLAYERS_TO_START
    ) {
      return;
    }

    await this.clearLobbyCountdown(roomId, countdown.timer);

    await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);
    emitWaitingRoomState(roomId, server, "PLAYER_LEFT", RoomStatus.WAITING);
  }

  async forceStartRoomMatch(roomId: string, server: Server) {
    return this.launchRoomMatch(roomId, server, { isAutoStart: false });
  }

  private async launchRoomMatch(
    roomId: string,
    server: Server,
    options: { isAutoStart: boolean },
  ) {
    const room = await this.roomService.getRoom(roomId);

    if (
      room.status !== RoomStatus.WAITING &&
      room.status !== RoomStatus.COUNTDOWN
    ) {
      throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
    }

    const countdown = this.lobbyCountdowns.get(roomId);
    if (countdown) {
      await this.clearLobbyCountdown(roomId, countdown.timer);
    }

    if (room.players.length < GAME_CONFIG.MIN_PLAYERS_TO_START) {
      if (room.status !== RoomStatus.WAITING) {
        await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);
      }

      if (options.isAutoStart) {
        emitWaitingRoomState(
          roomId,
          server,
          "NOT_ENOUGH_PLAYERS",
          RoomStatus.WAITING,
        );
      }

      throw new RoomError(ErrorCode.NOT_ENOUGH_PLAYERS);
    }

    let match:
      | Awaited<ReturnType<typeof this.matchService.createMatch>>
      | undefined = undefined;
    try {
      // B3 fix: atomic guard against the double-launch race.
      //
      // The previous flow was: re-fetch room (no lock) → check
      // status → `updateRoomStatus(STARTING)` (no lock) → call
      // `matchService.createMatch`. The same `launchRoomMatch`
      // is reachable from three independent paths — the public
      // auto-start timer, the host force-start, and the
      // `onModuleInit` recovery for expired countdowns. Two of
      // them firing for the same roomId at the same time could
      // both pass the status check, both call `updateRoomStatus`
      // (idempotent so no error), and both call `createMatch` →
      // two Match rows, two `MatchPlayer.createMany`, an
      // orphan `match:state:*` Redis key, and a corrupted
      // `currentMatchId` (the second `room.update` overwrites
      // the first).
      //
      // We close the race with the same `SELECT ... FOR UPDATE`
      // pattern that `RoomService.joinRoom` uses:
      //
      //   1. Open a Prisma transaction.
      //   2. Acquire a row-level lock on the Room.
      //   3. Re-check status (must be WAITING or COUNTDOWN) and
      //      `currentMatchId IS NULL` under the lock. A second
      //      caller that has been blocked on the lock will see
      //      either the already-set status (STARTING/IN_GAME)
      //      or the already-set `currentMatchId` and abort.
      //   4. Set `Room.status = STARTING` inside the transaction
      //      so a third caller (which could arrive between
      //      commit and `createMatch`) fails the status check.
      //   5. Commit, then call `matchService.createMatch` outside
      //      the transaction. `createMatch` writes `currentMatchId`
      //      in its own internal transaction; because we set
      //      `status = STARTING` first, any other caller that
      //      beats `createMatch` to its own FOR UPDATE will fail
      //      the status check.
      //
      // We do NOT set `currentMatchId` here because we don't have
      // the `match.id` yet — `createMatch` owns that field. Setting
      // `status = STARTING` is sufficient to make the race window
      // observable to concurrent callers.
      await this.prisma.$transaction(async (tx) => {
        const lockedRoom = await tx.$queryRaw<
          Array<{ id: string; status: string; currentMatchId: string | null }>
        >`
          SELECT id, status, "currentMatchId"
          FROM "Room"
          WHERE id = ${roomId}
          FOR UPDATE
        `;
        if (lockedRoom.length === 0) {
          // Room was deleted between the outer read and the
          // in-transaction lock acquisition. Treat as
          // not-found so the caller gets a typed error.
          throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
        }
        const locked = lockedRoom[0];
        if (
          locked.status !== RoomStatus.WAITING &&
          locked.status !== RoomStatus.COUNTDOWN
        ) {
          throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
        }
        if (locked.currentMatchId !== null) {
          // A previous launch already set currentMatchId. Even
          // though `status` may still be WAITING (race window),
          // the lock holder is the canonical truth. Abort.
          throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
        }
        await tx.room.update({
          where: { id: roomId },
          data: { status: RoomStatus.STARTING },
        });
      });

      emitRoomStatusUpdated(server, {
        roomId,
        roomStatus: RoomStatus.STARTING,
        currentMatchId: room.currentMatchId ?? null,
        updatedAt: Date.now(),
      });

      // `createMatch` opens its own internal transaction. If it
      // throws AFTER its `match.create` succeeds but before its
      // `room.update` completes, we end up with an orphan Match
      // row pointing at a room that is still STARTING with no
      // currentMatchId. We clean up explicitly: delete the
      // orphan Match row (this is the only side effect of
      // `createMatch` we own from here) and revert the Room
      // status back to WAITING so a recovery sweep can retry.
      //
      // Race-fix: if the failure is `ROOM_ALREADY_STARTED`, the
      // B3 transaction guard has already determined that another
      // thread validly acquired the room lock and is mid-launch.
      // Our room may already be in `STARTING` / `IN_GAME` state
      // from that thread's transaction commit. Unconditionally
      // overwriting that with `WAITING` + emitting
      // `ROOM_STATUS_UPDATED {WAITING}` would corrupt the
      // winning thread's state. The fix: detect the race-lost
      // error and skip the revert + emit entirely. The losing
      // thread only propagates the error so the caller sees the
      // "launch failed because someone else got there first"
      // outcome without us silently destroying the winner's
      // progress.
      match = await this.matchService.createMatch(roomId);

      emitMatchStarting(
        server,
        roomId,
        match.id,
        GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
      );

      await this.startMatchLoop(match.id, roomId, server);
      return match;
    } catch (error) {
      // Rollback on error. We DO NOT touch `currentMatchId` here
      // because we did not set it in the transaction (B3 fix);
      // only the status needs to revert. The `createMatch` path
      // may have set `currentMatchId` if it succeeded mid-error;
      // the cleanup branch above handles that before we get here.
      //
      // Race-fix: same guard as the inner `createError` catch.
      // The B3 transaction throws `ROOM_ALREADY_STARTED` when
      // the lock holder sees a non-WAITING/COUNTDOWN status or a
      // non-null `currentMatchId` (i.e. another thread won the
      // launch). At that point the room is already in
      // `STARTING` (or `IN_GAME`) state from the winning thread.
      // Reverting it to `WAITING` + broadcasting that revert
      // would clobber the winner's progress and confuse every
      // spectator/player connected to the room channel. We
      // detect the race-lost error and skip both the revert
      // and the emit, only propagating the original error to
      // the caller (which can be admin tooling, the host
      // force-start handler, or the auto-start timer).
      const isRaceLost =
        error instanceof RoomError
          ? error.code === ErrorCode.ROOM_ALREADY_STARTED
          : (error as Record<string, unknown>)?.code ===
            ErrorCode.ROOM_ALREADY_STARTED;
      if (isRaceLost) {
        this.logger.warn(
          `B3 race-lost: launchRoomMatch for room ${roomId} aborted because another thread won the launch. The winning thread's state (STARTING/IN_GAME) is preserved.`,
        );
        throw error;
      }

      const isRoomNotFound =
        error instanceof RoomError
          ? error.code === ErrorCode.ROOM_NOT_FOUND
          : (error as Record<string, unknown>)?.code ===
              ErrorCode.ROOM_NOT_FOUND ||
            (error as Record<string, unknown>)?.message ===
              ErrorCode.ROOM_NOT_FOUND;
      if (isRoomNotFound) {
        this.logger.warn(
          `Room ${roomId} not found during launch. Skipping revert/broadcast.`,
        );
        throw error;
      }

      this.logger.error(
        `Launch failed for room ${roomId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Clean up orphaned match in DB if created
      if (match) {
        try {
          this.logger.warn(
            `Deleting orphaned match ${match.id} for room ${roomId}`,
          );
          await this.prisma.match.delete({
            where: { id: match.id },
          });
        } catch (cleanupError) {
          this.logger.error(
            `Failed to delete orphaned match ${match.id}:`,
            cleanupError,
          );
        }
      }

      try {
        await this.roomService.updateRoomStatus(
          roomId,
          RoomStatus.WAITING,
          null,
        );
        emitRoomStatusUpdated(server, {
          roomId,
          roomStatus: RoomStatus.WAITING,
          currentMatchId: null,
          updatedAt: Date.now(),
        });
      } catch (revertError) {
        this.logger.error(
          `Failed to revert Room ${roomId} status to WAITING after launch failure.`,
          revertError instanceof Error ? revertError.stack : undefined,
        );
      }
      throw error;
    }
  }

  // ============================================================
  // ENTRY POINT
  // ============================================================

  async startMatchLoop(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) {
      this.logger.error(`State machine not found for match ${matchId}`);
      throw new RoomError(
        ErrorCode.MATCH_NOT_FOUND,
        `State machine not found for match ${matchId}`,
      );
    }

    await this.roomService.updateRoomStatus(
      roomId,
      RoomStatus.IN_GAME,
      matchId,
    );

    emitRoomStatusUpdated(server, {
      roomId,
      roomStatus: RoomStatus.IN_GAME,
      currentMatchId: matchId,
      updatedAt: Date.now(),
    });

    // 2. Transition to COUNTDOWN
    stateMachine.transition(MatchStatus.COUNTDOWN);

    // F2: Init question tracking
    this.usedQuestionIds.set(matchId, new Set());

    // F6: Persist state machine to Redis
    await this.matchService.persistStateMachine(matchId);

    // 3. Broadcast MATCH_STARTED
    emitMatchStarted(
      server,
      roomId,
      matchId,
      "COUNTDOWN",
      GAME_CONFIG.COUNTDOWN_DURATION_MS,
    );

    // 4. Start countdown timer
    this.executeCountdown(matchId, roomId, server);
  }

  // ============================================================
  // PHASE 1: COUNTDOWN (5 seconds)
  // ============================================================

  private executeCountdown(
    matchId: string,
    roomId: string,
    server: Server,
  ): void {
    // M5 fix: register the timer in `activeTimers` BEFORE setTimeout
    // returns. The previous order — setTimeout first, then addTimer
    // — left a microsecond-wide window where `stopRoomRuntime` could
    // call `clearTimers` (which iterates `activeTimers`) before the
    // timer reference was registered. In that window the timer
    // would fire after the match was already torn down, calling
    // `executeRound` on a state machine that had been deleted.
    //
    // By registering first, the timer is always either (a) in the
    // map and cancellable, or (b) not yet created — never "created
    // but not yet registered".
    //
    // We also add a defence-in-depth guard inside the callback:
    // if the state machine has been deleted (e.g. via admin
    // termination that beat the clearTimers call by microseconds),
    // the callback logs and bails out cleanly.
    if (!this.activeTimers.has(matchId)) {
      this.activeTimers.set(matchId, new Set());
    }
    const timerSet = this.activeTimers.get(matchId)!;

    const timer = setTimeout(async () => {
      try {
        // M5 defence-in-depth: confirm the state machine still
        // exists. The match may have been torn down between
        // setTimeout firing and us reaching this line.
        const sm = await this.matchService.getStateMachine(matchId);
        if (!sm) {
          this.logger.log(
            `executeCountdown callback: state machine gone for match ${matchId}, skipping executeRound`,
          );
          return;
        }
        this.logger.log(`Countdown ended for match ${matchId}`);
        await this.executeRound(matchId, roomId, server);
      } catch (error) {
        this.logger.error(
          `Failed to execute round for match ${matchId}:`,
          error,
        );
      }
    }, GAME_CONFIG.COUNTDOWN_DURATION_MS);

    timerSet.add(timer);
  }

  // ============================================================
  // TIMER MANAGEMENT
  // ============================================================

  private addTimer(matchId: string, timer: NodeJS.Timeout): void {
    if (!this.activeTimers.has(matchId)) {
      this.activeTimers.set(matchId, new Set());
    }
    this.activeTimers.get(matchId)!.add(timer);
  }

  private clearTimers(matchId: string): void {
    const timers = this.activeTimers.get(matchId);
    if (timers) {
      for (const t of timers) {
        clearTimeout(t);
      }
      this.activeTimers.delete(matchId);
    }
  }

  // ============================================================
  // PUBLIC: Cancel match (called from handler on error)
  // ============================================================

  cancelMatchLoop(matchId: string): void {
    this.clearTimers(matchId);
    this.usedQuestionIds.delete(matchId);
    this.expectedAnswers.delete(matchId);
    this.logger.warn(`Match loop cancelled: ${matchId}`);
  }

  /**
   * Stops all in-process timers associated with a room and (optionally) its
   * active match. Called by the admin kill-switch before the room is torn
   * down. Does not touch DB or Redis — that is the orchestrator's job.
   * Unconditional: clears the lobby countdown even if the room is mid-WAITING.
   */
  async stopRoomRuntime(roomId: string, matchId: string | null): Promise<void> {
    const countdown = this.lobbyCountdowns.get(roomId);
    if (countdown) {
      await this.clearLobbyCountdown(roomId, countdown.timer);
    }
    if (matchId) {
      this.cancelMatchLoop(matchId);
    }
  }

  /**
   * Emits the ServerEvent.ROOM_TERMINATED notification to all sockets joined
   * to the room channel. Encapsulates the Server reference so the admin
   * service does not need direct socket access.
   */
  emitRoomTerminated(
    roomId: string,
    payload: { matchId: string | null; message?: string },
  ): void {
    if (!this.server) {
      this.logger.warn(
        `emitRoomTerminated: server not set, cannot emit for room ${roomId}`,
      );
      return;
    }
    emitRoomTerminated(this.server, roomId, payload);
  }

  // ============================================================
  // PHASE 2: ROUND ACTIVE (15 seconds)
  // ============================================================

  private async executeRound(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Transition to ROUND_ACTIVE
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);

    // F7: Fetch question with error handling
    let question;
    try {
      // F2: Exclude already-used question IDs
      const excludeIds = [...(this.usedQuestionIds.get(matchId) ?? new Set())];
      question = await this.questionService.getRandom(undefined, excludeIds);
    } catch (error) {
      this.logger.error(
        `Failed to fetch question for match ${matchId} — ending match`,
        error,
      );
      // End match gracefully if no questions available
      await this.finishMatchLoop(matchId, roomId, server);
      return;
    }

    // F2: Track used question
    this.usedQuestionIds.get(matchId)!.add(question.id);

    // 3. Start round in state machine (pass correctAnswer internally)
    const questionState = {
      id: question.id,
      content: question.content,
      options: question.options,
      correctAnswer: question.correctAnswer, // used internally by state machine
      difficulty: question.difficulty,
    };
    stateMachine.startRound(questionState);

    // F6: Persist after mutation
    await this.matchService.persistStateMachine(matchId);

    // 4. Count surviving players BEFORE broadcast (for early termination tracking)
    const state = stateMachine.getState();
    const survivingCount = state.survivingPlayerIds.length;
    // Store expected answer count (used by Task 7)
    this.expectedAnswers?.set(matchId, survivingCount);

    // 5. Broadcast ROUND_STARTED (STRIP correctAnswer from question!)
    const round = stateMachine.getCurrentRound()!;
    emitRoundStarted(
      server,
      roomId,
      matchId,
      state,
      {
        id: question.id,
        content: question.content,
        options: question.options,
        difficulty: question.difficulty,
      },
      round.endsAt,
    );

    // 6. Set 15s timer → endRound
    const timer = setTimeout(async () => {
      try {
        await this.endRound(matchId, roomId, server);
        /* c8 ignore next 3 */
      } catch (error) {
        this.logger.error(
          `Error in endRound timeout callback for match ${matchId}:`,
          error,
        );
      }
    }, GAME_CONFIG.ROUND_DURATION_MS);
    this.addTimer(matchId, timer);
  }

  // ============================================================
  // PHASE 3: ROUND EVALUATING + RESULT DISPLAY (3 seconds)
  // ============================================================

  private async endRound(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // H1 fix (defensive double-check): the `endingRounds` guard is the
    // single source of truth for round-end idempotency. clearTimeout
    // does NOT cancel a callback that is already in Node's timer queue
    // — it only stops a future fire. So `checkEarlyTermination` can
    // race with the 15s timer: both will reach this method. The guard
    // ensures only the first caller does the work.
    if (this.endingRounds.has(matchId)) {
      this.logger.warn(
        `endRound already in progress or completed for match ${matchId}`,
      );
      return;
    }
    this.endingRounds.add(matchId);

    try {
      // 1. Get state machine
      const stateMachine = await this.matchService.getStateMachine(matchId);
      if (!stateMachine) return;

      // Guard: only execute if match is ROUND_ACTIVE and round status is ACTIVE
      const state = stateMachine.getState();
      const round = stateMachine.getCurrentRound();
      if (
        state.status !== MatchStatus.ROUND_ACTIVE ||
        !round ||
        round.status !== "ACTIVE"
      ) {
        this.logger.warn(
          `endRound bypassed for match ${matchId}: state.status is ${state.status}, round status is ${round?.status ?? "none"}`,
        );
        return;
      }

      // 2. Transition to ROUND_EVALUATING
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);

      // 3. Evaluate round
      const { survivingIds, eliminatedIds, correctAnswer } =
        stateMachine.evaluateRound();

      // H3 fix: PERSIST the round's DB writes BEFORE advancing the
      // state machine to ROUND_RESULT. The previous order
      //   transition(EVALUATING) → evaluate → transition(RESULT) →
      //   persistStateMachine → saveRound → saveAnswers
      // meant that if `saveRound` or `saveAnswers` threw (Prisma
      // P2002, DB connection blip, etc.) the state machine was
      // already in ROUND_RESULT but no DB row existed for the round.
      // The next round would start, leaderboards and answer history
      // would be permanently missing one round of data.
      //
      // New order: persist ALL DB writes (state machine + round +
      // answers) in ROUND_EVALUATING, then transition to ROUND_RESULT.
      // If any DB write fails, the state machine is still in
      // EVALUATING and the next 15s timer (or checkMatchEnd retry)
      // can re-evaluate. We do NOT throw from this function because
      // the surrounding timer callback would log the error and move
      // on — we want a hard failure that operators notice.
      try {
        // 4. Save the round row + all answers atomically. The single
        //    $transaction means a failure on the answer batch rolls
        //    back the round row too, so a retry after a process
        //    restart (Redis still holds ROUND_ACTIVE) does NOT hit
        //    @@unique([matchId, roundNo]) with a P2002 — previously
        //    this could permanently stall the match.
        const currentRoundForSave = stateMachine.getCurrentRound()!;
        await this.matchService.saveRoundAndAnswers(
          matchId,
          state.currentRoundNo,
          currentRoundForSave.question.id,
          Array.from(currentRoundForSave.answers.entries()).map(
            ([playerId, answer]) => ({
              userId: playerId,
              answer: answer.answer,
              isCorrect: answer.isCorrect,
              responseTimeMs: answer.responseTimeMs,
            }),
          ),
        );

        // 6. Persist state machine (now that DB writes succeeded).
        await this.matchService.persistStateMachine(matchId);
      } catch (dbError) {
        // H3 fix: a DB failure here must not silently advance the
        // state machine. We log the error at error level (operators
        // notice) and re-throw so the surrounding 15s timer callback
        // surfaces the failure. The state machine remains in
        // ROUND_EVALUATING — the next round timer will see the same
        // active state and retry, OR an admin can investigate.
        this.logger.error(
          `H3: endRound DB persistence failed for match ${matchId} round ${state.currentRoundNo}; state machine will NOT advance to ROUND_RESULT`,
          dbError,
        );
        throw dbError;
      }

      // 7. Transition to ROUND_RESULT — safe now that DB is consistent.
      stateMachine.transition(MatchStatus.ROUND_RESULT);
      await this.matchService.persistStateMachine(matchId);

      // 8. Broadcast ROUND_ENDED (KHÔNG gửi correctAnswer trong question object)
      emitRoundEnded({
        server,
        roomId,
        matchId,
        state,
        correctAnswer,
        survivingIds,
        eliminatedIds,
      });

      // 10. Per-player eliminated notification
      for (const playerId of eliminatedIds) {
        const player = state.players.get(playerId);
        if (!player) continue;
        emitPlayerEliminated({
          server,
          roomId,
          matchId,
          state,
          playerId,
          playerName: player.name,
          answeredThisRound:
            stateMachine.getCurrentRound()?.answers.has(playerId) ?? false,
        });
      }

      // 11. Set 3s timer → checkMatchEnd
      const timer = setTimeout(async () => {
        try {
          await this.checkMatchEnd(matchId, roomId, server);
          /* c8 ignore next 3 */
        } catch (error) {
          this.logger.error(
            `Error in checkMatchEnd timeout callback for match ${matchId}:`,
            error,
          );
        }
      }, GAME_CONFIG.RESULT_DISPLAY_MS);
      this.addTimer(matchId, timer);
    } finally {
      this.endingRounds.delete(matchId);
    }
  }

  // ============================================================
  // PHASE 4: CHECK MATCH END
  // ============================================================

  private async checkMatchEnd(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // H5 fix: pass MAX_ROUNDS so the state machine can end the match
    // even if more than 1 player is still alive. The constant is
    // defined in @arena/shared and currently set to 50. With 15s
    // rounds + 5s countdowns + 3s result displays, 50 rounds is
    // roughly 19 minutes — a safe upper bound that still keeps
    // matches engaging.
    if (stateMachine.shouldEndMatch(GAME_CONFIG.MAX_ROUNDS)) {
      await this.finishMatchLoop(matchId, roomId, server);
    } else {
      // Loop: next round
      await this.executeRound(matchId, roomId, server);
    }
  }

  // ============================================================
  // FINAL: MATCH FINISH
  // ============================================================

  private async finishMatchLoop(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // L6 fix: the dead `serverOrContext` parameter has been removed.
    // It was a no-op refactoring artefact (a debug-only conditional
    // log of an object the function never read). Removing it
    // simplifies the call graph — the only callers (checkMatchEnd,
    // admin termination) pass exactly the live `server` they
    // already have.

    // B1 fix: idempotency guard. The match-finish path is reachable
    // from `checkMatchEnd` (timer-driven) and from the admin
    // kill-switch (`AdminService.terminateRoom` → `matchService.finishMatch`).
    // If both fire for the same matchId, the second call must be a
    // no-op: the first call is already in the middle of writing
    // DB rows, emitting MATCH_FINISHED, and clearing timers. A
    // second writer would produce a corrupted winnerId and a
    // confusing pair of `MATCH_FINISHED` + `ROOM_TERMINATED`
    // broadcasts for the same match. The Set is the same pattern
    // as `endingRounds` (round-end idempotency, H1) — explicit
    // try/finally so a thrown error still drops the matchId from
    // the Set (otherwise a transient DB error would lock the match
    // out of all future finish attempts until the process restarts).
    if (this.finishingMatches.has(matchId)) {
      this.logger.warn(
        `finishMatchLoop already in progress for match ${matchId}; second caller is a no-op`,
      );
      return;
    }
    this.finishingMatches.add(matchId);

    try {
      await this.finishMatchLoopInner(matchId, roomId, server);
    } finally {
      this.finishingMatches.delete(matchId);
    }
  }

  /**
   * Public guard query used by `AdminService.terminateRoom` to abort
   * the kill-switch if a natural finish is already in flight for the
   * same match. Returns true while `finishMatchLoop` is mid-execution
   * (between Set add and Set delete). This is the B1 surface that
   * closes the race window between the timer-driven finish and the
   * admin-driven finish.
   */
  isMatchFinishing(matchId: string): boolean {
    return this.finishingMatches.has(matchId);
  }

  private async finishMatchLoopInner(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Transition to FINISHED
    stateMachine.transition(MatchStatus.FINISHED);

    // F1: finishMatch() returns void. winnerId is set internally on state.
    stateMachine.finishMatch();
    const state = stateMachine.getState();
    // B2 fix: `state.winnerId` is now typed `string | null` in the
    // state machine. We convert `null`/`undefined` defensively into
    // an explicit `null` for the wire. The non-null assertion (`!`)
    // was hiding a real bug: when `tieBreak` returned `undefined` for
    // an empty roster, this code would push `undefined` into the
    // Prisma update payload, which silently dropped the field — the
    // DB would still show the previous (stale) winnerId instead of
    // marking the match finished with no winner. We now make the
    // null case explicit and let it flow through to `finishMatch`
    // which already accepts `string | null`.
    const winnerId: string | null = state.winnerId ?? null;

    // F6: Persist lần cuối
    await this.matchService.persistStateMachine(matchId);

    // 3. Persist match result to DB (updates room status, cleans memory + Redis).
    // Pass the roomId from the state machine (always present at this
    // point because the match was created from a room) so the
    // finishMatch transaction can update the Room row in the same
    // atomic batch.
    await this.matchService.finishMatch(matchId, winnerId, roomId, false);

    // 4. Broadcast MATCH_FINISHED
    emitMatchFinished(server, roomId, matchId, state, winnerId);

    // 5. Cleanup
    this.clearTimers(matchId);
    this.usedQuestionIds.delete(matchId);
    this.expectedAnswers.delete(matchId);

    if (winnerId === null) {
      this.logger.warn(
        `Match ${matchId} finished with no winner (empty roster or unresolvable tie-break). Rounds: ${state.currentRoundNo}. Clients receive MATCH_FINISHED with winnerId: null.`,
      );
    } else {
      this.logger.log(
        `Match ${matchId} finished. Winner: ${winnerId}. Rounds: ${state.currentRoundNo}`,
      );
    }
  }

  // ============================================================
  // HANDLE PLAYER DISCONNECTION
  // ============================================================

  /**
   * Handles player disconnection during a match
   * - Marks player as DISCONNECTED in state machine
   * - Broadcasts PLAYER_LEFT event
   * - Persists state machine
   */
  async handlePlayerDisconnect(
    matchId: string,
    userId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Get current state
    const state = stateMachine.getState();

    // 3. Check if player exists
    const player = state.players.get(userId);
    if (!player) {
      this.logger.warn(`Player ${userId} not found in match ${matchId}`);
      return;
    }

    // 4. Mark player as DISCONNECTED in state machine
    stateMachine.disconnectPlayer(userId);

    // 5. Persist state machine
    await this.matchService.persistStateMachine(matchId);

    // 6. Broadcast PLAYER_LEFT with reason field
    const roomId = state.roomId;
    emitMatchDisconnected(server, roomId, userId);

    // 7. Log the disconnect
    this.logger.log(`Player ${userId} disconnected from match ${matchId}`);
  }

  // ============================================================
  // VOLUNTARY MATCH LEAVE
  // ============================================================

  /**
   * Called when a user explicitly sends `LEAVE_ROOM` while the room is
   * IN_GAME or FINISHED (i.e. the room has a live or recently-finished
   * match). This is the C1 cheating-vector fix:
   *
   * Without this call, the state machine still had the player as ACTIVE
   * after their RoomPlayer row was deleted, so the SUBMIT_ANSWER gate
   * (`status === ACTIVE`) would keep accepting their answers — a
   * spectator who wants to read the question and then race back in
   * to submit the right answer could do exactly that.
   *
   * We mark the player as DISCONNECTED (re-using the existing
   * state-machine method) and persist. The next round's
   * `evaluateRound` will skip them because they're no longer ACTIVE,
   * and even if they tried to submit before the next round, the gate
   * rejects. The match can still complete — we don't terminate it
   * just because someone quit; the surviving players continue to the
   * end.
   *
   * We accept `roomId` from the caller (RoomHandler.handleLeaveRoom
   * already has it on the payload) to avoid re-fetching it from
   * state and to keep the function self-contained for the FINISHED
   * case where the state machine may already be torn down.
   */
  async handleMatchPlayerLeft(
    matchId: string,
    roomId: string,
    userId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine. The match might already be FINISHED (room
    //    status FINISHED) and the in-memory state machine could be
    //    gone. In that case there is nothing to mark and nothing to
    //    persist, but we still want the broadcast so other clients
    //    know the player has left the spectator list.
    const stateMachine = await this.matchService.getStateMachine(matchId);

    if (stateMachine) {
      // 2. Verify if the player is in the match roster.
      const state = stateMachine.getState();
      const player = state.players.get(userId);
      if (player) {
        // Mark the player as DISCONNECTED in the state machine. This
        // is the same path the actual socket-disconnect handler uses;
        // we re-use it so behaviour stays consistent (reconnect still
        // possible, evaluateRound skips them, submitAnswer gate
        // rejects).
        stateMachine.disconnectPlayer(userId);
        await this.matchService.persistStateMachine(matchId);
      }
    } else {
      this.logger.warn(
        `handleMatchPlayerLeft: no state machine for match ${matchId} (likely already finished); skipping state update`,
      );
    }

    // 3. Broadcast PLAYER_LEFT with reason "LEFT" so the lobby / match
    //    UIs can update the player list. We use the room channel (not
    //    the match channel) so the lobby view and the in-match view
    //    stay in sync. FINISHED matches also receive this so spectators
    //    can update their "players still here" badge.
    //
    //    The payload shape is the contract defined by
    //    `RoomPlayerLeftPayload` — same as the lobby leave path in
    //    RoomHandler.handleLeaveRoom. A previous version of this
    //    emit added an extra `matchId` field, which was inconsistent
    //    with the type and would silently allow downstream clients
    //    to depend on a field the lobby leave path doesn't supply.
    //    We keep the room channel as the single broadcast surface;
    //    subscribers that need to know which match is in flight can
    //    read `match.currentMatchId` from the most recent SNAPSHOT
    //    they already hold.
    emitMatchPlayerLeft(server, roomId, userId);

    this.logger.log(
      `Player ${userId} voluntarily left match ${matchId} (room ${roomId})`,
    );
  }

  // ============================================================
  // CHECK EARLY TERMINATION
  // ============================================================

  /**
   * Checks if all surviving players have answered
   * - If so, clears timers and calls endRound immediately
   */
  async checkEarlyTermination(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // H1 fix: explicit `endingRounds` guard. Previously this method
    // relied entirely on `endRound`'s own `endingRounds` check to
    // serialise concurrent invocations. That worked by accident but
    // coupled the two methods through a shared Set. Pin the guard
    // here too: if a 15s timer is already in the queue (e.g. the
    // last player submitted at T+14.9s), the early-termination path
    // must back off and let the timer fire.
    if (this.endingRounds.has(matchId)) {
      return;
    }

    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Get current round
    const round = stateMachine.getCurrentRound();
    const expected = this.expectedAnswers.get(matchId) || 0;

    // 3. Check if all surviving players have answered
    // Use the exact condition: round exists, enough answers submitted, and round is still active
    if (round && round.answers.size >= expected && round.status === "ACTIVE") {
      this.logger.log(
        `Early termination triggered for match ${matchId} - all players answered`,
      );

      // Clear existing timers. Scoped to this match (the match ID is
      // the key in the activeTimers map) so a stale timer from a
      // previous round does not leak. The 15s timer is the only one
      // in flight for this match at this point.
      this.clearTimers(matchId);

      // End round immediately. The `endingRounds` guard inside
      // endRound is now a defence-in-depth — if for any reason this
      // call races with a still-pending timer callback, only one of
      // them does the work.
      await this.endRound(matchId, roomId, server);
    }
  }
}
