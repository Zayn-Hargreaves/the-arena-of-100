import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  ERROR_MESSAGES,
  PlayerStatus,
  RoomStatus,
  RoomError,
  ClientEvent,
  CardId,
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
    handler = new MatchHandler(
      roomService,
      matchService,
      gameLoopService as unknown as GameLoopService,
      matchCommand as unknown as MatchCommandService,
      { nodeId: "node-a" } as unknown as ClusterService,
    );
    server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
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
        message: "Internal server error",
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
        message: "Internal server error",
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
        message: "Internal server error",
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

  // ===========================================================================
  // Phase 2 — Class + Card Hybrid handlers (sub-task D).
  // Source of truth: memory-bank/spec/class-cards-phase.md §5.2 sub-task D.
  // These cover the new handlers shipped in this PR; the prior describe
  // blocks above cover the original handlers.
  // ===========================================================================

  describe("handleCardPick", () => {
    const pickPayload = {
      matchId: "m1",
      cardId: "CB-1",
      offerSeqNo: 1,
      commandId: "cmd-pick-1",
    };

    it("forwards pick to state machine and broadcasts CARD_PICKED to the room", async () => {
      const machine = {
        pickCard: vi.fn(),
        getCurrentRound: vi.fn().mockReturnValue({ roundNo: 5 }),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPick(client, server, pickPayload);

      expect(machine.pickCard).toHaveBeenCalledWith(
        "u1",
        "CB-1",
        pickPayload.offerSeqNo,
      );
      const roomEmit = (server.to as ReturnType<typeof vi.fn>).mock.results[0]
        .value.emit;
      expect(server.to).toHaveBeenCalledWith("room:r1");
      expect(roomEmit).toHaveBeenCalledWith(ServerEvent.CARD_PICKED, {
        matchId: "m1",
        roundNo: 5,
        playerId: "u1",
        selectedCardId: "CB-1",
        offerSeqNo: 1,
      });
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
    });

    it("forwards the state-machine error (e.g. CARD_NOT_IN_HAND) verbatim", async () => {
      const machine = {
        pickCard: vi.fn().mockImplementation(() => {
          throw new RoomError(ErrorCode.CARD_NOT_IN_HAND);
        }),
        getCurrentRound: vi.fn().mockReturnValue({ roundNo: 5 }),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPick(client, server, pickPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.CARD_NOT_IN_HAND,
        message: ERROR_MESSAGES[ErrorCode.CARD_NOT_IN_HAND],
        failedEvent: ClientEvent.CARD_PICK,
        commandId: pickPayload.commandId,
      });
    });

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
    });

    it("handles non-Error thrown values from the state machine", async () => {
      const machine = {
        pickCard: vi.fn().mockImplementation(() => {
          throw "string error";
        }),
        getCurrentRound: vi.fn().mockReturnValue({ roundNo: 5 }),
      } as any;
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPick(client, server, pickPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "string error",
        failedEvent: ClientEvent.CARD_PICK,
        commandId: pickPayload.commandId,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // `handleCardPlay` — the API boundary for resolving a picked card.
  // The mock state machine is set up with the minimum surface the
  // handler reads: getter shape mirrors the real MatchStateMachine.
  // ---------------------------------------------------------------------------
  function makePlayMachine(
    overrides: Partial<{
      getCardOfferForPlayer: (
        userId: string,
        offerSeqNo: number,
      ) => readonly CardId[] | null;
      getPickedCards: (userId: string) => ReadonlySet<CardId>;
      getPlayedCards: (userId: string) => ReadonlySet<CardId>;
      getAoeCountForRound: (roundNo: number) => number;
      getCurrentRound: () => any;
      getState: () => any;
      getHand: (playerId: string) => readonly CardId[];
      playCard: (...args: any[]) => any;
      pickCard: (...args: any[]) => any;
    }> = {},
  ) {
    const players = new Map([
      ["u1", { id: "u1", status: PlayerStatus.ACTIVE }],
      ["p2", { id: "p2", status: PlayerStatus.ACTIVE }],
      ["p3", { id: "p3", status: PlayerStatus.ACTIVE }],
    ]);
    return {
      getCardOfferForPlayer: vi.fn().mockReturnValue(["CB-1", "CB-2", "CB-3"]),
      getPickedCards: vi.fn().mockReturnValue(new Set<CardId>(["CB-1"])),
      getPlayedCards: vi.fn().mockReturnValue(new Set<CardId>()),
      getAoeCountForRound: vi.fn().mockReturnValue(0),
      getCurrentRound: vi.fn().mockReturnValue({
        roundNo: 5,
        question: { id: "q1", options: ["A", "B", "C", "D"] },
        correctAnswer: "A",
      }),
      getState: vi.fn().mockReturnValue({ id: "m1", players }),
      getHand: vi.fn().mockReturnValue([]),
      playCard: vi.fn().mockReturnValue({
        seqNo: 10,
        expiresAtServer: null,
        remainingMs: null,
      }),
      pickCard: vi.fn(),
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

    it("validates, resolves, plays, and broadcasts CARD_RESOLVED (MUTATION)", async () => {
      const machine = makePlayMachine();
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, playPayload);

      expect(machine.getCardOfferForPlayer).toHaveBeenCalledWith("u1", 1);
      expect(machine.playCard).toHaveBeenCalledTimes(1);
      const playArgs = machine.playCard.mock.calls[0];
      expect(playArgs[0]).toBe("u1");
      expect(playArgs[1]).toBe("CB-1");
      expect(playArgs[2]).toBe(1);
      expect(playArgs[3]).toMatchObject({ kind: expect.any(String) });
      expect(playArgs[4]).toEqual(["p2"]);
      expect(typeof playArgs[5]).toBe("number");

      const roomEmit = (server.to as ReturnType<typeof vi.fn>).mock.results[0]
        .value.emit;
      expect(server.to).toHaveBeenCalledWith("room:r1");
      expect(roomEmit).toHaveBeenCalledWith(
        ServerEvent.CARD_RESOLVED,
        expect.objectContaining({
          seqNo: 10,
          matchId: "m1",
          roundNo: 5,
          cardId: "CB-1",
          offerSeqNo: 1,
          playedByPlayerId: "u1",
          resolution: "MUTATION",
        }),
      );
    });

    it("expands AOE targets via expandTargets (TIMER_MODIFY count > 1)", async () => {
      const machine = makePlayMachine({
        // CB-8 is an AOE card on the catalog.
        getCardOfferForPlayer: vi
          .fn()
          .mockReturnValue(["CB-8", "CB-1", "CB-2"]),
        getPickedCards: vi.fn().mockReturnValue(new Set<CardId>(["CB-8"])),
      });
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, {
        ...playPayload,
        cardId: "CB-8",
      });

      const playArgs = machine.playCard.mock.calls[0];
      // AOE expansion: roster minus player, capped at catalog targetCount.
      expect(playArgs[4]).toEqual(["p2", "p3"]);
    });

    it("tags the CARD_RESOLVED event as TEMPORARY for OPTION_DISABLE kinds", async () => {
      // TN-1 resolves to OPTION_DISABLE which is a TEMPORARY kind
      // (carries duration for the answer-window countdown). The
      // handler must tag the broadcast `resolution: "TEMPORARY"`
      // so clients can opt into the timer-aware UI.
      const machine = makePlayMachine({
        getCardOfferForPlayer: vi
          .fn()
          .mockReturnValue(["TN-1", "CB-1", "CB-2"]),
        getPickedCards: vi.fn().mockReturnValue(new Set<CardId>(["TN-1"])),
        playCard: vi.fn().mockReturnValue({
          seqNo: 11,
          expiresAtServer: 1234567,
          remainingMs: 5000,
        }),
      });
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, {
        ...playPayload,
        cardId: "TN-1",
        targetPlayerId: undefined,
      });

      const roomEmit = (server.to as ReturnType<typeof vi.fn>).mock.results[0]
        .value.emit;
      expect(roomEmit).toHaveBeenCalledWith(
        ServerEvent.CARD_RESOLVED,
        expect.objectContaining({
          resolution: "TEMPORARY",
          expiresAtServer: 1234567,
          remainingMs: 5000,
        }),
      );
    });

    it("uses the supplied targetPlayerId for a single-target CONG card", async () => {
      const machine = makePlayMachine();
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, {
        ...playPayload,
        targetPlayerId: "p2",
      });

      const playArgs = machine.playCard.mock.calls[0];
      expect(playArgs[4]).toEqual(["p2"]);
    });

    it("rejects when the picked card is not in the picked-cards set", async () => {
      const machine = makePlayMachine({
        getPickedCards: vi.fn().mockReturnValue(new Set<CardId>(["CB-2"])),
      });
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.CARD_NOT_IN_HAND,
          failedEvent: ClientEvent.CARD_PLAY,
        }),
      );
      expect(machine.playCard).not.toHaveBeenCalled();
    });

    it("rejects when the offerSeqNo does not match the player's offer envelope", async () => {
      const machine = makePlayMachine({
        getCardOfferForPlayer: vi.fn().mockReturnValue(null),
      });
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.CARD_NOT_IN_HAND,
          failedEvent: ClientEvent.CARD_PLAY,
        }),
      );
      expect(machine.playCard).not.toHaveBeenCalled();
    });

    it("forwards state-machine errors (e.g. CARD_NOT_IN_HAND) to the client", async () => {
      const machine = makePlayMachine({
        playCard: vi.fn().mockImplementation(() => {
          throw new RoomError(ErrorCode.CARD_NOT_IN_HAND);
        }),
      });
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.CARD_NOT_IN_HAND,
        message: ERROR_MESSAGES[ErrorCode.CARD_NOT_IN_HAND],
        failedEvent: ClientEvent.CARD_PLAY,
        commandId: playPayload.commandId,
      });
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
    });

    it("handles non-Error thrown values from the resolver path", async () => {
      const machine = makePlayMachine({
        playCard: vi.fn().mockImplementation(() => {
          throw "kaboom";
        }),
      });
      vi.mocked(matchService.getStateMachine).mockResolvedValue(machine);

      await handler.handleCardPlay(client, server, playPayload);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "kaboom",
        failedEvent: ClientEvent.CARD_PLAY,
        commandId: playPayload.commandId,
      });
    });
  });
});
