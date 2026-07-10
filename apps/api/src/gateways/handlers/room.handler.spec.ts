import { Socket, Server } from "socket.io";
import { ServerEvent, ErrorCode, RoomError, RoomStatus } from "@arena/shared";
import { RoomHandler } from "./room.handler";
import { RoomService } from "../../modules/room/room.service";
import { PresenceService } from "../../modules/match/presence.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { LobbyCountdownService } from "../../modules/match/lobby-countdown.service";

describe("RoomHandler", () => {
  let handler: RoomHandler;
  let roomService: RoomService;
  let presenceService: PresenceService;
  let gameLoopService: {
    handleMatchPlayerLeft: ReturnType<typeof vi.fn>;
  };
  let lobbyCountdownService: {
    maybeStartPublicCountdown: ReturnType<typeof vi.fn>;
    handleRoomPlayerLeft: ReturnType<typeof vi.fn>;
    getCountdownEnd: ReturnType<typeof vi.fn>;
  };
  let client: Socket;
  let server: Server;

  beforeEach(() => {
    roomService = {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
    } as unknown as RoomService;
    presenceService = {
      isPresent: vi.fn().mockResolvedValue(false),
    } as unknown as PresenceService;
    gameLoopService = {
      handleMatchPlayerLeft: vi.fn().mockResolvedValue(undefined),
    };
    lobbyCountdownService = {
      maybeStartPublicCountdown: vi.fn().mockResolvedValue(null),
      handleRoomPlayerLeft: vi.fn().mockResolvedValue(undefined),
      getCountdownEnd: vi.fn().mockResolvedValue(null),
    };
    handler = new RoomHandler(
      roomService,
      gameLoopService as unknown as GameLoopService,
      lobbyCountdownService as unknown as LobbyCountdownService,
      presenceService,
    );
    client = {
      emit: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockImplementation(() => ({ emit: vi.fn() })),
      data: { userId: "u1", username: "Alice" },
      nsp: { server: { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } },
    } as unknown as Socket;
    server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;
  });

  describe("handleCreateRoom", () => {
    it("creates room and emits ROOM_CREATED", async () => {
      vi.mocked(roomService.createRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        type: "PUBLIC",
        hostId: "u1",
        maxPlayers: 100,
      } as any);

      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 100,
      });

      expect(roomService.createRoom).toHaveBeenCalledWith(
        "u1",
        "PUBLIC",
        100,
        undefined,
        undefined,
      );
      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ROOM_CREATED, {
        roomId: "r1",
        code: "ABC123",
        hostId: "u1",
        roomType: "PUBLIC",
        roomStatus: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        players: [
          {
            playerId: "u1",
            playerName: "Alice",
            isOnline: true,
          },
        ],
        joinedAs: "PLAYER",
      });
    });

    it("emits error when not authenticated", async () => {
      client.data = {};
      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it("emits error with RoomError code on service failure", async () => {
      vi.mocked(roomService.createRoom).mockRejectedValue(
        new RoomError(ErrorCode.ROOM_FULL),
      );
      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.ROOM_FULL }),
      );
    });

    it("emits INTERNAL_ERROR for generic errors", async () => {
      vi.mocked(roomService.createRoom).mockRejectedValue(new Error("db down"));
      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: "Internal server error",
        }),
      );
    });

    it("creates room with timeLimit and category", async () => {
      vi.mocked(roomService.createRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        type: "PUBLIC",
        hostId: "u1",
        maxPlayers: 100,
      } as any);

      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 100,
        timeLimit: 15,
        category: "SCIENCE",
      });

      expect(roomService.createRoom).toHaveBeenCalledWith(
        "u1",
        "PUBLIC",
        100,
        15,
        "SCIENCE",
      );
      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ROOM_CREATED, {
        roomId: "r1",
        code: "ABC123",
        hostId: "u1",
        roomType: "PUBLIC",
        roomStatus: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        players: [
          {
            playerId: "u1",
            playerName: "Alice",
            isOnline: true,
          },
        ],
        joinedAs: "PLAYER",
      });
    });
  });

  describe("handleJoinRoom", () => {
    it("joins room and emits PLAYER_JOINED to room and client", async () => {
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        joined: true,
        joinedAs: "PLAYER",
        players: [
          {
            userId: "u1",
            user: { username: "Alice" },
          },
        ],
      } as any);

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      expect(roomService.joinRoom).toHaveBeenCalledWith("ABC123", "u1");
      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(client.to).toHaveBeenCalledWith("room:r1");
      const roomEmit = (client.to as any).mock.results[0].value.emit;
      expect(roomEmit).toHaveBeenCalledWith(ServerEvent.PLAYER_JOINED, {
        roomId: "r1",
        playerId: "u1",
        playerName: "Alice",
        isOnline: true,
      });
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ROOM_JOINED, {
        roomId: "r1",
        code: "ABC123",
        hostId: "u9",
        roomType: "PUBLIC",
        roomStatus: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        countdownEndsAt: null,
        joinedAs: "PLAYER",
        players: [
          {
            playerId: "u1",
            playerName: "Alice",
            // The joining user is online by definition — they just
            // connected via this socket.
            isOnline: true,
          },
        ],
      });
      expect(
        lobbyCountdownService.maybeStartPublicCountdown,
      ).toHaveBeenCalledWith("r1", client.nsp.server);
    });

    it("joins IN_GAME room as SPECTATOR without broadcasting PLAYER_JOINED or triggering countdown", async () => {
      // Drop-in spectating baseline: a late-joiner must not look like a
      // new participant to the existing players, and must not start the
      // public-room auto-start countdown.
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PUBLIC",
        status: RoomStatus.IN_GAME,
        maxPlayers: 100,
        currentMatchId: "m1",
        joined: false,
        joinedAs: "SPECTATOR",
        players: [
          {
            userId: "u2",
            user: { username: "Bob" },
          },
        ],
      } as any);

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      // Spectator still joins the Socket.io room channel so they can
      // receive ROUND_STARTED / ROUND_ENDED broadcasts.
      expect(client.join).toHaveBeenCalledWith("room:r1");
      // But no PLAYER_JOINED broadcast to the rest of the room.
      expect(client.to).not.toHaveBeenCalled();
      // And no public-room countdown kick-off.
      expect(
        lobbyCountdownService.maybeStartPublicCountdown,
      ).not.toHaveBeenCalled();
      // The ROOM_JOINED payload must tell the client they are a
      // spectator so the UI can render the read-only banner.
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ROOM_JOINED,
        expect.objectContaining({
          roomId: "r1",
          code: "ABC123",
          roomStatus: RoomStatus.IN_GAME,
          currentMatchId: "m1",
          joinedAs: "SPECTATOR",
        }),
      );
    });

    it("does not emit PLAYER_JOINED when user is already in room", async () => {
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PRIVATE",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        joined: false,
        joinedAs: "PLAYER",
        players: [
          {
            userId: "u1",
            user: { username: "Alice" },
          },
        ],
      } as any);

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      expect(client.to).not.toHaveBeenCalled();
      expect(
        lobbyCountdownService.maybeStartPublicCountdown,
      ).not.toHaveBeenCalled();
    });

    it("emits error when roomCode is missing", async () => {
      await handler.handleJoinRoom(client, { roomCode: "" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.ROOM_NOT_FOUND }),
      );
    });

    it("emits error on service failure", async () => {
      vi.mocked(roomService.joinRoom).mockRejectedValue(
        new RoomError(ErrorCode.ROOM_NOT_FOUND),
      );
      await handler.handleJoinRoom(client, { roomCode: "INVALID" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.ROOM_NOT_FOUND }),
      );
    });

    it("emits INTERNAL_ERROR for generic errors", async () => {
      vi.mocked(roomService.joinRoom).mockRejectedValue(new Error("db down"));
      await handler.handleJoinRoom(client, { roomCode: "ABC" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: "Internal server error",
        }),
      );
    });

    it("uses the persisted user.username (not client.data.username) when rendering another player's tile", async () => {
      // u1 joins a room that already contains u2. The handler must look up
      // u2's username from the persisted user relation (the source of truth
      // for the lobby roster) rather than reusing client.data.username from
      // the joining socket — that would silently rename every existing
      // player to "Alice" and corrupt the lobby display.
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        joined: true,
        players: [
          // u2 is the pre-existing player — the joining user is u1, so the
          // handler must use player.user.username for this row.
          {
            userId: "u2",
            user: { username: "Bob" },
          },
        ],
      } as any);

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ROOM_JOINED,
        expect.objectContaining({
          players: [
            {
              playerId: "u2",
              playerName: "Bob",
              isOnline: false,
            },
          ],
        }),
      );
    });

    it("defaults isOnline to false and warns when presence lookup throws (e.g. Redis timeout) instead of failing the whole ROOM_JOINED", async () => {
      // Regression test: a single failed presence check must not poison the
      // whole lobby payload. The handler must degrade gracefully so the
      // joining user can still see the room.
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        joined: true,
        joinedAs: "PLAYER",
        players: [
          {
            userId: "u2",
            user: { username: "Bob" },
          },
        ],
      } as any);
      vi.mocked(presenceService.isPresent).mockRejectedValueOnce(
        new Error("Redis connection timeout"),
      );
      const logger = (
        handler as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }
      ).logger;
      const warnSpy = vi.spyOn(logger, "warn");

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      // Lobby payload still emitted with the affected player marked offline
      // (conservative default — better to show "offline" than to drop the
      // whole roster over a transient Redis blip).
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ROOM_JOINED,
        expect.objectContaining({
          players: [
            {
              playerId: "u2",
              playerName: "Bob",
              isOnline: false,
            },
          ],
        }),
      );
      // Operator-facing warning must include the player and room ids so the
      // failure is diagnosable from the logs.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /Presence lookup failed for player u2 in room r1[\s\S]*Redis connection timeout/,
        ),
      );
    });

    it("coerces non-Error rejected presence values to a string in the warn log", async () => {
      // Branch coverage: when the rejected value is not an Error instance
      // (e.g. a primitive thrown by a misbehaving Redis client mock), the
      // handler's `String(error)` fallback must produce a useful warn
      // message instead of crashing or producing "undefined".
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        joined: true,
        joinedAs: "PLAYER",
        players: [
          {
            userId: "u2",
            user: { username: "Bob" },
          },
        ],
      } as any);
      vi.mocked(presenceService.isPresent).mockRejectedValueOnce(
        "string thrown from upstream" as unknown as Error,
      );
      const logger = (
        handler as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }
      ).logger;
      const warnSpy = vi.spyOn(logger, "warn");

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("string thrown from upstream"),
      );
    });

    it("logs and emits INTERNAL_ERROR when a room player is missing its user relation (data integrity guard)", async () => {
      // Regression test: a Prisma include change must not silently produce
      // empty playerNames in the lobby. The handler must fail fast and emit
      // an INTERNAL_ERROR so the state-corruption bug is surfaced immediately
      // instead of letting the client render a blank tile.
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        currentMatchId: null,
        joined: true,
        players: [
          {
            userId: "u1",
            // user is undefined — state corruption
            user: undefined,
          },
        ],
      } as any);
      const logger = (
        handler as unknown as { logger: { error: ReturnType<typeof vi.fn> } }
      ).logger;
      const integritySpy = vi.spyOn(logger, "error");

      // The handler catches the throw inside the try/catch and emits
      // INTERNAL_ERROR (with the descriptive message swapped for the
      // generic "Internal server error" since this isn't a RoomError).
      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      // The data-integrity error must have been logged with the descriptive
      // message identifying the offending RoomPlayer
      expect(integritySpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "RoomPlayer u1 in room r1 is missing its user relation",
        ),
      );
      // The client must receive a generic INTERNAL_ERROR (not the raw
      // message — we never leak server details over the socket)
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: "Internal server error",
        }),
      );
    });
  });

  describe("handleLeaveRoom", () => {
    it("leaves a non-IN_GAME room, broadcasts PLAYER_LEFT, and calls handleRoomPlayerLeft", async () => {
      // WAITING room: the player leaving never had a match, so we
      // just notify the lobby and let handleRoomPlayerLeft decide
      // whether to cancel the countdown. The new C1 path
      // (handleMatchPlayerLeft) must NOT be taken.
      vi.mocked(roomService.leaveRoom).mockResolvedValue({
        id: "r1",
        currentMatchId: null,
        status: RoomStatus.WAITING,
      } as any);

      await handler.handleLeaveRoom(client, server, { roomId: "r1" });

      expect(roomService.leaveRoom).toHaveBeenCalledWith("r1", "u1");
      expect(client.leave).toHaveBeenCalledWith("room:r1");
      expect(server.to).toHaveBeenCalledWith("room:r1");
      const serverEmit = (server.to as any).mock.results[0].value.emit;
      expect(serverEmit).toHaveBeenCalledWith(ServerEvent.PLAYER_LEFT, {
        roomId: "r1",
        playerId: "u1",
        reason: "LEFT",
      });
      expect(lobbyCountdownService.handleRoomPlayerLeft).toHaveBeenCalledWith(
        "r1",
        server,
      );
      // C1 fix: must NOT call handleMatchPlayerLeft for WAITING rooms.
      expect(gameLoopService.handleMatchPlayerLeft).not.toHaveBeenCalled();
    });

    it("C1 fix: notifies the game loop when leaving an IN_GAME room", async () => {
      // C1 fix: a player leaving an IN_GAME room must have their
      // match state machine updated to DISCONNECTED, otherwise the
      // SUBMIT_ANSWER gate (which checks `status === ACTIVE`) keeps
      // accepting their answers from a socket that no longer
      // belongs to the ROOM channel. This is a cheating vector.
      vi.mocked(roomService.leaveRoom).mockResolvedValue({
        id: "r1",
        currentMatchId: "m1",
        status: RoomStatus.IN_GAME,
      } as any);
      // Add the new method to the mock so the handler can call it.
      (
        gameLoopService as unknown as {
          handleMatchPlayerLeft: ReturnType<typeof vi.fn>;
        }
      ).handleMatchPlayerLeft = vi.fn().mockResolvedValue(undefined);

      await handler.handleLeaveRoom(client, server, { roomId: "r1" });

      expect(roomService.leaveRoom).toHaveBeenCalledWith("r1", "u1");
      expect(client.leave).toHaveBeenCalledWith("room:r1");
      // The new C1 path is taken: game loop is notified.
      expect(
        (
          gameLoopService as unknown as {
            handleMatchPlayerLeft: ReturnType<typeof vi.fn>;
          }
        ).handleMatchPlayerLeft,
      ).toHaveBeenCalledWith("m1", "r1", "u1", server);
      // The lobby PLAYER_LEFT broadcast is NOT emitted (the
      // game loop's handleMatchPlayerLeft handles the broadcast for
      // IN_GAME rooms) — we should not double-emit.
      expect(server.to).not.toHaveBeenCalled();
      // The COUNTDOWN path is NOT taken.
      expect(lobbyCountdownService.handleRoomPlayerLeft).not.toHaveBeenCalled();
    });

    it("C1 fix: notifies the game loop when leaving a FINISHED room", async () => {
      // FINISHED is included in the C1 fix because the room still
      // has a currentMatchId (the match ended moments ago). Marking
      // the player DISCONNECTED is harmless but consistent with the
      // IN_GAME path.
      vi.mocked(roomService.leaveRoom).mockResolvedValue({
        id: "r1",
        currentMatchId: "m1",
        status: RoomStatus.FINISHED,
      } as any);
      (
        gameLoopService as unknown as {
          handleMatchPlayerLeft: ReturnType<typeof vi.fn>;
        }
      ).handleMatchPlayerLeft = vi.fn().mockResolvedValue(undefined);

      await handler.handleLeaveRoom(client, server, { roomId: "r1" });

      expect(
        (
          gameLoopService as unknown as {
            handleMatchPlayerLeft: ReturnType<typeof vi.fn>;
          }
        ).handleMatchPlayerLeft,
      ).toHaveBeenCalledWith("m1", "r1", "u1", server);
    });

    it("IN_GAME room with no currentMatchId falls back to the lobby path", async () => {
      // Defensive: a room could be IN_GAME without a currentMatchId
      // (e.g. the match was rolled back). The C1 path requires
      // BOTH a currentMatchId AND an IN_GAME/FINISHED status. If
      // either is missing we fall through to the lobby path.
      vi.mocked(roomService.leaveRoom).mockResolvedValue({
        id: "r1",
        currentMatchId: null,
        status: RoomStatus.IN_GAME,
      } as any);
      (
        gameLoopService as unknown as {
          handleMatchPlayerLeft: ReturnType<typeof vi.fn>;
        }
      ).handleMatchPlayerLeft = vi.fn().mockResolvedValue(undefined);

      await handler.handleLeaveRoom(client, server, { roomId: "r1" });

      // Lobby path: PLAYER_LEFT broadcast + handleRoomPlayerLeft.
      expect(server.to).toHaveBeenCalledWith("room:r1");
      expect(lobbyCountdownService.handleRoomPlayerLeft).toHaveBeenCalledWith(
        "r1",
        server,
      );
      // C1 path NOT taken.
      expect(
        (
          gameLoopService as unknown as {
            handleMatchPlayerLeft: ReturnType<typeof vi.fn>;
          }
        ).handleMatchPlayerLeft,
      ).not.toHaveBeenCalled();
    });

    it("emits error on failure", async () => {
      vi.mocked(roomService.leaveRoom).mockRejectedValue(new Error("fail"));
      await handler.handleLeaveRoom(client, server, { roomId: "r1" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: "Internal server error",
        }),
      );
    });
  });
});
