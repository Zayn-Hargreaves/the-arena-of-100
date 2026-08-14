import { Socket, Server } from "socket.io";
import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  ServerEvent,
  ErrorCode,
  ERROR_MESSAGES,
  ERROR_MESSAGE_KEYS,
  PlayerStatus,
  RoomStatus,
  RoomError,
  ClientEvent,
} from "@arena/shared";
import { MatchHandler } from "./match.handler";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { MatchCommandService } from "../../modules/match/match-command.service";
import { ClusterService } from "../../modules/cluster/cluster.service";

describe("MatchHandler", () => {
  let handler: MatchHandler;
  let roomService: RoomService;
  let matchService: MatchService;
  let gameLoopService: {
    checkEarlyTermination: ReturnType<typeof vi.fn>;
    forceStartRoomMatch: ReturnType<typeof vi.fn>;
  };
  let matchCommand: { forward: ReturnType<typeof vi.fn> };
  let client: Socket;
  let server: Server;
  // Per-room broadcaster list populated by the `server.to` mock so
  // CARD_RESOLVED tests can assert exact destination-specific
  // payloads (sanitized room vs. full-effect player rooms) and
  // detect repeated `server.to(roomName)` calls or duplicate
  // broadcasts to the same room.
  type RoomOperator = {
    emit: ReturnType<typeof vi.fn>;
    except: ReturnType<typeof vi.fn>;
  };
  let roomOperators: Map<string, RoomOperator[]>;

  beforeEach(() => {
    roomService = { getRoom: vi.fn() } as unknown as RoomService;
    matchService = {
      getStateMachine: vi.fn(),
      persistStateMachine: vi.fn(),
      getRoomIdByMatchId: vi.fn().mockResolvedValue("r1"),
    } as unknown as MatchService;
    gameLoopService = {
      checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      forceStartRoomMatch: vi.fn().mockResolvedValue({ id: "m1" }),
    };
    matchCommand = { forward: vi.fn().mockResolvedValue(undefined) };
    roomOperators = new Map();
    handler = new MatchHandler(
      roomService,
      matchService,
      gameLoopService as unknown as GameLoopService,
      matchCommand as unknown as MatchCommandService,
      { nodeId: "node-a" } as unknown as ClusterService,
    );
    server = {
      // Per-room broadcaster list so each `server.to(roomName)`
      // call APPENDS a fresh operator to the per-room list instead
      // of overwriting the previous one. CARD_RESOLVED delivery
      // routes one sanitized effect to the room channel and one
      // full effect to each target's private player channel — tests
      // need to assert against each specific destination AND detect
      // duplicate `server.to` calls / duplicate broadcasts when the
      // same room appears more than once.
      to: vi.fn().mockImplementation((roomName: string) => {
        const except = vi.fn().mockReturnValue({ emit: vi.fn() });
        const operator = { emit: vi.fn(), except };
        const operators = roomOperators.get(roomName) ?? [];
        operators.push(operator);
        roomOperators.set(roomName, operators);
        return operator;
      }),
    } as unknown as Server;
    client = {
      emit: vi.fn(),
      data: { userId: "u1", username: "Alice" },
      // H6 fix: handleRequestSnapshot now checks socket channel
      // membership. Default the client to having joined room r1
      // so the existing happy-path tests keep working. The
      // H6-rejection test mutates this directly.
      rooms: new Set<string>(["room:r1"]),
      nsp: {
        server: server,
      },
    } as unknown as Socket;
  });

  describe("handleStartMatch", () => {
    it("starts match when user is host", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValue({
        hostId: "u1",
        type: "PRIVATE",
        status: RoomStatus.WAITING,
      } as any);

      await handler.handleStartMatch(client, server, { roomId: "r1" });

      expect(gameLoopService.forceStartRoomMatch).toHaveBeenCalledWith(
        "r1",
        server,
      );
    });

    it("emits error when room is public", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValue({
        hostId: "u1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
      } as any);

      await handler.handleStartMatch(client, server, { roomId: "r1" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_ROOM_TYPE,
        message: ERROR_MESSAGES[ErrorCode.INVALID_ROOM_TYPE],
      });
    });

    it("emits error when room status is not WAITING", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValue({
        hostId: "u1",
        type: "PRIVATE",
        status: RoomStatus.IN_GAME,
      } as any);

      await handler.handleStartMatch(client, server, { roomId: "r1" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.ROOM_ALREADY_STARTED,
        message: ERROR_MESSAGES[ErrorCode.ROOM_ALREADY_STARTED],
      });
    });

    it("emits error when user is not host", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValue({
        hostId: "other",
      } as any);

      await handler.handleStartMatch(client, server, { roomId: "r1" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.NOT_ROOM_HOST,
        message: ERROR_MESSAGES[ErrorCode.NOT_ROOM_HOST],
      });
    });

    it("emits error when not authenticated", async () => {
      client.data = {};
      await handler.handleStartMatch(client, server, { roomId: "r1" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it("emits error on service failure", async () => {
      vi.mocked(roomService.getRoom).mockRejectedValue(new Error("fail"));
      await handler.handleStartMatch(client, server, { roomId: "r1" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
        }),
      );
    });

    it("handles non-Error thrown values", async () => {
      vi.mocked(roomService.getRoom).mockRejectedValue("string error");
      await handler.handleStartMatch(client, server, { roomId: "r1" });
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
      });
    });

    it("emits not-enough-players when force start preconditions fail", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValue({
        hostId: "u1",
        type: "PRIVATE",
        status: RoomStatus.WAITING,
      } as any);
      gameLoopService.forceStartRoomMatch.mockRejectedValue(
        new RoomError(ErrorCode.NOT_ENOUGH_PLAYERS),
      );

      await handler.handleStartMatch(client, server, { roomId: "r1" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.NOT_ENOUGH_PLAYERS,
        message: ERROR_MESSAGES[ErrorCode.NOT_ENOUGH_PLAYERS],
      });
    });
  });

  describe("handleSubmitAnswer (B4b single-writer)", () => {
    const activeMachine = (userId = "u1") =>
      ({
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([
            [userId, { id: userId, status: PlayerStatus.ACTIVE }],
          ]),
        }),
        getCurrentRound: vi
          .fn()
          .mockReturnValue({ roundNo: 1, answers: new Map() }),
      }) as any;

    it("forwards the answer to the owner command channel instead of applying locally", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        activeMachine(),
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      // Durable forward with a well-formed submit_answer envelope.
      expect(matchCommand.forward).toHaveBeenCalledTimes(1);
      const env = matchCommand.forward.mock.calls[0][0];
      expect(env).toMatchObject({
        schemaVersion: 1,
        matchId: "m1",
        emittedByNodeId: "node-a",
        body: {
          type: "submit_answer",
          userId: "u1",
          answer: "A",
          submissionId: "s1",
        },
      });
      expect(typeof env.eventId).toBe("string");
      expect(env.eventId.length).toBeGreaterThan(0);
    });

    it("does NOT apply/persist/emit ANSWER_RESULT locally (owner is the sole writer)", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        activeMachine(),
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      expect(gameLoopService.checkEarlyTermination).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith(
        ServerEvent.ANSWER_RESULT,
        expect.anything(),
      );
    });

    it("rejects a spectator (not in the match roster) and does not forward", async () => {
      const machine = {
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map(), // u1 is not a player
        }),
        getCurrentRound: vi.fn().mockReturnValue(null),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(matchCommand.forward).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.SPECTATOR_CANNOT_ANSWER }),
      );
    });

    it("rejects a DISCONNECTED player with PLAYER_DISCONNECTED and does not forward", async () => {
      const machine = {
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([
            ["u1", { id: "u1", status: PlayerStatus.DISCONNECTED }],
          ]),
        }),
        getCurrentRound: vi
          .fn()
          .mockReturnValue({ roundNo: 1, answers: new Map() }),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(matchCommand.forward).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.PLAYER_DISCONNECTED }),
      );
    });

    it("throws MATCH_NOT_FOUND when the match state machine is absent", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        undefined as any,
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "gone",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(matchCommand.forward).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.MATCH_NOT_FOUND }),
      );
    });

    it("emits INTERNAL_ERROR when matchCommand.forward rejects with a non-RoomError", async () => {
      // A plain Error from the durable forward path is treated as
      // an internal failure: log it server-side and emit the
      // INTERNAL_ERROR i18n key (never the raw error message).
      const errorSpy = vi
        .spyOn(
          (
            handler as unknown as {
              logger: { error: ReturnType<typeof vi.fn> };
            }
          ).logger,
          "error",
        )
        .mockImplementation(() => {});
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        activeMachine(),
      );
      vi.mocked(matchCommand.forward).mockRejectedValueOnce(
        new Error("internal failure"),
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(errorSpy).toHaveBeenCalledWith(
        "Error submitting answer:",
        expect.any(Error),
      );
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
          failedEvent: ClientEvent.SUBMIT_ANSWER,
          submissionId: "s1",
        }),
      );
    });
  });

  describe("handleRequestSnapshot", () => {
    it("emits snapshot on success", async () => {
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      const mockMachine = {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
        // H6 fix: handleRequestSnapshot reads state.roomId to
        // verify socket channel membership. Provide it in the
        // mock so the happy path passes the new gate.
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        // Plan D delta replay: the handler reads the event-log window
        // to decide delta vs full. head=0 (empty log) keeps this a
        // full-snapshot path, so getSnapshot(head=0) is still called.
        getHeadSeqNo: vi.fn().mockReturnValue(0),
        getFloorSeqNo: vi.fn().mockReturnValue(0),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });

      expect(mockMachine.getSnapshot).toHaveBeenCalledWith(0);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot);
    });

    it("allows a non-player user to request a snapshot (drop-in spectator path)", async () => {
      // Drop-in spectating baseline: handleRequestSnapshot is the
      // entry point spectators use after joining an IN_GAME or
      // FINISHED room. Unlike handleSubmitAnswer, this method must
      // remain open to non-players — that is the whole point of the
      // baseline. The snapshot is client-safe (no correctAnswer
      // leakage) so this is a deliberate allow-list.
      //
      // H6 fix follow-up: the H6 gate is on socket channel
      // membership, NOT on player roster. A spectator's socket is
      // in the room channel (handleJoinRoom calls client.join), so
      // the H6 check passes for them. The roster check is still
      // intentionally absent — see the comment in the handler.
      const snapshot = {
        matchId: "m1",
        status: "ROUND_ACTIVE",
        currentQuestion: { id: "q1", content: "Q?", options: ["A", "B"] },
      };
      const mockMachine = {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(0),
        getFloorSeqNo: vi.fn().mockReturnValue(0),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      // No roster check — the handler never inspects the player map
      // here. We simply assert that the snapshot flows through.
      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot);
      // Regression guard: the snapshot payload must NOT contain a
      // correctAnswer field. If a future change starts leaking it,
      // this assertion will fail loudly.
      const emitted = (client.emit as ReturnType<typeof vi.fn>).mock.calls
        .filter((c) => c[0] === ServerEvent.SNAPSHOT)
        .map((c) => c[1])[0] as Record<string, unknown>;
      expect(emitted).not.toHaveProperty("correctAnswer");
      if (
        emitted.currentQuestion &&
        typeof emitted.currentQuestion === "object"
      ) {
        expect(emitted.currentQuestion).not.toHaveProperty("correctAnswer");
      }
    });

    it("H6 fix: rejects a requester who is not in the room channel", async () => {
      // H6 fix: the new room-membership gate rejects any
      // authenticated user who is not in the room's Socket.io
      // channel — even with a valid token and a known matchId.
      // Without this, anyone who knew a matchId could read the
      // full match state (player roster, scores, current
      // question). Plan D: room auth runs before getStateMachine.
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      const mockMachine = {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(0),
        getFloorSeqNo: vi.fn().mockReturnValue(0),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      // Clear the default room:r1 from client.rooms; this client
      // is NOT a member of the room's channel.
      (client.rooms as Set<string>).clear();

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });

      // No snapshot was emitted.
      expect(client.emit).not.toHaveBeenCalledWith(
        ServerEvent.SNAPSHOT,
        expect.anything(),
      );
      // An UNAUTHORIZED error was emitted instead.
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
      // getStateMachine was NEVER called — room auth fires first.
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(mockMachine.getSnapshot).not.toHaveBeenCalled();
    });

    it("emits error when match not found", async () => {
      vi.mocked(matchService.getRoomIdByMatchId).mockResolvedValue(undefined);

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.MATCH_NOT_FOUND,
        message: ERROR_MESSAGES[ErrorCode.MATCH_NOT_FOUND],
        failedEvent: ClientEvent.REQUEST_SNAPSHOT,
      });
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
    });

    it("emits error when not authenticated", async () => {
      client.data = {};
      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.UNAUTHORIZED,
          failedEvent: ClientEvent.REQUEST_SNAPSHOT,
        }),
      );
    });

    it("handles non-Error thrown values", async () => {
      const mockMachine = {
        getSnapshot: vi.fn().mockImplementation(() => {
          throw "snapshot failure";
        }),
        // H6 fix: provide state.roomId so the gate doesn't reject
        // before the throw is reached.
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(0),
        getFloorSeqNo: vi.fn().mockReturnValue(0),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
        failedEvent: ClientEvent.REQUEST_SNAPSHOT,
      });
    });

    it("handles standard Error thrown values", async () => {
      const mockMachine = {
        getSnapshot: vi.fn().mockImplementation(() => {
          throw new Error("some standard error");
        }),
        // H6 fix: same as above — keep the gate happy so the
        // handler reaches the throw path.
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(0),
        getFloorSeqNo: vi.fn().mockReturnValue(0),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
        failedEvent: ClientEvent.REQUEST_SNAPSHOT,
      });
    });

    // Plan D — delta replay mode selection. The handler emits an
    // EVENT_BATCH (delta) only when the client cursor is in range
    // [floor, head] and non-zero; otherwise it falls back to a full
    // SNAPSHOT so the client can rehydrate from scratch.
    it("emits EVENT_BATCH delta when the cursor is in range", async () => {
      const delta = [
        {
          id: "m1:4",
          type: "ROUND_STARTED",
          timestamp: 1,
          payload: {},
          seqNo: 4,
        },
        {
          id: "m1:5",
          type: "ANSWER_RESULT",
          timestamp: 2,
          payload: {},
          seqNo: 5,
        },
      ];
      const mockMachine = {
        getSnapshot: vi.fn(),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(5),
        getFloorSeqNo: vi.fn().mockReturnValue(1),
        getDelta: vi.fn().mockReturnValue(delta),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 3,
      });

      expect(mockMachine.getDelta).toHaveBeenCalledWith(3);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.EVENT_BATCH, {
        matchId: "m1",
        events: delta,
      });
      // Full snapshot path must NOT run.
      expect(mockMachine.getSnapshot).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith(
        ServerEvent.SNAPSHOT,
        expect.anything(),
      );
    });

    it("falls back to full SNAPSHOT when the cursor is older than floor", async () => {
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      const mockMachine = {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(20),
        getFloorSeqNo: vi.fn().mockReturnValue(10),
        getDelta: vi.fn(),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 5, // < floor (10): missed events are gone
      });

      // Full snapshot, seeded with head so lastEventSeqNo = 20.
      expect(mockMachine.getSnapshot).toHaveBeenCalledWith(20);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot);
      expect(mockMachine.getDelta).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith(
        ServerEvent.EVENT_BATCH,
        expect.anything(),
      );
    });

    // Plan D boundary pin: canDelta requires cursor >= floor. floor-1
    // is rejected even though getDelta(floor-1) would return the full
    // retained log — preserve runtime (snapshot fallback).
    it("falls back to full SNAPSHOT when the cursor is exactly floor - 1", async () => {
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      const mockMachine = {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(20),
        getFloorSeqNo: vi.fn().mockReturnValue(10),
        getDelta: vi.fn(),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 9, // floor - 1: gate rejects (cursor < floor)
      });

      expect(mockMachine.getSnapshot).toHaveBeenCalledWith(20);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot);
      expect(mockMachine.getDelta).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith(
        ServerEvent.EVENT_BATCH,
        expect.anything(),
      );
    });

    it("falls back to full SNAPSHOT when the cursor is ahead of head", async () => {
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      const mockMachine = {
        getSnapshot: vi.fn().mockReturnValue(snapshot),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(5),
        getFloorSeqNo: vi.fn().mockReturnValue(1),
        getDelta: vi.fn(),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 99, // > head (5): corrupt client cursor
      });

      expect(mockMachine.getSnapshot).toHaveBeenCalledWith(5);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot);
      expect(mockMachine.getDelta).not.toHaveBeenCalled();
    });

    it("emits an empty EVENT_BATCH when the cursor is exactly at head", async () => {
      const mockMachine = {
        getSnapshot: vi.fn(),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        getHeadSeqNo: vi.fn().mockReturnValue(5),
        getFloorSeqNo: vi.fn().mockReturnValue(1),
        getDelta: vi.fn().mockReturnValue([]),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 5, // == head: caught up, cheap empty delta
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.EVENT_BATCH, {
        matchId: "m1",
        events: [],
      });
      expect(mockMachine.getSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("handleCardPick", () => {
    const pickPayload = {
      matchId: "m1",
      cardId: "CB-1",
      offerSeqNo: 1,
      commandId: "cmd-pick-1",
    };

    it("forwards a well-formed card_pick envelope to the owner command channel (no local mutation/broadcast)", async () => {
      // B4b-style single-writer: the boundary forwards the command
      // to the owner. The owner applies + persists + broadcasts
      // CARD_PICKED exactly once (covered by
      // match-command.service.spec.ts). The handler MUST NOT call
      // `pickCard` or emit `CARD_PICKED` locally.
      const machine = {
        pickCard: vi.fn(),
        getState: vi.fn().mockReturnValue({
          players: new Map([["u1", { id: "u1", status: PlayerStatus.ACTIVE }]]),
        }),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);
      vi.mocked(matchCommand.forward).mockClear();

      await handler.handleCardPick(client, server, pickPayload);

      // pickCard was never called on the local state machine.
      expect(machine.pickCard).not.toHaveBeenCalled();
      expect(matchCommand.forward).toHaveBeenCalledTimes(1);
      const env = matchCommand.forward.mock.calls[0][0];
      expect(env).toMatchObject({
        schemaVersion: 1,
        matchId: "m1",
        emittedByNodeId: "node-a",
        body: {
          type: "card_pick",
          userId: "u1",
          commandId: pickPayload.commandId,
          cardId: "CB-1",
          offerSeqNo: 1,
        },
      });
      expect(typeof env.eventId).toBe("string");
      expect(env.eventId.length).toBeGreaterThan(0);
      // No local room broadcast — owner is the sole emitter.
      expect(roomOperators.get("room:r1")).toBeUndefined();
    });

    it("emits MATCH_NOT_FOUND when the match has no roomId", async () => {
      vi.mocked(matchService.getRoomIdByMatchId).mockResolvedValueOnce(
        undefined,
      );

      await handler.handleCardPick(client, server, pickPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.MATCH_NOT_FOUND,
        message: ERROR_MESSAGES[ErrorCode.MATCH_NOT_FOUND],
        failedEvent: ClientEvent.CARD_PICK,
        commandId: pickPayload.commandId,
      });
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it("emits UNAUTHORIZED when the socket is not in the room channel", async () => {
      (client.rooms as Set<string>).clear();

      await handler.handleCardPick(client, server, pickPayload);

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.UNAUTHORIZED,
          failedEvent: ClientEvent.CARD_PICK,
        }),
      );
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it("emits MATCH_NOT_FOUND when the state machine is null", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        undefined as any,
      );

      await handler.handleCardPick(client, server, pickPayload);

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.MATCH_NOT_FOUND,
          failedEvent: ClientEvent.CARD_PICK,
        }),
      );
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it.each<{
      label: string;
      status: PlayerStatus | "ABSENT";
      expectedCode: ErrorCode;
    }>([
      {
        label: "spectator (not in roster)",
        status: "ABSENT",
        expectedCode: ErrorCode.SPECTATOR_CANNOT_ANSWER,
      },
      {
        label: "eliminated player",
        status: PlayerStatus.ELIMINATED,
        expectedCode: ErrorCode.SPECTATOR_CANNOT_ANSWER,
      },
      {
        label: "winner",
        status: PlayerStatus.WINNER,
        expectedCode: ErrorCode.SPECTATOR_CANNOT_ANSWER,
      },
      {
        label: "disconnected player",
        status: PlayerStatus.DISCONNECTED,
        expectedCode: ErrorCode.PLAYER_DISCONNECTED,
      },
    ])(
      "rejects $label for pick with $expectedCode",
      async ({ status, expectedCode }) => {
        const players =
          status === "ABSENT"
            ? new Map()
            : new Map([["u1", { id: "u1", status }]]);
        const machine = {
          getState: vi.fn().mockReturnValue({ players }),
        } as any;
        vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(machine);
        vi.mocked(client.emit).mockClear();
        vi.mocked(matchCommand.forward).mockClear();

        await handler.handleCardPick(client, server, pickPayload);

        // Each iteration isolates its own mock calls so a
        // failure surfaces only the offending case. The boundary
        // rejects before any forwarding happens.
        expect(client.emit).toHaveBeenCalledTimes(1);
        expect(client.emit).toHaveBeenCalledWith(
          ServerEvent.ERROR,
          expect.objectContaining({
            code: expectedCode,
            failedEvent: ClientEvent.CARD_PICK,
          }),
        );
        expect(matchCommand.forward).not.toHaveBeenCalled();
      },
    );

    it("rejects an invalid commandId before any state-machine work", async () => {
      await handler.handleCardPick(client, server, {
        ...pickPayload,
        commandId: "",
      });

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INVALID_COMMAND_ID,
          failedEvent: ClientEvent.CARD_PICK,
        }),
      );
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it("handles non-Error thrown values from matchCommand.forward", async () => {
      // The handler no longer touches the state machine directly —
      // the only in-handler throw site is the durable forward. A
      // non-Error rejection there must surface as INTERNAL_ERROR.
      vi.mocked(matchCommand.forward).mockImplementationOnce(() => {
        throw "string error";
      });
      const machine = {
        getState: vi.fn().mockReturnValue({
          players: new Map([["u1", { id: "u1", status: PlayerStatus.ACTIVE }]]),
        }),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPick(client, server, pickPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
        failedEvent: ClientEvent.CARD_PICK,
        commandId: pickPayload.commandId,
      });
    });

    it("rejects with SPECTATOR_CANNOT_ANSWER when state.players is undefined (defensive)", async () => {
      // `assertActivePlayer` is the single source of truth for the
      // authorise-player gate. The first check (`!state?.players`)
      // covers a malformed state object. We build a state machine
      // that returns a state without `players` so the handler
      // rejects the request as a spectator without forwarding.
      const machine = {
        getState: vi.fn().mockReturnValue({ id: "m1" }), // no `players`
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPick(client, server, pickPayload);

      expect(matchCommand.forward).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.SPECTATOR_CANNOT_ANSWER,
          failedEvent: ClientEvent.CARD_PICK,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // `handleCardPlay` — the API boundary for resolving a picked card.
  // The mock state machine is set up with the minimum surface the
  // handler reads: getter shape mirrors the real MatchStateMachine.
  // ---------------------------------------------------------------------------
  function makePlayMachine(
    overrides: Partial<{
      getState: () => any;
      playCard: (...args: unknown[]) => unknown;
    }> = {},
  ) {
    const players = new Map([
      ["u1", { id: "u1", status: PlayerStatus.ACTIVE }],
      ["p2", { id: "p2", status: PlayerStatus.ACTIVE }],
      ["p3", { id: "p3", status: PlayerStatus.ACTIVE }],
    ]);
    return {
      getState: vi.fn().mockReturnValue({ id: "m1", players }),
      playCard: vi.fn().mockReturnValue({
        seqNo: 10,
        expiresAtServer: null,
        remainingMs: null,
      }),
      ...overrides,
    } as any;
  }

  describe("handleCardPlay", () => {
    const playPayload = {
      matchId: "m1",
      cardId: "CB-1",
      targetPlayerId: "p2",
      offerSeqNo: 1,
      commandId: "cmd-play-1",
    };

    it("forwards a well-formed card_play envelope to the owner command channel (no local mutation/broadcast)", async () => {
      // B4b-style single-writer: the boundary forwards the command
      // to the owner. The owner applies + persists + broadcasts
      // CARD_RESOLVED exactly once (covered by
      // match-command.service.spec.ts). The handler MUST NOT call
      // `playCard` / `resolveCardEffect` or emit `CARD_RESOLVED`
      // locally — that is the dispatch path's job on the owner.
      const machine = makePlayMachine();
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);
      vi.mocked(matchCommand.forward).mockClear();

      await handler.handleCardPlay(client, server, playPayload);

      // playCard was never called locally.
      expect(machine.playCard).not.toHaveBeenCalled();
      expect(matchCommand.forward).toHaveBeenCalledTimes(1);
      const env = matchCommand.forward.mock.calls[0][0];
      expect(env).toMatchObject({
        schemaVersion: 1,
        matchId: "m1",
        emittedByNodeId: "node-a",
        body: {
          type: "card_play",
          userId: "u1",
          commandId: playPayload.commandId,
          cardId: "CB-1",
          offerSeqNo: 1,
          targetPlayerId: "p2",
        },
      });
      expect(typeof env.eventId).toBe("string");
      expect(env.eventId.length).toBeGreaterThan(0);
      // No local room or player broadcasts — owner is the sole emitter.
      expect(roomOperators.get("room:r1")).toBeUndefined();
      expect(roomOperators.get("player:p2")).toBeUndefined();
      expect(roomOperators.get("player:u1")).toBeUndefined();
    });

    it("forwards a self-target TN-1 envelope without a targetPlayerId", async () => {
      // TN-1 is a self-only DEFENSE card; the boundary must forward
      // `targetPlayerId: undefined` verbatim. expandTargets on the
      // owner side falls back to the actor for self-only cards.
      const machine = makePlayMachine();
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);
      vi.mocked(matchCommand.forward).mockClear();

      await handler.handleCardPlay(client, server, {
        ...playPayload,
        cardId: "TN-1",
        targetPlayerId: undefined,
      });

      expect(matchCommand.forward).toHaveBeenCalledTimes(1);
      const env = matchCommand.forward.mock.calls[0][0];
      expect(env.body).toMatchObject({
        type: "card_play",
        cardId: "TN-1",
        offerSeqNo: 1,
      });
      // targetPlayerId: undefined is forwarded as-is; the dispatch
      // path expands self-target cards to the actor.
      expect(env.body.targetPlayerId).toBeUndefined();
      expect(machine.playCard).not.toHaveBeenCalled();
    });

    it("forwards an AOE card (CB-8) without local target expansion", async () => {
      // CB-8 is an AOE card targeting up to 3 players. The boundary
      // forwards the envelope as-is; expandTargets on the owner
      // side reads the current round roster to expand.
      const machine = makePlayMachine();
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);
      vi.mocked(matchCommand.forward).mockClear();

      await handler.handleCardPlay(client, server, {
        ...playPayload,
        cardId: "CB-8",
        targetPlayerId: undefined,
      });

      expect(matchCommand.forward).toHaveBeenCalledTimes(1);
      const env = matchCommand.forward.mock.calls[0][0];
      expect(env.body).toMatchObject({
        type: "card_play",
        cardId: "CB-8",
        offerSeqNo: 1,
      });
      // No AOE expansion at the boundary; that is the dispatch's job.
      expect(machine.playCard).not.toHaveBeenCalled();
    });

    it("does NOT locally validate hand/offer — the dispatch is the validator", async () => {
      // Hand / offer / target validation lives in
      // `MatchCommandService.applyCardPlayAuthoritative`, not the
      // handler. A handler that picks a card not in the player's
      // current hand must still forward — the dispatch ack-rejects
      // it as DUPLICATE_SUBMISSION without producing a CARD_RESOLVED
      // event.
      const machine = makePlayMachine();
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);
      vi.mocked(matchCommand.forward).mockClear();

      await handler.handleCardPlay(client, server, playPayload);

      expect(matchCommand.forward).toHaveBeenCalledTimes(1);
      const env = matchCommand.forward.mock.calls[0][0];
      expect(env.body).toMatchObject({
        type: "card_play",
        cardId: "CB-1",
        offerSeqNo: 1,
      });
      expect(machine.playCard).not.toHaveBeenCalled();
    });

    it("emits MATCH_NOT_FOUND when the match has no roomId", async () => {
      vi.mocked(matchService.getRoomIdByMatchId).mockResolvedValueOnce(
        undefined,
      );

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.MATCH_NOT_FOUND,
        message: ERROR_MESSAGES[ErrorCode.MATCH_NOT_FOUND],
        failedEvent: ClientEvent.CARD_PLAY,
        commandId: playPayload.commandId,
      });
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it("emits UNAUTHORIZED when the socket is not in the room channel", async () => {
      (client.rooms as Set<string>).clear();

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.UNAUTHORIZED,
          failedEvent: ClientEvent.CARD_PLAY,
        }),
      );
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it("emits MATCH_NOT_FOUND when the state machine is null", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValueOnce(
        undefined as any,
      );

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.MATCH_NOT_FOUND,
          failedEvent: ClientEvent.CARD_PLAY,
        }),
      );
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it("rejects an invalid commandId before any state-machine work", async () => {
      await handler.handleCardPlay(client, server, {
        ...playPayload,
        commandId: "",
      });

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INVALID_COMMAND_ID,
          failedEvent: ClientEvent.CARD_PLAY,
        }),
      );
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchCommand.forward).not.toHaveBeenCalled();
    });

    it("handles non-Error thrown values from matchCommand.forward", async () => {
      // The handler's only post-boundary work is the durable forward.
      // A non-Error rejection there must surface as INTERNAL_ERROR.
      vi.mocked(matchCommand.forward).mockImplementationOnce(() => {
        throw "kaboom";
      });
      const machine = makePlayMachine();
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
        failedEvent: ClientEvent.CARD_PLAY,
        commandId: playPayload.commandId,
      });
    });

    // Real Socket.IO integration: drives handleCardPlay through a
    // listening server with three real client sockets so the H6
    // gate (`room:r1` channel membership) is exercised by Socket.IO
    // itself, not by the per-room vi.fn mock. After the single-writer
    // refactor, handleCardPlay no longer broadcasts locally — the
    // dispatch path on the owner owns the wire side. This test now
    // verifies that the handler forwards the envelope and never
    // touches the wire; end-to-end CARD_RESOLVED delivery is
    // covered by `match-command.service.spec.ts`'s dispatch tests.
    it("routes card_play through real Socket.IO: forwards a single envelope, no local wire side", async () => {
      const httpServer: HttpServer = createServer();
      const ioServer = new Server(httpServer, {
        cors: { origin: "*" },
      });
      await new Promise<void>((resolve) => httpServer.listen(0, resolve));
      const port = (httpServer.address() as AddressInfo).port;

      ioServer.on("connection", (socket: Socket) => {
        socket.on(ClientEvent.CARD_PLAY, (payload) => {
          void handler.handleCardPlay(
            socket,
            ioServer,
            payload as Parameters<typeof handler.handleCardPlay>[2],
          );
        });
      });

      const actorClient = ioClient(`http://127.0.0.1:${port}`, {
        autoConnect: false,
        transports: ["websocket"],
      });
      const targetClient = ioClient(`http://127.0.0.1:${port}`, {
        autoConnect: false,
        transports: ["websocket"],
      });
      const observerClient = ioClient(`http://127.0.0.1:${port}`, {
        autoConnect: false,
        transports: ["websocket"],
      });

      const connect = (c: ClientSocket) =>
        new Promise<void>((resolve, reject) => {
          c.once("connect", () => resolve());
          c.once("connect_error", (err) => reject(err));
          c.connect();
        });

      try {
        await Promise.all([
          connect(actorClient),
          connect(targetClient),
          connect(observerClient),
        ]);

        // Map each client socket to its server-side socket and
        // join the room channel + per-player channel so the
        // handler's H6 gate (room:r1) accepts the actor socket —
        // the same gate production uses.
        const sockets = ioServer.sockets.sockets;
        const actorServerSocket = findSocketForClient(sockets, actorClient.id!);
        expect(actorServerSocket).toBeDefined();
        actorServerSocket!.join("room:r1");
        actorServerSocket!.join("player:u1");
        actorServerSocket!.data = { userId: "u1", username: "Alice" };

        // Make sure the actor socket id from the client is present
        // before we wire assertions — `socket.io-client` types id
        // as `string | undefined` even though it is always set
        // after `connect`.
        expect(actorClient.id).toBeDefined();

        const machine = makePlayMachine();
        vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);
        vi.mocked(matchCommand.forward).mockClear();

        const forwardCalled = new Promise<void>((resolve) => {
          vi.mocked(matchCommand.forward).mockImplementationOnce(async () => {
            resolve();
          });
        });
        const FORWARD_TIMEOUT_MS = 2000;
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `matchCommand.forward was not invoked within ${FORWARD_TIMEOUT_MS}ms ` +
                  `(commandId=${playPayload.commandId}, cardId=CB-6)`,
              ),
            );
          }, FORWARD_TIMEOUT_MS);
        });
        actorClient.emit(ClientEvent.CARD_PLAY, {
          ...playPayload,
          cardId: "CB-6",
          targetPlayerId: "p2",
        });
        await Promise.race([forwardCalled, timeoutPromise]);

        // The handler forwarded exactly one well-formed card_play
        // envelope to the owner command channel — no local wire
        // side, no state-machine mutation, no persistence.
        expect(matchCommand.forward).toHaveBeenCalledTimes(1);
        const env = matchCommand.forward.mock.calls[0][0];
        expect(env).toMatchObject({
          schemaVersion: 1,
          matchId: "m1",
          emittedByNodeId: "node-a",
          body: {
            type: "card_play",
            userId: "u1",
            commandId: playPayload.commandId,
            cardId: "CB-6",
            offerSeqNo: 1,
            targetPlayerId: "p2",
          },
        });
        expect(typeof env.eventId).toBe("string");
        expect(env.eventId.length).toBeGreaterThan(0);

        // No CARD_RESOLVED frame leaks from the boundary itself —
        // any frames the actors / target / observer receive must
        // come from the owner's dispatch path (covered separately).
        const receivedAnyCardResolved = await new Promise<boolean>((res) => {
          let total = 0;
          const onFrame = () => {
            total++;
          };
          actorClient.on(ServerEvent.CARD_RESOLVED, onFrame);
          targetClient.on(ServerEvent.CARD_RESOLVED, onFrame);
          observerClient.on(ServerEvent.CARD_RESOLVED, onFrame);
          setTimeout(() => {
            actorClient.off(ServerEvent.CARD_RESOLVED, onFrame);
            targetClient.off(ServerEvent.CARD_RESOLVED, onFrame);
            observerClient.off(ServerEvent.CARD_RESOLVED, onFrame);
            res(total > 0);
          }, 50);
        });
        expect(receivedAnyCardResolved).toBe(false);
      } finally {
        actorClient.disconnect();
        targetClient.disconnect();
        observerClient.disconnect();
        // Socket.IO's `close()` already tears down the attached HTTP
        // server, so we do NOT follow it with a separate
        // `httpServer.close()` — doing so would close the same server
        // twice and trigger Node's "server is not running" warning.
        await new Promise<void>((resolve) => ioServer.close(() => resolve()));
      }
    });
  });
});

function findSocketForClient(
  sockets: Map<string, Socket>,
  clientId: string,
): Socket | undefined {
  for (const [, s] of sockets) {
    if (s.id === clientId) return s;
  }
  return undefined;
}
