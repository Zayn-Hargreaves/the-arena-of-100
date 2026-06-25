import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  ERROR_MESSAGES,
  RoomJoinedPayload,
  RoomError,
  asRoomTypeOrDefault,
} from "@arena/shared";
import { AuthService } from "../../modules/auth/auth.service";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { PresenceService } from "../../modules/match/presence.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class AuthHandler extends BaseHandler {
  private readonly logger = new Logger(AuthHandler.name);
  private readonly connectedPlayers = new Map<string, string>();
  // L2 fix: per-user generation counter. Every time we overwrite
  // the connectedPlayers entry for a user (during AUTHENTICATE), we
  // bump the generation. handleDisconnect compares the captured
  // generation against the live one to decide whether to process
  // the disconnect. This makes the kick-old-socket race explicit:
  //   1. User U has socket S1 in connectedPlayers[U] (gen=1)
  //   2. U opens tab 2 → AUTHENTICATE on S2
  //   3. We kick S1 (disconnect(true)) and overwrite the map to
  //      connectedPlayers[U] = S2 (gen=2)
  //   4. S1's `disconnect` event fires (async) → handleDisconnect(S1)
  // Without the generation check, handleDisconnect would compare
  // connectedPlayers[U] (now S2) with client.id (S1) and find they
  // differ, treating S1 as a stale disconnect. That happens to
  // work, but the implicit ordering between (3) and (4) is
  // Socket.io's internal guarantee. The generation check makes
  // the invariant explicit and survives any future change in
  // Socket.io's connect/disconnect timing.
  private readonly connectionGeneration = new Map<string, number>();

  constructor(
    private readonly authService: AuthService,
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly gameLoopService: GameLoopService,
    private readonly presenceService: PresenceService,
  ) {
    super();
  }

  async handleAuthenticate(client: Socket, payload: { token: string }) {
    return this.runSafely(
      client,
      async () => {
        const decoded = this.authService.verifyToken(payload.token);

        // Capture the old socket ID BEFORE recording the new connection so
        // the kick logic can still find and evict the stale session.
        const oldSocketId = this.connectedPlayers.get(decoded.userId);

        // If this same socket was previously authenticated as a DIFFERENT
        // user, clean up that user's mapping before we overwrite
        // client.data.userId. Otherwise the old user's
        // connectedPlayers/connectionGeneration entries become orphaned
        // (pointing at this client.id), violating the single-session
        // invariant.
        const previousUserId = client.data.userId as string | undefined;

        // Record the new connection BEFORE kicking the old one so that
        // oldSocket.disconnect(true) and its async handleDisconnect path
        // see the new socket as the active session (generation mismatch)
        // and treat the stale socket as non-active. This prevents the
        // old socket's disconnect from clearing the new session or
        // triggering an unintended player disconnect.
        //
        // The same identity update is also done BEFORE awaiting
        // handleTrackedUserSwitchDisconnect below: while that cleanup
        // is in flight, any concurrent handler reading
        // client.data.userId / client.data.connectionGen must observe
        // the new user, not the stale previousUserId.
        this.connectedPlayers.set(decoded.userId, client.id);
        const newGen = (this.connectionGeneration.get(decoded.userId) ?? 0) + 1;
        this.connectionGeneration.set(decoded.userId, newGen);
        client.data.connectionGen = newGen;
        client.data.userId = decoded.userId;
        client.data.username = decoded.username;

        if (
          previousUserId &&
          previousUserId !== decoded.userId &&
          this.connectedPlayers.get(previousUserId) === client.id
        ) {
          await this.handleTrackedUserSwitchDisconnect(
            previousUserId,
            client.nsp.server,
            client,
          );
        }

        // Kick existing connection of this user if exists (O(1) lookup)
        if (oldSocketId && oldSocketId !== client.id) {
          const oldSocket = client.nsp?.sockets.get(oldSocketId);
          if (oldSocket) {
            this.logger.log(
              `Kicking old socket: ${oldSocketId} for user: ${decoded.userId}`,
            );
            oldSocket.emit(ServerEvent.ERROR, {
              code: ErrorCode.UNAUTHORIZED,
              message: ERROR_MESSAGES[ErrorCode.UNAUTHORIZED],
            });
            oldSocket.disconnect(true);
          } else {
            // L1 fix: the old socket ID is in our map but Socket.IO
            // has already cleaned it up (e.g. process was OOM-killed
            // and the `disconnect` event was never delivered to us,
            // or the socket was force-closed for an unrelated
            // reason). The stale entry was already overwritten by
            // the set above, so no further cleanup is needed here.
            this.logger.log(
              `Connected-players map had stale entry for user ${decoded.userId} (socket ${oldSocketId} no longer in namespace); cleaned up by overwrite`,
            );
          }
        }

        client.emit(ServerEvent.AUTHENTICATED, {
          userId: decoded.userId,
          username: decoded.username,
        });

        this.logger.log(`Player authenticated: ${decoded.username}`);

        // Reconnection sync: restore room/match state
        await this.syncReconnection(client, decoded.userId);
      },
      (error) => {
        // A WsValidationError means the AUTHENTICATE payload itself was
        // malformed (e.g. { token: 123 } or missing token). Surface that
        // distinctly so the client knows to fix the request shape, not
        // the credentials.
        if (
          error instanceof RoomError &&
          error.code === ErrorCode.INVALID_PAYLOAD
        ) {
          this.emitError(client, error.code, error.message);
          return;
        }

        this.logTokenVerificationFailure(error);
        this.emitError(
          client,
          ErrorCode.INVALID_TOKEN,
          ERROR_MESSAGES[ErrorCode.INVALID_TOKEN],
        );
      },
    );
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      const currentSocketId = this.connectedPlayers.get(userId);
      // L2 fix: also compare the captured generation. The
      // socket-id check already does the right thing in practice,
      // but the generation check makes the kick-old-socket race
      // explicit and resilient to Socket.io internal changes.
      const capturedGen = client.data?.connectionGen as number | undefined;
      const liveGen = this.connectionGeneration.get(userId);
      if (
        capturedGen !== undefined &&
        liveGen !== undefined &&
        capturedGen !== liveGen
      ) {
        // The connection was superseded by a newer authenticate.
        // The old socket's disconnect is a no-op.
        this.logger.debug(
          `Stale disconnect for user ${userId} on socket ${client.id} (gen ${capturedGen} < ${liveGen}); ignoring`,
        );
        return;
      }
      // Only delete from map if the disconnected socket is the active session
      if (currentSocketId === client.id) {
        await this.handleTrackedUserSwitchDisconnect(
          userId,
          client.nsp.server,
          client,
        );

        this.logger.log(`Player disconnected: ${userId}`);
      }
    }
  }

  private clearTrackedConnection(userId: string) {
    this.connectedPlayers.delete(userId);
    this.connectionGeneration.delete(userId);
  }

  private async handleTrackedUserSwitchDisconnect(
    userId: string,
    server: Server,
    client: Socket,
  ): Promise<void> {
    this.clearTrackedConnection(userId);

    // SYNC: leave every `room:*` channel the socket is currently joined
    // to. Iterating `client.rooms` (no DB) means a `getUserActiveRooms`
    // failure cannot leave stale `room:*` memberships on a reused
    // socket — a user-switch re-auth must not receive broadcasts for
    // the previous user. The socket's own room (`client.id`) is skipped
    // because leaving it would force-disconnect the socket itself.
    for (const roomName of Array.from(client.rooms ?? [])) {
      if (roomName === client.id) continue;
      if (roomName.startsWith("room:")) {
        client.leave(roomName);
      }
    }

    // DB-touching notification is in its own try/catch so a failure
    // here cannot undo the synchronous socket cleanup above.
    try {
      const userActiveRooms = await this.roomService.getUserActiveRooms(userId);
      for (const rp of userActiveRooms) {
        // Re-check tracking: a newer socket may have authenticated as
        // this user during the await. If connectedPlayers[userId] now
        // holds any entry (the one we just deleted), a new session is
        // canonical — skip the state-mutating handlePlayerDisconnect so
        // the live player's state machine is NOT marked DISCONNECTED.
        if (this.connectedPlayers.has(userId)) {
          this.logger.debug(
            `Skipping handlePlayerDisconnect for ${userId} in room ${rp.room.id}: a newer socket has authenticated`,
          );
          continue;
        }
        if (rp.room.currentMatchId) {
          await this.gameLoopService.handlePlayerDisconnect(
            rp.room.currentMatchId,
            userId,
            server,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to notify match of disconnect for ${userId}`,
        error,
      );
    }
  }

  private logTokenVerificationFailure(error: unknown) {
    if (error instanceof Error) {
      this.logger.error(
        `Token verification failed: ${error.message}`,
        error.stack,
      );
      return;
    }

    this.logger.error(`Token verification failed: ${String(error)}`);
  }

  private async syncReconnection(client: Socket, userId: string) {
    try {
      const userActiveRooms = await this.roomService.getUserActiveRooms(userId);
      if (userActiveRooms.length === 0) return;

      // C3 fix: a user can have RoomPlayer rows in more than one active
      // room (e.g. an IN_GAME match and a public lobby they joined from
      // a second tab). Previously this method sorted by joinedAt and
      // re-joined only the most recent room's channel, which meant the
      // other rooms silently stopped receiving broadcasts on this
      // socket. The state machine for the dropped match still had the
      // user as ACTIVE, so the user could keep submitting answers (or
      // just sit in a "ghost" state where they see nothing).
      //
      // The fix is to join ALL active rooms' channels, and for each one
      // with a live matchId, call reconnectPlayer + persist + emit a
      // SNAPSHOT. The user-facing ROOM_JOINED payload is still emitted
      // once for the most recent room only — the web store maintains a
      // single "active room" in its UI, and emitting one per room would
      // clobber it. Other rooms remain reachable: the user can navigate
      // to them and call REQUEST_SNAPSHOT to rehydrate.
      const sortedByJoinedAt = [...userActiveRooms].sort(
        (a, b) => b.joinedAt.getTime() - a.joinedAt.getTime(),
      );
      const mostRecent = sortedByJoinedAt[0];

      // Pass 1: join every channel, re-attach the player to every
      // live match's state machine, AND update the presence
      // record for every room. The ROUND_STARTED / ROUND_ENDED
      // broadcasts for a match A will then be delivered to this
      // socket even if the user is currently looking at room B
      // in the UI. Presence must be touched for ALL rooms —
      // not just the most recent — because the sweeper uses it to
      // mark non-reconnected players stale. The previous
      // implementation only updated presence for the most recent
      // room, leaving the other rooms' presence records pointing
      // at the pre-disconnect state.
      for (const roomPlayer of sortedByJoinedAt) {
        const room = roomPlayer.room;
        client.join(`room:${room.id}`);
        await this.presenceService.updatePresence(room.id, userId);

        if (room.currentMatchId) {
          const stateMachine = await this.matchService.getStateMachine(
            room.currentMatchId,
          );
          if (stateMachine) {
            stateMachine.reconnectPlayer(userId);
            await this.matchService.persistStateMachine(room.currentMatchId);
          }
        }
      }

      // Pass 2: emit the user-facing ROOM_JOINED + SNAPSHOT for the
      // most recent room only. The web store has a single `room`
      // slot; emitting more than one would race and clobber.
      // Presence is already updated for every room in Pass 1.
      const mostRecentRoom = mostRecent.room;
      const countdownEndsAt = await this.gameLoopService.getCountdownEnd(
        mostRecentRoom.id,
      );

      const mostRecentRoomPlayers = await Promise.all(
        mostRecentRoom.players.map(async (p) => {
          const isOnline = await this.presenceService.isPresent(
            mostRecentRoom.id,
            p.userId,
          );
          return {
            playerId: p.userId,
            playerName: p.user.username,
            isOnline,
          };
        }),
      );

      client.emit(ServerEvent.ROOM_JOINED, {
        roomId: mostRecentRoom.id,
        code: mostRecentRoom.code,
        hostId: mostRecentRoom.hostId,
        roomType: asRoomTypeOrDefault(mostRecentRoom.type),
        roomStatus: mostRecentRoom.status as import("@arena/shared").RoomStatus,
        currentMatchId: mostRecentRoom.currentMatchId,
        countdownEndsAt,
        joinedAs: "PLAYER",
        players: mostRecentRoomPlayers,
      } satisfies RoomJoinedPayload);

      // Emit a SNAPSHOT for the most recent room's match so the UI
      // rehydrates question/player state. Other matches will be
      // snapshotable on demand via REQUEST_SNAPSHOT.
      if (mostRecentRoom.currentMatchId) {
        const stateMachine = await this.matchService.getStateMachine(
          mostRecentRoom.currentMatchId,
        );
        if (stateMachine) {
          client.emit(ServerEvent.SNAPSHOT, stateMachine.getSnapshot(0));
        }
      }

      if (userActiveRooms.length > 1) {
        this.logger.log(
          `Reconnected user ${userId} to ${userActiveRooms.length} active rooms; ` +
            `primary channel=${mostRecentRoom.id}, also joined: ${sortedByJoinedAt
              .slice(1)
              .map((rp) => rp.room.id)
              .join(", ")}`,
        );
      } else {
        this.logger.log(
          `Reconnected user ${userId} to room ${mostRecentRoom.id}`,
        );
      }
    } catch (error) {
      this.logger.error("Error during reconnection sync:", error);
    }
  }
}
