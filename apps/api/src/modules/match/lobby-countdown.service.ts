// ============================================================
// LobbyCountdownService — pre-match lobby countdown lifecycle
//
// Extracted from GameLoopService. Owns everything that happens
// BEFORE a match loop starts:
//   - the public-room auto-start countdown (maybeStartPublicCountdown)
//   - persisting the countdown to Redis so a process restart can
//     recover it (boot-time recovery in onModuleInit)
//   - the pending-recovery buffer + exponential-backoff retry +
//     dead-letter handling
//   - clearing a countdown when a match launches or a room is torn down
//
// It does NOT run the match loop. When a countdown expires (or a
// recovered countdown must fire) it calls back into GameLoopService via
// the launcher registered with `setLauncher`. GameLoopService owns this
// instance directly and wires the callback in its constructor, so there
// is no bidirectional DI (no forwardRef needed).
// ============================================================

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Server } from "socket.io";
import {
  GAME_CONFIG,
  RoomStatus,
  ServerEvent,
  getRoomChannel,
} from "@arena/shared";
import { RoomService } from "../room/room.service";
import { RedisService } from "../redis/redis.service";
import type {
  LobbyCountdownEntry,
  PendingRecoveryEntry,
} from "./game-loop.types";
import {
  emitRoomStatusUpdated,
  emitWaitingRoomState,
  makeLobbyCountdownEntry,
  makePendingRecoveryEntry,
} from "./game-loop.helpers";
import {
  clearPersistedCountdown,
  listPersistedCountdownRoomIds,
  persistLobbyCountdown,
  readPersistedCountdownEnd,
  removeStaleCountdownIndexEntry,
} from "./game-loop.countdown-store";

/** Fired when a countdown expires and the match must be launched. */
export type LobbyLauncher = (
  roomId: string,
  server: Server,
) => Promise<unknown>;

@Injectable()
export class LobbyCountdownService implements OnModuleInit {
  private readonly logger = new Logger(LobbyCountdownService.name);
  private lobbyCountdowns = new Map<string, LobbyCountdownEntry>();
  private server?: Server;
  private recoveryInFlight = false;
  // C4 fix: when onModuleInit runs before setServer has been called
  // (the WebSocket gateway's afterInit hook fires after onModuleInit),
  // recovered countdowns are buffered here so the room is not silently
  // stuck in COUNTDOWN forever. As soon as setServer is invoked we drain
  // the buffer and re-arm the timers.
  private pendingRecovery: PendingRecoveryEntry[] = [];
  private activeRecoveryRetries = new Set<string>();
  private launch: LobbyLauncher = async () => undefined;

  constructor(
    private readonly roomService: RoomService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Register the callback used to launch a match when a countdown
   * expires. GameLoopService wires this to its own `launchRoomMatch`.
   */
  setLauncher(launch: LobbyLauncher): void {
    this.launch = launch;
  }

  /**
   * Inject the Socket.io server so we can recover lobby countdowns on
   * boot (the in-memory timer map does not survive a process restart,
   * but the persisted Redis state does). Drains any buffered recovery.
   */
  setServer(server: Server): void {
    this.server = server;
    this.drainPendingRecovery();
  }

  /**
   * Drains the pendingRecovery buffer. Called from setServer as soon as
   * the WebSocket gateway hands us a live server reference. We replay
   * each buffered countdown through the same logic the live path uses.
   *
   * Idempotent: armLobbyCountdownTimer and launch are no-ops if a
   * countdown for the room is already in lobbyCountdowns.
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
            return this.launch(entry.roomId, this.server!);
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
   * previous process died. For each one whose `countdownEndsAt` is still
   * in the future, re-arm a timer to launch the match. For those that
   * have already expired, immediately launch the match (best-effort).
   */
  async onModuleInit() {
    if (process.env.NODE_ENV !== "test") {
      void this.sweepDeadLetterRooms();
    }

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
            // C4 fix: if the Socket.io server is not wired up yet (the
            // gateway's afterInit hook runs AFTER onModuleInit), DO NOT
            // silently clear the persisted entry — buffer the recovery;
            // setServer() will drain the buffer once the server exists.
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
              void this.launch(roomId, this.server).catch((error) => {
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
            // C4 fix: armLobbyCountdownTimer requires a server. If the
            // gateway hasn't wired us up yet, buffer the entry instead
            // of dropping the Redis key.
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
      // If the persist fails, the room is in COUNTDOWN with a live
      // in-memory timer but no Redis recovery entry. Roll back to
      // WAITING so the room isn't stuck in COUNTDOWN with no timer and
      // no recovery path if the process dies before the timer fires.
      try {
        await this.persistLobbyCountdown(roomId, countdownEndsAt);
      } catch (persistError) {
        this.clearLobbyCountdownBestEffort(roomId);
        try {
          await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);
          emitRoomStatusUpdated(server, {
            roomId,
            roomStatus: RoomStatus.WAITING,
            currentMatchId: null,
            updatedAt: Date.now(),
          });
        } catch (rollbackError) {
          this.logger.error(
            `Failed to roll back room ${roomId} to WAITING after countdown persist failure:`,
            rollbackError,
          );
        }
        throw persistError;
      }
      return { countdownEndsAt };
    } catch (error) {
      this.clearLobbyCountdownBestEffort(roomId);
      throw error;
    }
  }

  /**
   * Re-arms the in-memory timer that fires the launcher when the lobby
   * countdown ends. Used by both the live `maybeStartPublicCountdown`
   * path and the boot-time recovery path. If no server is resolvable we
   * cannot fire the launcher, so we drop the countdown entry and clear
   * the persisted Redis entry to avoid re-introducing a broken countdown
   * on the next restart.
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
      void this.launch(roomId, targetServer).catch((error) => {
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
    await persistLobbyCountdown(
      this.redis.getClient(),
      roomId,
      countdownEndsAt,
    );
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

  private async sweepDeadLetterRooms(): Promise<void> {
    try {
      const client = this.redis.getClient();
      const roomIds = await client.smembers("room:recovery:dead-letter");
      if (!roomIds || roomIds.length === 0) return;

      this.logger.log(
        `Sweeping ${roomIds.length} dead-letter room(s) from Redis...`,
      );
      for (const roomId of roomIds) {
        const exists = await client.exists(
          `room:recovery:dead-letter:${roomId}`,
        );
        if (exists === 0) {
          this.logger.log(
            `Removing expired dead-letter room ${roomId} from set`,
          );
          await client.srem("room:recovery:dead-letter", roomId);
        }
      }
    } catch (error) {
      this.logger.error("Failed to sweep dead-letter rooms:", error);
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
      const client = this.redis.getClient();
      void client
        .sadd("room:recovery:dead-letter", entry.roomId)
        .then(() => {
          return client.set(
            `room:recovery:dead-letter:${entry.roomId}`,
            "1",
            "EX",
            604800, // 7 days TTL retention
          );
        })
        .catch((err) => {
          this.logger.error(
            `Failed to record room ${entry.roomId} in dead-letter set:`,
            err,
          );
        });
      // Roll the room back to WAITING so it isn't stuck in COUNTDOWN with
      // no live timer. Guard against rolling back a room that has already
      // transitioned past the unstarted countdown (only reset when still
      // status=COUNTDOWN and no currentMatchId); otherwise skip the
      // status change and only clear the stale persisted countdown.
      void this.roomService
        .updateRoomStatus(entry.roomId, RoomStatus.WAITING, null, {
          expectedStatus: RoomStatus.COUNTDOWN,
          expectedCurrentMatchId: null,
        })
        .then((room) => {
          if (!room) {
            this.logger.warn(
              `Skipping WAITING rollback for room ${entry.roomId}: room is already active or the countdown was cleared; only clearing persisted countdown`,
            );
            void this.clearPersistedCountdown(entry.roomId);
            return;
          }

          if (this.server) {
            emitRoomStatusUpdated(this.server, {
              roomId: entry.roomId,
              roomStatus: RoomStatus.WAITING,
              currentMatchId: null,
              updatedAt: Date.now(),
            });
          }

          void this.clearPersistedCountdown(entry.roomId);
        })
        .catch((err) => {
          this.logger.error(
            `Failed to roll back Room ${entry.roomId} status to WAITING after recovery abort:`,
            err,
          );
        });
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
    const entry = this.lobbyCountdowns.get(roomId);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    this.lobbyCountdowns.delete(roomId);
    void this.clearPersistedCountdown(roomId);
  }

  /**
   * Clear any lobby countdown for a room (timer + in-memory entry +
   * persisted Redis key). Used by GameLoopService when a match launches
   * or a room is torn down. No-op if there is no countdown.
   */
  async clearCountdown(roomId: string): Promise<void> {
    const countdown = this.lobbyCountdowns.get(roomId);
    if (countdown) {
      await this.clearLobbyCountdown(roomId, countdown.timer);
    }
  }

  // H4 fix: getCountdownEnd falls back to Redis when the in-memory map
  // is empty (process restarted before setServer re-armed the timer, or
  // a multi-process deployment where another process owns the COUNTDOWN).
  // The Redis read is the source of truth.
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

  async handleRoomPlayerLeft(
    roomId: string,
    server: Server,
    leavingPlayerIds: string[] = [],
  ) {
    const countdown = this.lobbyCountdowns.get(roomId);
    if (!countdown) return;

    const room = await this.roomService.getRoom(roomId);
    const leavingPlayerIdsSet = new Set(leavingPlayerIds);
    const remainingPlayersCount = room.players.filter(
      (p) => !leavingPlayerIdsSet.has(p.userId),
    ).length;

    if (
      room.status !== RoomStatus.COUNTDOWN ||
      remainingPlayersCount >= GAME_CONFIG.MIN_PLAYERS_TO_START
    ) {
      return;
    }

    await this.clearLobbyCountdown(roomId, countdown.timer);

    await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);
    emitWaitingRoomState(roomId, server, "PLAYER_LEFT", RoomStatus.WAITING);
  }
}
