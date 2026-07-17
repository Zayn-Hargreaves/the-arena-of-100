import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Server } from "socket.io";
import { RoomService } from "../room/room.service";
import { LobbyCountdownService } from "./lobby-countdown.service";
import {
  ServerEvent,
  RoomStatus,
  type RoomPlayerLeftPayload,
} from "@arena/shared";
import { GameLoopService, type FinishResult } from "./game-loop.service";
import { emitMatchPlayerLeft } from "./game-loop.events";
import { emitRoomStatusUpdated } from "./game-loop.helpers";

// A room this young hasn't had a fair chance to establish presence yet:
// under a burst of concurrent connections, a just-created room's host can
// still be queued behind hundreds of other AUTHENTICATE/JOIN_ROOM calls
// when the first sweep tick after room creation fires. Without this grace
// window the sweep judges the host "stale" (no presence key set yet) and
// disbands the room before it ever had a socket connected — observed at
// 400 concurrent connections across 4 rooms, where a host's own
// AUTHENTICATE hadn't reached the server 3s after room creation.
const ROOM_SWEEP_GRACE_PERIOD_MS = 30_000;

// A private room's host being "stale" on ONE sweep tick doesn't mean the
// host is gone: a real client's Socket.IO connection retries indefinitely
// (default reconnection: true, 1-5s backoff) and covers exactly this kind
// of transient blip — a dropped connection, a failed initial handshake
// under a burst of concurrent connections, a brief network hiccup. Load
// testing at 8 concurrent 100-seat rooms (800 sockets) showed this isn't
// rare enough to ignore at scale: individual connections occasionally
// never reach the server on the first attempt, and disbanding on a single
// missed tick evicts every other player in the room over what a real
// client would have self-healed from within the next 5-10s. Requiring two
// CONSECUTIVE stale ticks (~10s total, still well inside the 20s presence
// TTL a genuinely-gone host would need to clear anyway) keeps the
// original protection against an actually-abandoned room while giving a
// reconnecting host one more cycle to prove it's still there.
const HOST_STALE_CONSECUTIVE_SWEEPS = 2;

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private sweepInterval?: NodeJS.Timeout;
  private server?: Server;
  private isSweeping = false;
  // roomId -> consecutive sweep ticks where the host has been stale.
  // Reset to absent whenever the host is seen present again.
  private readonly hostStaleStrikes = new Map<string, number>();

  constructor(
    private readonly roomService: RoomService,
    private readonly lobbyCountdownService: LobbyCountdownService,
    private readonly gameLoopService: GameLoopService,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  onModuleInit() {
    this.sweepInterval = setInterval(async () => {
      if (this.isSweeping) return;
      this.isSweeping = true;
      try {
        await this.sweep();
      } catch (error) {
        this.logger.error(
          `Error during presence sweep: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        this.isSweeping = false;
      }
    }, 5000);
  }

  onModuleDestroy() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
    }
  }

  async updatePresence(roomId: string, userId: string) {
    await this.roomService.updatePresence(roomId, userId);
  }

  async clearPresence(roomId: string, userId: string) {
    await this.roomService.clearPresence(roomId, userId);
  }

  async isPresent(roomId: string, userId: string): Promise<boolean> {
    return this.roomService.checkPresence(roomId, userId);
  }

  private async sweep() {
    if (!this.server) return;

    const activeRooms = await this.roomService.getActiveRooms();
    const now = Date.now();

    // Drop strike counters for rooms that are no longer active (finished,
    // already disbanded, etc.) so this map can't grow unbounded.
    const activeRoomIds = new Set(activeRooms.map((room) => room.id));
    for (const roomId of this.hostStaleStrikes.keys()) {
      if (!activeRoomIds.has(roomId)) {
        this.hostStaleStrikes.delete(roomId);
      }
    }

    for (const room of activeRooms) {
      if (now - room.createdAt.getTime() < ROOM_SWEEP_GRACE_PERIOD_MS) {
        continue;
      }

      // Check all players' presence in parallel (single round-trip per player
      // to Redis, but no longer N+1 sequential awaits per room). The N+1
      // pattern was making the 5s sweep scale linearly with room size.
      const presenceFlags = await Promise.all(
        room.players.map((rp) =>
          this.roomService
            .checkPresence(room.id, rp.userId)
            .then((isPresent) => ({ rp, isPresent })),
        ),
      );

      const stalePlayerIds: string[] = [];
      let isHostStale = false;
      for (const { rp, isPresent } of presenceFlags) {
        if (!isPresent) {
          stalePlayerIds.push(rp.userId);
          if (rp.userId === room.hostId) {
            isHostStale = true;
          }
        }
      }

      // The host is confirmed present this tick — any strikes from a prior
      // transient blip no longer apply.
      if (!isHostStale) {
        this.hostStaleStrikes.delete(room.id);
      }

      if (stalePlayerIds.length > 0) {
        if (room.type === "PRIVATE" && isHostStale) {
          const strikes = (this.hostStaleStrikes.get(room.id) ?? 0) + 1;
          if (strikes < HOST_STALE_CONSECUTIVE_SWEEPS) {
            this.hostStaleStrikes.set(room.id, strikes);
            this.logger.log(
              `Host stale in private room ${room.code} (${strikes}/${HOST_STALE_CONSECUTIVE_SWEEPS} consecutive sweeps); giving the host one more cycle to reconnect before disbanding`,
            );
            continue;
          }

          this.hostStaleStrikes.delete(room.id);
          this.logger.log(
            `Host stale in private room ${room.code} for ${HOST_STALE_CONSECUTIVE_SWEEPS} consecutive sweeps, disbanding...`,
          );
          // Mid-match disband must terminate the live match through the
          // state-machine + finishMatch path before membership teardown;
          // disbandRoom alone only clears currentMatchId and would leave
          // an orphan non-FINISHED Match row without audit events.
          let finishResult: FinishResult | null = null;
          if (room.currentMatchId) {
            try {
              finishResult =
                await this.gameLoopService.forceFinishMatchForDisband(
                  room.currentMatchId,
                  room.id,
                );
            } catch (error) {
              this.logger.error(
                `forceFinishMatchForDisband failed for match ${room.currentMatchId} during host-stale disband of room ${room.code}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
          // Always disband after force-finish attempts (including failures):
          // disbandRoom's safety-net still terminalizes any non-FINISHED match.
          const { safetyNetMatchIds } = await this.roomService.disbandRoom(
            room.id,
          );

          if (finishResult) {
            // Authoritative path: forceFinishMatchForDisband succeeded.
            this.server.to(`room:${room.id}`).emit(ServerEvent.MATCH_FINISHED, {
              matchId: finishResult.matchId,
              winnerId: finishResult.winnerId,
              totalRounds: finishResult.totalRounds,
              finishedAt: finishResult.finishedAt.getTime(),
            });
          } else if (safetyNetMatchIds.length > 0) {
            // forceFinish was either skipped (null) or threw, but the
            // disbandRoom safety-net terminalized these matches — emit one
            // event per terminalized match so clients leave the match UI.
            // We use the real matchId from the DB transaction; other fields
            // are unknown at this point so we use null / 0 / now.
            for (const matchId of safetyNetMatchIds) {
              this.server
                .to(`room:${room.id}`)
                .emit(ServerEvent.MATCH_FINISHED, {
                  matchId,
                  winnerId: null,
                  totalRounds: 0,
                  finishedAt: Date.now(),
                });
            }
          }
          // When finishResult is null AND safetyNetMatchIds is empty, no
          // match was terminalized by this sweep (e.g. no currentMatchId,
          // or the in-flight natural finish already broadcast its own
          // MATCH_FINISHED). We must NOT emit a second event.

          const isLobby =
            room.status === RoomStatus.WAITING ||
            room.status === RoomStatus.COUNTDOWN ||
            room.status === RoomStatus.STARTING;
          if (isLobby) {
            this.server
              .to(`room:${room.id}`)
              .emit(ServerEvent.ROOM_COUNTDOWN_CANCELLED, {
                roomId: room.id,
                roomStatus: RoomStatus.WAITING,
                reason: "HOST_STALE",
                cancelledAt: Date.now(),
              });
          } else {
            // Mid-match / finished-shell teardown: report the real post-
            // disband status (FINISHED) instead of a synthetic WAITING lobby.
            emitRoomStatusUpdated(this.server, {
              roomId: room.id,
              roomStatus: RoomStatus.FINISHED,
              currentMatchId: null,
              updatedAt: Date.now(),
            });
          }
          this.server.to(`room:${room.id}`).emit(ServerEvent.PLAYER_LEFT, {
            roomId: room.id,
            playerId: room.hostId,
            reason: "HOST_STALE",
          } satisfies RoomPlayerLeftPayload);
          continue;
        }

        this.logger.log(
          `Processing stale players in room ${room.code}: ${stalePlayerIds.join(", ")}`,
        );

        const isLobby =
          room.status === RoomStatus.WAITING ||
          room.status === RoomStatus.COUNTDOWN ||
          room.status === RoomStatus.STARTING;

        const executeWithRetry = async (
          fn: () => Promise<void>,
          retries = 3,
          delay = 50,
        ): Promise<void> => {
          for (let attempt = 1; attempt <= retries; attempt++) {
            try {
              await fn();
              return;
            } catch (error) {
              if (attempt === retries) throw error;
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        };

        if (isLobby) {
          try {
            // 1. Invoke the lobby countdown callback before committing removal, with immediate retries
            await executeWithRetry(() =>
              this.lobbyCountdownService.handleRoomPlayerLeft(
                room.id,
                this.server!,
                stalePlayerIds,
              ),
            );
            // 2. Commit player removals in a single batch call, with immediate retries
            await executeWithRetry(() =>
              this.roomService.removePlayerBatch(room.id, stalePlayerIds),
            );
            // 3. Emit PLAYER_LEFT event for each stale player
            for (const userId of stalePlayerIds) {
              emitMatchPlayerLeft(this.server!, room.id, userId, "STALE");
            }
          } catch (err) {
            this.logger.error(
              `Failed to remove stale players [${stalePlayerIds.join(", ")}] from lobby room ${room.code}:`,
              err,
            );
          }
        } else if (room.status === RoomStatus.IN_GAME && room.currentMatchId) {
          try {
            // Mark each stale player DISCONNECTED in the match state machine
            // WITHOUT deleting their RoomPlayer row. Deleting the row (as the
            // lobby path does via removePlayerBatch) breaks reconnection:
            // syncReconnection -> getUserActiveRooms locates players by their
            // RoomPlayer row, so a deleted row makes the running match
            // unreachable on a fresh socket. Marking DISCONNECTED still covers
            // the anti-cheat needs (evaluateRound skips them, the submitAnswer
            // gate rejects) while leaving reconnect intact for the rest of the
            // match; the row is cleaned up when the match ends. We use
            // handlePlayerDisconnect (reason "DISCONNECTED") rather than
            // handleMatchPlayerLeft (reason "STALE") because a lost presence
            // key is a network drop, not a voluntary leave.
            //
            // FINISHED rooms are intentionally left untouched: they are
            // excluded from getUserActiveRooms (nothing to preserve) and their
            // state machine is already gone.
            const DISCONNECT_TIMEOUT_MS = 3000;
            let chain = Promise.resolve();
            const promises = stalePlayerIds.map((userId) => {
              const task = () => {
                let timeoutId: NodeJS.Timeout | undefined;
                const timeoutPromise = new Promise<void>((_, reject) => {
                  timeoutId = setTimeout(() => {
                    reject(
                      new Error(
                        `Timeout: handlePlayerDisconnect for player ${userId} exceeded ${DISCONNECT_TIMEOUT_MS}ms`,
                      ),
                    );
                  }, DISCONNECT_TIMEOUT_MS);
                });

                const disconnectPromise = executeWithRetry(() =>
                  this.gameLoopService.handlePlayerDisconnect(
                    room.currentMatchId!,
                    userId,
                    this.server!,
                  ),
                );

                return Promise.race([
                  disconnectPromise,
                  timeoutPromise,
                ]).finally(() => {
                  if (timeoutId) {
                    clearTimeout(timeoutId);
                  }
                });
              };
              const p = chain.then(task);
              chain = p.catch(() => {});
              return p;
            });

            const results = await Promise.allSettled(promises);
            results.forEach((result, idx) => {
              if (result.status === "rejected") {
                const userId = stalePlayerIds[idx];
                this.logger.error(
                  `Failed to mark stale player ${userId} disconnected in match room ${room.code}:`,
                  result.reason,
                );
              }
            });
          } catch (err) {
            this.logger.error(
              `Unexpected error during stale players disconnection sweep in match room ${room.code}:`,
              err,
            );
          }
        }
      }
    }
  }
}
