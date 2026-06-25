import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ClientEvent,
  ErrorCode,
  GAME_CONFIG,
  SubmitAnswerPayloadSchema,
  CreateRoomPayloadSchema,
  AuthenticatePayloadSchema,
  LeaveRoomPayloadSchema,
  HeartbeatPayloadSchema,
  RequestSnapshotPayloadSchema,
  JoinRoomPayloadSchema,
  StartMatchPayloadSchema,
} from "@arena/shared";
import { GameGateway } from "./game.gateway";
import { AuthHandler, RoomHandler, MatchHandler } from "./handlers";
import { AuthService } from "../modules/auth/auth.service";
import { PresenceService } from "../modules/match/presence.service";
import { GameLoopService } from "../modules/match/game-loop.service";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";

describe("GameGateway", () => {
  let gateway: GameGateway;
  let authHandler: AuthHandler;
  let roomHandler: RoomHandler;
  let matchHandler: MatchHandler;
  let authService: AuthService;
  let presenceService: PresenceService;
  let gameLoopService: GameLoopService;
  let client: Socket;

  beforeEach(() => {
    authHandler = {
      handleAuthenticate: vi.fn(),
      handleDisconnect: vi.fn(),
    } as unknown as AuthHandler;
    roomHandler = {
      handleCreateRoom: vi.fn(),
      handleJoinRoom: vi.fn(),
      handleLeaveRoom: vi.fn(),
    } as unknown as RoomHandler;
    matchHandler = {
      handleStartMatch: vi.fn(),
      handleSubmitAnswer: vi.fn(),
      handleRequestSnapshot: vi.fn(),
    } as unknown as MatchHandler;
    authService = {
      verifyToken: vi.fn(),
    } as unknown as AuthService;
    presenceService = {
      setServer: vi.fn(),
      updatePresence: vi.fn().mockResolvedValue(undefined),
    } as unknown as PresenceService;
    gameLoopService = {
      setServer: vi.fn(),
    } as unknown as GameLoopService;

    gateway = new GameGateway(
      authHandler,
      roomHandler,
      matchHandler,
      authService,
      presenceService,
      gameLoopService,
    );
    // Set the private _server field
    (gateway as any)._server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    client = {
      id: "socket-1",
      emit: vi.fn(),
      join: vi.fn(),
      data: {},
      rooms: new Set<string>(),
    } as unknown as Socket;
  });

  describe("handleConnection", () => {
    it("logs connection without error", async () => {
      await gateway.handleConnection(client);
      // handleConnection only logs now; no reconnection logic
    });
  });

  describe("afterInit middleware", () => {
    let middleware: any;
    let mockServer: any;

    beforeEach(() => {
      mockServer = {
        use: vi.fn().mockImplementation((fn) => {
          middleware = fn;
        }),
      };
      gateway.afterInit(mockServer);
    });

    it("registers a middleware and sets server on presence service", () => {
      expect(mockServer.use).toHaveBeenCalled();
      expect(middleware).toBeTypeOf("function");
      expect(presenceService.setServer).toHaveBeenCalledWith(mockServer);
      expect(gameLoopService.setServer).toHaveBeenCalledWith(mockServer);
    });

    it("successfully authenticates with auth.token", () => {
      const mockSocket = {
        handshake: {
          auth: { token: "valid-token" },
          headers: {},
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "user-123",
        username: "test-user",
      } as any);

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith("valid-token");
      expect(mockSocket.data.userId).toBe("user-123");
      expect(mockSocket.data.username).toBe("test-user");
      expect(next).toHaveBeenCalled();
    });

    it("successfully authenticates with authorization header (Bearer)", () => {
      const mockSocket = {
        handshake: {
          auth: {},
          headers: { authorization: "Bearer valid-token-bearer" },
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "user-456",
        username: "bearer-user",
      } as any);

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith(
        "valid-token-bearer",
      );
      expect(mockSocket.data.userId).toBe("user-456");
      expect(mockSocket.data.username).toBe("bearer-user");
      expect(next).toHaveBeenCalled();
    });

    it("successfully authenticates with authorization header (plain)", () => {
      const mockSocket = {
        handshake: {
          auth: {},
          headers: { authorization: "valid-token-plain" },
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "user-789",
        username: "plain-user",
      } as any);

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith("valid-token-plain");
      expect(mockSocket.data.userId).toBe("user-789");
      expect(mockSocket.data.username).toBe("plain-user");
      expect(next).toHaveBeenCalled();
    });

    it("handles connection without token gracefully", () => {
      const mockSocket = {
        handshake: {
          auth: {},
          headers: {},
        },
        data: {},
      } as any;
      const next = vi.fn();

      middleware(mockSocket, next);

      expect(authService.verifyToken).not.toHaveBeenCalled();
      expect(mockSocket.data.userId).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it("handles invalid token gracefully without throwing", () => {
      const mockSocket = {
        handshake: {
          auth: { token: "invalid-token" },
          headers: {},
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith("invalid-token");
      expect(mockSocket.data.userId).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("handleDisconnect", () => {
    it("delegates to authHandler", async () => {
      await gateway.handleDisconnect(client);
      expect(authHandler.handleDisconnect).toHaveBeenCalledWith(client);
    });

    // L2 fix: handleDisconnect is async on authHandler (queries active
    // rooms, notifies match). The gateway must `await` the call so any
    // thrown error propagates through Nest's lifecycle instead of being
    // swallowed as an unhandled rejection. This test pins that behavior
    // by making the handler reject and asserting the gateway rejects
    // too — if anyone removes the `await`, this test fails.
    it("propagates errors from authHandler.handleDisconnect instead of swallowing them", async () => {
      vi.mocked(authHandler.handleDisconnect).mockRejectedValueOnce(
        new Error("simulated disconnect failure"),
      );
      await expect(gateway.handleDisconnect(client)).rejects.toThrow(
        "simulated disconnect failure",
      );
    });
  });

  describe("event handlers", () => {
    it("handleAuthenticate delegates to authHandler", () => {
      gateway.handleAuthenticate(client, { token: "t" });
      expect(authHandler.handleAuthenticate).toHaveBeenCalledWith(client, {
        token: "t",
      });
    });

    it("handleCreateRoom delegates to roomHandler", () => {
      gateway.handleCreateRoom(client, { roomType: "PUBLIC", maxPlayers: 10 });
      expect(roomHandler.handleCreateRoom).toHaveBeenCalledWith(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
    });

    it("handleJoinRoom delegates to roomHandler", () => {
      gateway.handleJoinRoom(client, { roomCode: "ABC" });
      expect(roomHandler.handleJoinRoom).toHaveBeenCalledWith(client, {
        roomCode: "ABC",
      });
    });

    it("handleLeaveRoom delegates to roomHandler with server", () => {
      gateway.handleLeaveRoom(client, { roomId: "r1" });
      expect(roomHandler.handleLeaveRoom).toHaveBeenCalledWith(
        client,
        (gateway as any)._server,
        { roomId: "r1" },
      );
    });

    it("handleStartMatch delegates to matchHandler with server", () => {
      gateway.handleStartMatch(client, { roomId: "r1" });
      expect(matchHandler.handleStartMatch).toHaveBeenCalledWith(
        client,
        (gateway as any)._server,
        { roomId: "r1" },
      );
    });

    it("handleSubmitAnswer delegates to matchHandler", () => {
      gateway.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });
      expect(matchHandler.handleSubmitAnswer).toHaveBeenCalledWith(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });
    });

    it("handleRequestSnapshot delegates to matchHandler", () => {
      gateway.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });
      expect(matchHandler.handleRequestSnapshot).toHaveBeenCalledWith(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });
    });

    it("handlePing emits PONG with timestamp", () => {
      gateway.handlePing(client);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.PONG, {
        timestamp: expect.any(Number),
      });
    });

    // ---- C2 fix: WS payload validation ----
    //
    // The gateway's @SubscribeMessage handlers apply a WsValidationPipe
    // to the @MessageBody. In a real Socket.io invocation NestJS runs
    // the pipe before the handler body. We can't easily exercise that
    // path through direct handler calls (the @MessageBody decorator is
    // a no-op when the handler is invoked directly). What we CAN pin
    // here is:
    //
    // 1. The same Zod schema the pipe uses rejects malformed payloads.
    // 2. The gateway imports those schemas from the shared package so
    //    the validation is shared across the server, the test, and any
    //    future client SDK.
    //
    // Together with the dedicated WsValidationPipe unit tests in
    // ws-validation.pipe.spec.ts, this covers the C2 contract: "no
    // malformed WS payload reaches a handler".
    describe("C2: WS payload validation", () => {
      it("SUBMIT_ANSWER schema rejects an object injection in `answer`", async () => {
        // The C2 attack vector: a client sends { answer: { inject: true
        // } } and the gateway would have happily passed it to the
        // handler. With the pipe, this throws WsValidationError before
        // the handler runs.
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: { inject: true },
          submissionId: "s1",
          clientTimestamp: Date.now(),
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema rejects missing matchId", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
          clientTimestamp: Date.now(),
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema rejects oversized answer string", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "x".repeat(2000),
          submissionId: "s1",
          clientTimestamp: Date.now(),
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema rejects missing submissionId", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          clientTimestamp: Date.now(),
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema rejects oversized submissionId", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "x".repeat(65),
          clientTimestamp: Date.now(),
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema accepts submissionId at max length", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "x".repeat(64),
          clientTimestamp: Date.now(),
        });
        expect(result.success).toBe(true);
      });

      // L3 fix: clientTimestamp used to allow ~1 year of slack on either
      // side of `Date.now()`, which accepted clearly corrupt payloads
      // (e.g. clock off by a year) while still catching the obvious
      // fuzz inputs. Tightened to 5 minutes — see schemas.ts. The
      // boundary tests below pin both sides of the new limit so a
      // regression that re-widens the bound (or narrows it incorrectly)
      // is caught here.
      it("SUBMIT_ANSWER schema rejects clientTimestamp 1 year in the past", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
          clientTimestamp: Date.now() - 365 * 24 * 60 * 60 * 1000,
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema rejects clientTimestamp 6 minutes in the past", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
          clientTimestamp: Date.now() - 6 * 60 * 1000,
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema rejects clientTimestamp 6 minutes in the future", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
          clientTimestamp: Date.now() + 6 * 60 * 1000,
        });
        expect(result.success).toBe(false);
      });

      it("SUBMIT_ANSWER schema accepts clientTimestamp 4 minutes in the past (within headroom)", () => {
        const result = SubmitAnswerPayloadSchema.safeParse({
          matchId: "m1",
          roundNo: 1,
          answer: "A",
          submissionId: "s1",
          clientTimestamp: Date.now() - 4 * 60 * 1000,
        });
        expect(result.success).toBe(true);
      });

      it("CREATE_ROOM schema caps maxPlayers to GAME_CONFIG.MAX_PLAYERS", () => {
        // Bonus M2 fix: a client asking for a 100,000-player room is
        // rejected at the validation layer, never reaching the
        // service.
        const result = CreateRoomPayloadSchema.safeParse({
          roomType: "PUBLIC",
          maxPlayers: 100_000,
        });
        expect(result.success).toBe(false);
      });

      it("CREATE_ROOM schema rejects unknown roomType enum", () => {
        const result = CreateRoomPayloadSchema.safeParse({
          roomType: "WEDDING",
        });
        expect(result.success).toBe(false);
      });

      it("AUTHENTICATE schema rejects empty token", () => {
        const result = AuthenticatePayloadSchema.safeParse({ token: "" });
        expect(result.success).toBe(false);
      });

      it("LEAVE_ROOM schema requires roomId", () => {
        const result = LeaveRoomPayloadSchema.safeParse({});
        expect(result.success).toBe(false);
      });

      it("HEARTBEAT schema accepts sentAt=0 (boundary)", () => {
        const result = HeartbeatPayloadSchema.safeParse({ sentAt: 0 });
        expect(result.success).toBe(true);
      });

      it("REQUEST_SNAPSHOT schema rejects negative lastSeenSeqNo", () => {
        const result = RequestSnapshotPayloadSchema.safeParse({
          matchId: "m1",
          lastSeenSeqNo: -1,
        });
        expect(result.success).toBe(false);
      });

      // L3 fix: lastSeenSeqNo used to be capped at Number.MAX_SAFE_INTEGER,
      // which accepted obviously bogus cursors. Tightened to
      // GAME_CONFIG.MAX_ROUNDS * 2 — see schemas.ts.
      it("REQUEST_SNAPSHOT schema rejects lastSeenSeqNo above MAX_ROUNDS * 2", () => {
        const result = RequestSnapshotPayloadSchema.safeParse({
          matchId: "m1",
          lastSeenSeqNo: GAME_CONFIG.MAX_ROUNDS * 2 + 1,
        });
        expect(result.success).toBe(false);
      });

      it("REQUEST_SNAPSHOT schema accepts lastSeenSeqNo at MAX_ROUNDS * 2 (boundary)", () => {
        const result = RequestSnapshotPayloadSchema.safeParse({
          matchId: "m1",
          lastSeenSeqNo: GAME_CONFIG.MAX_ROUNDS * 2,
        });
        expect(result.success).toBe(true);
      });

      it("JOIN_ROOM schema accepts an empty payload (roomCode and roomType are optional)", () => {
        // JOIN_ROOM is a public-lobby lookup when both fields are
        // absent. A regression that makes either field required
        // would break the "browse public rooms" flow.
        const result = JoinRoomPayloadSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it("JOIN_ROOM schema rejects unknown roomType enum", () => {
        const result = JoinRoomPayloadSchema.safeParse({
          roomCode: "ABC",
          roomType: "WEDDING",
        });
        expect(result.success).toBe(false);
      });

      it("START_MATCH schema requires a non-empty roomId", () => {
        const result = StartMatchPayloadSchema.safeParse({ roomId: "" });
        expect(result.success).toBe(false);
      });
    });

    describe("handleHeartbeat", () => {
      it("updates presence when user is a member of the heartbeat room", async () => {
        client.data.userId = "u1";
        (client.rooms as Set<string>).add("room:r1");

        await gateway.handleHeartbeat(client, {
          roomId: "r1",
          sentAt: Date.now(),
        });

        expect(presenceService.updatePresence).toHaveBeenCalledWith("r1", "u1");
      });

      it("skips presence update when the user is not a member of the heartbeat room", async () => {
        client.data.userId = "u1";
        (client.rooms as Set<string>).add("room:r2");

        await gateway.handleHeartbeat(client, {
          roomId: "r1",
          sentAt: Date.now(),
        });

        expect(presenceService.updatePresence).not.toHaveBeenCalled();
      });

      it("ignores the event when userId is missing", async () => {
        client.data = {};
        await gateway.handleHeartbeat(client, {
          roomId: "r1",
          sentAt: Date.now(),
        });

        expect(presenceService.updatePresence).not.toHaveBeenCalled();
      });

      it("ignores the event when roomId is missing", async () => {
        client.data.userId = "u1";
        await gateway.handleHeartbeat(client, {
          roomId: "",
          sentAt: Date.now(),
        });

        expect(presenceService.updatePresence).not.toHaveBeenCalled();
      });

      it("catches presence update errors and warns without throwing", async () => {
        client.data.userId = "u1";
        (client.rooms as Set<string>).add("room:r1");
        vi.mocked(presenceService.updatePresence).mockRejectedValueOnce(
          new Error("redis down"),
        );
        const warnSpy = vi.spyOn(gateway["logger"], "warn");

        await expect(
          gateway.handleHeartbeat(client, { roomId: "r1", sentAt: Date.now() }),
        ).resolves.not.toThrow();

        expect(warnSpy.mock.calls[0][0]).toMatch(/u1.*r1/);
      });
    });
  });

  describe("GameGateway WsValidationPipe Integration", () => {
    let app: INestApplication;
    let clientSocket: ClientSocket;
    let port: number;

    const mockAuthHandler = {
      handleAuthenticate: vi.fn(),
      handleDisconnect: vi.fn(),
    };
    const mockRoomHandler = {
      handleCreateRoom: vi.fn(),
      handleJoinRoom: vi.fn(),
      handleLeaveRoom: vi.fn(),
    };
    const mockMatchHandler = {
      handleStartMatch: vi.fn(),
      handleSubmitAnswer: vi.fn(),
      handleRequestSnapshot: vi.fn(),
    };
    const mockAuthService = {
      verifyToken: vi.fn(),
    };
    const mockPresenceService = {
      setServer: vi.fn(),
      updatePresence: vi.fn(),
    };
    const mockGameLoopService = {
      setServer: vi.fn(),
    };

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        providers: [
          GameGateway,
          { provide: AuthHandler, useValue: mockAuthHandler },
          { provide: RoomHandler, useValue: mockRoomHandler },
          { provide: MatchHandler, useValue: mockMatchHandler },
          { provide: AuthService, useValue: mockAuthService },
          { provide: PresenceService, useValue: mockPresenceService },
          { provide: GameLoopService, useValue: mockGameLoopService },
        ],
      }).compile();

      app = moduleFixture.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.listen(0);
      const address = app.getHttpServer().address();
      port = typeof address === "string" ? 0 : address.port;
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      mockAuthService.verifyToken.mockReturnValue({
        userId: "user-123",
        username: "test-user",
      });

      clientSocket = ioClient(`http://localhost:${port}/game`, {
        autoConnect: false,
        transports: ["websocket"],
        auth: { token: "valid-token" },
      });

      clientSocket.connect();
      await new Promise<void>((resolve, reject) => {
        clientSocket.on("connect", () => resolve());
        clientSocket.on("connect_error", (err) => reject(err));
      });
    });

    afterEach(() => {
      if (clientSocket.connected) {
        clientSocket.disconnect();
      }
    });

    it("triggers WsValidationPipe and returns WsValidationError for malformed SubmitAnswer", async () => {
      const malformedPayload = {
        roundNo: 1,
        answer: "A",
        submissionId: "s1",
        clientTimestamp: Date.now(),
      };

      const errorPromise = new Promise<{ code: string; message: string }>(
        (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timeout waiting for ERROR event")),
            1000,
          );
          clientSocket.on(ServerEvent.ERROR, (err) => {
            clearTimeout(timeout);
            resolve(err);
          });
        },
      );

      clientSocket.emit(ClientEvent.SUBMIT_ANSWER, malformedPayload);

      const error = await errorPromise;
      expect(error.code).toBe(ErrorCode.INVALID_PAYLOAD);
      expect(error.message).toContain("matchId");
      expect(mockMatchHandler.handleSubmitAnswer).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for oversized SubmitAnswer", async () => {
      const malformedPayload = {
        matchId: "m1",
        roundNo: 1,
        answer: "x".repeat(2000),
        submissionId: "s1",
        clientTimestamp: Date.now(),
      };

      const errorPromise = new Promise<{ code: string; message: string }>(
        (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timeout waiting for ERROR event")),
            1000,
          );
          clientSocket.on(ServerEvent.ERROR, (err) => {
            clearTimeout(timeout);
            resolve(err);
          });
        },
      );

      clientSocket.emit(ClientEvent.SUBMIT_ANSWER, malformedPayload);

      const error = await errorPromise;
      expect(error.code).toBe(ErrorCode.INVALID_PAYLOAD);
      expect(error.message).toContain("answer");
      expect(mockMatchHandler.handleSubmitAnswer).not.toHaveBeenCalled();
    });

    it("does not trigger WsValidationPipe for valid SubmitAnswer and reaches handler", async () => {
      const validPayload = {
        matchId: "m1",
        roundNo: 1,
        answer: "A",
        submissionId: "s1",
        clientTimestamp: Date.now(),
      };

      const handlerCalled = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(new Error("Timeout waiting for handleSubmitAnswer call")),
          1000,
        );
        mockMatchHandler.handleSubmitAnswer.mockImplementationOnce(async () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      clientSocket.emit(ClientEvent.SUBMIT_ANSWER, validPayload);

      await handlerCalled;

      expect(mockMatchHandler.handleSubmitAnswer).toHaveBeenCalled();
    });

    const emitAndExpectError = (
      event: ClientEvent,
      payload: any,
      expectedErrorField: string,
    ): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(new Error(`Timeout waiting for ERROR event on ${event}`)),
          1000,
        );
        clientSocket.once(
          ServerEvent.ERROR,
          (err: { code: string; message: string }) => {
            clearTimeout(timeout);
            try {
              expect(err.code).toBe(ErrorCode.INVALID_PAYLOAD);
              expect(err.message).toContain(expectedErrorField);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        );
        clientSocket.emit(event, payload);
      });
    };

    it("triggers WsValidationPipe and returns WsValidationError for invalid Authenticate payload", async () => {
      const malformedPayload = {
        token: "",
      };

      await emitAndExpectError(
        ClientEvent.AUTHENTICATE,
        malformedPayload,
        "token",
      );
      expect(mockAuthHandler.handleAuthenticate).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for invalid CreateRoom payload (invalid roomType)", async () => {
      const malformedPayload = {
        roomType: "INVALID_TYPE",
        maxPlayers: 10,
      };

      await emitAndExpectError(
        ClientEvent.CREATE_ROOM,
        malformedPayload,
        "roomType",
      );
      expect(mockRoomHandler.handleCreateRoom).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for invalid CreateRoom payload (maxPlayers out of bounds)", async () => {
      const malformedPayload = {
        roomType: "PUBLIC",
        maxPlayers: 1,
      };

      await emitAndExpectError(
        ClientEvent.CREATE_ROOM,
        malformedPayload,
        "maxPlayers",
      );
      expect(mockRoomHandler.handleCreateRoom).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for invalid JoinRoom payload", async () => {
      const malformedPayload = {
        roomType: "INVALID_TYPE",
      };

      await emitAndExpectError(
        ClientEvent.JOIN_ROOM,
        malformedPayload,
        "roomType",
      );
      expect(mockRoomHandler.handleJoinRoom).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for invalid LeaveRoom payload", async () => {
      const malformedPayload = {};

      await emitAndExpectError(
        ClientEvent.LEAVE_ROOM,
        malformedPayload,
        "roomId",
      );
      expect(mockRoomHandler.handleLeaveRoom).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for invalid StartMatch payload", async () => {
      const malformedPayload = {
        roomId: "",
      };

      await emitAndExpectError(
        ClientEvent.START_MATCH,
        malformedPayload,
        "roomId",
      );
      expect(mockMatchHandler.handleStartMatch).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for invalid RequestSnapshot payload", async () => {
      const malformedPayload = {
        matchId: "m1",
        lastSeenSeqNo: -5,
      };

      await emitAndExpectError(
        ClientEvent.REQUEST_SNAPSHOT,
        malformedPayload,
        "lastSeenSeqNo",
      );
      expect(mockMatchHandler.handleRequestSnapshot).not.toHaveBeenCalled();
    });

    it("triggers WsValidationPipe and returns WsValidationError for invalid Heartbeat payload", async () => {
      const malformedPayload = {
        sentAt: -100,
      };

      await emitAndExpectError(
        ClientEvent.HEARTBEAT,
        malformedPayload,
        "sentAt",
      );
      expect(mockPresenceService.updatePresence).not.toHaveBeenCalled();
    });
  });
});
