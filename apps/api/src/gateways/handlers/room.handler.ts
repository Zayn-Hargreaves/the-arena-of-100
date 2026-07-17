import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  RoomStatus,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type LeaveRoomPayload,
  type RoomCreatedPayload,
  type RoomJoinedPayload,
  type RoomPlayerJoinedPayload,
  type RoomPlayerLeftPayload,
  RoomError,
  ERROR_MESSAGES,
  asRoomType,
} from "@arena/shared";
import { RoomService } from "../../modules/room/room.service";
import { PresenceService } from "../../modules/match/presence.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { LobbyCountdownService } from "../../modules/match/lobby-countdown.service";
import { BaseHandler } from "./base.handler";

const asRoomStatus = (value: string): RoomStatus => value as RoomStatus;

@Injectable()
export class RoomHandler extends BaseHandler {
  private readonly logger = new Logger(RoomHandler.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly gameLoopService: GameLoopService,
    private readonly lobbyCountdownService: LobbyCountdownService,
    private readonly presenceService: PresenceService,
  ) {
    super();
  }

  async handleCreateRoom(client: Socket, payload: CreateRoomPayload) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);
        const room = await this.roomService.createRoom(
          userId,
          payload.roomType,
          payload.maxPlayers,
          payload.timeLimit,
          payload.category,
        );

        client.join(`room:${room.id}`);

        // Same as handleJoinRoom: the presence sweep only sees the host
        // as online once this key exists. Without it, a host who creates
        // a room and is still waiting for their first heartbeat can be
        // swept as "stale" and the room disbanded under them.
        // Best-effort: room + socket channel already exist; a Redis blip
        // must not turn a successful create into ERROR after the fact.
        // Heartbeat + ROOM_SWEEP_GRACE_PERIOD cover a missing key.
        try {
          await this.presenceService.updatePresence(room.id, userId);
        } catch (error) {
          this.logger.warn(
            `Presence update failed after room create ${room.id} for host ${userId}; host will rely on heartbeat/sweep grace: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        client.emit(ServerEvent.ROOM_CREATED, {
          roomId: room.id,
          code: room.code,
          hostId: room.hostId,
          roomType: asRoomType(room.type),
          roomStatus: RoomStatus.WAITING,
          maxPlayers: room.maxPlayers,
          currentMatchId: null,
          players: [
            {
              playerId: userId,
              playerName: client.data.username,
              isOnline: true,
            },
          ],
          // The host is always a player; mirrors RoomJoinedPayload
          // shape so the frontend can rely on a single `joinMode` field.
          joinedAs: "PLAYER",
        } satisfies RoomCreatedPayload);

        this.logger.log(`Room created via socket: ${room.code}`);
      },
      (error) => {
        const code = this.getErrorCode(error);
        let msg =
          error instanceof RoomError
            ? /* c8 ignore next */
              (ERROR_MESSAGES[error.code] ?? this.getErrorMessage(error))
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error creating room:", error);
          msg = "Internal server error";
        }
        this.emitError(client, code, msg);
      },
    );
  }

  async handleJoinRoom(client: Socket, payload: JoinRoomPayload) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);

        if (!payload.roomCode) throw new RoomError(ErrorCode.ROOM_NOT_FOUND);

        const room = await this.roomService.joinRoom(payload.roomCode, userId);

        // Spectators still join the Socket.io room channel so they receive
        // the same ROUND_STARTED / ROUND_ENDED / MATCH_FINISHED events as
        // players. We do NOT broadcast a PLAYER_JOINED to other players for
        // a spectator (it would look like a new participant) and we do NOT
        // call maybeStartPublicCountdown (spectators never start a match).
        const isSpectator = room.joinedAs === "SPECTATOR";

        client.join(`room:${room.id}`);

        // The presence sweep (every 5s) only sees a player as online once
        // this key exists — otherwise a player who joins and is still
        // waiting for their first heartbeat can be swept as "stale"
        // seconds after joining. We already accept their socket as online
        // below (isOnline: true for the joiner), so make that true in
        // Redis too instead of leaving it to the first heartbeat.
        await this.presenceService.updatePresence(room.id, userId);

        if (room.joined && !isSpectator) {
          client.to(`room:${room.id}`).emit(ServerEvent.PLAYER_JOINED, {
            roomId: room.id,
            playerId: userId,
            playerName: client.data.username,
            isOnline: true,
          } satisfies RoomPlayerJoinedPayload);
        }
        client.emit(ServerEvent.ROOM_JOINED, {
          roomId: room.id,
          code: room.code,
          hostId: room.hostId,
          roomType: asRoomType(room.type),
          roomStatus: asRoomStatus(room.status),
          maxPlayers: room.maxPlayers,
          currentMatchId: room.currentMatchId,
          countdownEndsAt: await this.lobbyCountdownService.getCountdownEnd(
            room.id,
          ),
          joinedAs: room.joinedAs,
          players: await Promise.all(
            room.players.map(async (player) => {
              // RoomService.getRoom() always joins the user relation, so
              // `player.user` is guaranteed to be present. If it ever isn't, that
              // is a state-corruption bug — fail fast so the caller gets a
              // descriptive error and tests surface the regression immediately,
              // rather than silently emitting an empty playerName that clients
              // would render as a blank tile in the lobby.
              if (!player.user) {
                const message = `RoomPlayer ${player.userId} in room ${room.id} is missing its user relation; cannot resolve username`;
                this.logger.error(message);
                throw new Error(message);
              }
              return {
                playerId: player.userId,
                playerName:
                  player.userId === userId
                    ? client.data.username
                    : player.user.username,
                // Resolve the authoritative online status from the presence
                // service. The joining user is online by definition (we just
                // accepted their socket) so we short-circuit that case. For
                // other players, a presence lookup failure (e.g. Redis
                // timeout) must not reject the whole ROOM_JOINED payload —
                // we degrade to isOnline=false for that one player and log a
                // warning so the operator can investigate.
                isOnline:
                  player.userId === userId
                    ? true
                    : await this.presenceService
                        .isPresent(room.id, player.userId)
                        .catch((error) => {
                          this.logger.warn(
                            `Presence lookup failed for player ${player.userId} in room ${room.id}; defaulting isOnline=false: ${
                              error instanceof Error
                                ? error.message
                                : String(error)
                            }`,
                          );
                          return false;
                        }),
              };
            }),
          ),
        } satisfies RoomJoinedPayload);

        if (room.joined && !isSpectator) {
          await this.lobbyCountdownService.maybeStartPublicCountdown(
            room.id,
            client.nsp.server,
          );
        }

        this.logger.log(
          `${isSpectator ? "Spectator" : "Player"} ${userId} joined room ${room.code} via socket (mode=${room.joinedAs})`,
        );
      },
      (error) => {
        const code = this.getErrorCode(error);
        let msg =
          error instanceof RoomError
            ? /* c8 ignore next */
              (ERROR_MESSAGES[error.code] ?? this.getErrorMessage(error))
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error joining room:", error);
          msg = "Internal server error";
        }
        this.emitError(client, code, msg);
      },
    );
  }

  async handleLeaveRoom(
    client: Socket,
    server: Server,
    payload: LeaveRoomPayload,
  ) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);

        // C1 fix: capture the post-leave room snapshot so we can detect
        // IN_GAME and notify the game loop. RoomService.leaveRoom returns
        // the up-to-date room (it always re-fetches via getRoom at the
        // end), so this is a single round-trip, no extra DB hit.
        const updatedRoom = await this.roomService.leaveRoom(
          payload.roomId,
          userId,
        );
        client.leave(`room:${payload.roomId}`);

        // Two diverging paths:
        //
        // 1. IN_GAME / FINISHED rooms have a live match. A voluntary leave
        //    must mark the player as DISCONNECTED in the match state
        //    machine, otherwise the SUBMIT_ANSWER gate (which checks
        //    `status === ACTIVE`) keeps accepting answers from a player
        //    that has no RoomPlayer row and is no longer subscribed to the
        //    ROOM channel. This is a cheating vector — see C1 in the bug
        //    investigation.
        //
        // 2. WAITING / COUNTDOWN rooms have no match. We just broadcast
        //    PLAYER_LEFT so the other players' lobbies update, and call
        //    handleRoomPlayerLeft which cancels the countdown if the
        //    player drop brought the room under MIN_PLAYERS_TO_START.
        if (
          updatedRoom?.currentMatchId &&
          (updatedRoom.status === RoomStatus.IN_GAME ||
            updatedRoom.status === RoomStatus.FINISHED)
        ) {
          await this.gameLoopService.handleMatchPlayerLeft(
            updatedRoom.currentMatchId,
            payload.roomId,
            userId,
            server,
          );
        } else {
          server.to(`room:${payload.roomId}`).emit(ServerEvent.PLAYER_LEFT, {
            roomId: payload.roomId,
            playerId: userId,
            reason: "LEFT",
          } satisfies RoomPlayerLeftPayload);

          await this.lobbyCountdownService.handleRoomPlayerLeft(
            payload.roomId,
            server,
          );
        }
      },
      (error) => {
        const code = this.getErrorCode(error);
        let msg =
          error instanceof RoomError
            ? /* c8 ignore next */
              (ERROR_MESSAGES[error.code] ?? this.getErrorMessage(error))
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error leaving room:", error);
          msg = "Internal server error";
        }
        this.emitError(client, code, msg);
      },
    );
  }
}
