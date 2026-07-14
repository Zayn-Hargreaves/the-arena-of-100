import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  ERROR_MESSAGES,
  PlayerStatus,
  RoomStatus,
  RoomError,
  ClientEvent,
} from "@arena/shared";
import { MatchHandler } from "./match.handler";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { GameLoopService } from "../../modules/match/game-loop.service";

describe("MatchHandler", () => {
  let handler: MatchHandler;
  let roomService: RoomService;
  let matchService: MatchService;
  let gameLoopService: {
    checkEarlyTermination: ReturnType<typeof vi.fn>;
    forceStartRoomMatch: ReturnType<typeof vi.fn>;
  };
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
    handler = new MatchHandler(
      roomService,
      matchService,
      gameLoopService as unknown as GameLoopService,
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

  describe("handleSubmitAnswer", () => {
    it("submits answer and emits ANSWER_RESULT", async () => {
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "canonical-s1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(mockMachine.submitAnswer).toHaveBeenCalledWith(
        "u1",
        "A",
        expect.any(Number),
        "s1",
      );
      expect(matchService.persistStateMachine).toHaveBeenCalledWith("m1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ANSWER_RESULT, {
        matchId: "m1",
        roundNo: 1,
        submissionId: "canonical-s1",
        isCorrect: true,
        responseTimeMs: 500,
      });
    });

    it("skips early termination for a replayed submissionId", async () => {
      const matchId = "m1";
      const roomId = "r1";
      const currentRound = {
        roundNo: 1,
        answers: new Map([
          [
            "u1",
            {
              playerId: "u1",
              answer: "A",
              submissionId: "s1",
              isCorrect: true,
              responseTimeMs: 500,
              submittedAt: 1234567890,
            },
          ],
        ]),
      };
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue(currentRound),
        getState: vi.fn().mockReturnValue({
          roomId,
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "s1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId,
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(matchService.persistStateMachine).toHaveBeenCalledWith(matchId);
      expect(gameLoopService.checkEarlyTermination).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ANSWER_RESULT, {
        matchId,
        roundNo: 1,
        submissionId: "s1",
        isCorrect: true,
        responseTimeMs: 500,
      });
    });

    // Replay race guard: the handler captures currentRoundBefore
    // before submitAnswer and must reuse it for the roundNo in
    // ANSWER_RESULT. A previous version re-called getCurrentRound()
    // after the persistStateMachine await — during that await the
    // round can transition (timer fires -> endRound -> currentRound
    // becomes null or a different round), crashing via the `!`
    // assertion or emitting the wrong roundNo. These two tests pin
    // the fix by queueing a divergent second return value on
    // getCurrentRound; if a future change re-introduces the second
    // call, the mock sequence is consumed and the assertions fail.
    it("replays a prior submissionId without crashing when getCurrentRound returns null after the round ends", async () => {
      const matchId = "m1";
      const roomId = "r1";
      const roundWithAnswer = {
        roundNo: 1,
        answers: new Map([
          [
            "u1",
            {
              playerId: "u1",
              answer: "A",
              submissionId: "s1",
              isCorrect: true,
              responseTimeMs: 500,
              submittedAt: 1234567890,
            },
          ],
        ]),
      };
      const mockMachine = {
        // First call (currentRoundBefore) returns the round; a
        // second call (if re-introduced) returns null — simulating
        // the round having ended during the persist await.
        getCurrentRound: vi
          .fn()
          .mockReturnValueOnce(roundWithAnswer)
          .mockReturnValueOnce(null),
        getState: vi.fn().mockReturnValue({
          roomId,
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "s1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId,
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(matchService.persistStateMachine).toHaveBeenCalledWith(matchId);
      expect(gameLoopService.checkEarlyTermination).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ANSWER_RESULT, {
        matchId,
        roundNo: 1,
        submissionId: "s1",
        isCorrect: true,
        responseTimeMs: 500,
      });
    });

    it("replays a prior submissionId with the original roundNo when getCurrentRound returns a different round after transition", async () => {
      const matchId = "m1";
      const roomId = "r1";
      const roundWithAnswer = {
        roundNo: 1,
        answers: new Map([
          [
            "u1",
            {
              playerId: "u1",
              answer: "A",
              submissionId: "s1",
              isCorrect: true,
              responseTimeMs: 500,
              submittedAt: 1234567890,
            },
          ],
        ]),
      };
      const mockMachine = {
        // First call returns round 1 (the round the answer belongs
        // to); a second call (if re-introduced) returns round 2 —
        // simulating a new round having started during the persist
        // await. The handler must emit roundNo: 1, not 2.
        getCurrentRound: vi
          .fn()
          .mockReturnValueOnce(roundWithAnswer)
          .mockReturnValueOnce({ roundNo: 2, answers: new Map() }),
        getState: vi.fn().mockReturnValue({
          roomId,
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "s1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId,
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(matchService.persistStateMachine).toHaveBeenCalledWith(matchId);
      expect(gameLoopService.checkEarlyTermination).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ANSWER_RESULT, {
        matchId,
        roundNo: 1,
        submissionId: "s1",
        isCorrect: true,
        responseTimeMs: 500,
      });
    });

    // Regression guard for the isReplay false-positive: when the
    // player has not yet answered AND the payload omits submissionId,
    // `existingAnswerBefore` is undefined and `payload.submissionId`
    // is undefined. A naive `?.submissionId === payload.submissionId`
    // would resolve to `undefined === undefined` and skip the
    // termination check on the first answer. The handler now guards
    // against this; this test pins that behavior.
    it("calls checkEarlyTermination for a first submission even when submissionId is missing", async () => {
      const matchId = "m1";
      const roomId = "r1";
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          // Player has not answered yet — answers is empty for u1.
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId,
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "s1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      // submissionId is intentionally omitted from the payload.
      await handler.handleSubmitAnswer(client, {
        matchId,
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      } as unknown as Parameters<MatchHandler["handleSubmitAnswer"]>[1]);

      expect(matchService.persistStateMachine).toHaveBeenCalledWith(matchId);
      expect(gameLoopService.checkEarlyTermination).toHaveBeenCalledWith(
        matchId,
        roomId,
        server,
      );
    });

    it("rejects submitAnswer from a non-player (drop-in spectator gate)", async () => {
      // Drop-in spectating baseline: a user that is not in the match
      // roster must NOT be allowed to submit answers even if they emit
      // SUBMIT_ANSWER. This is the server-side counterpart of the
      // client-side UI gate; the server is the source of truth.
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([["u2", { id: "u2" }]]),
        }),
        submitAnswer: vi.fn(),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      // The state machine must never be invoked.
      expect(mockMachine.submitAnswer).not.toHaveBeenCalled();
      // The client must receive a typed error so the UI can surface a
      // localized message.
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.SPECTATOR_CANNOT_ANSWER,
        message: ERROR_MESSAGES[ErrorCode.SPECTATOR_CANNOT_ANSWER],
        failedEvent: ClientEvent.SUBMIT_ANSWER,
        submissionId: "s1",
      });
    });

    // M6 fix: a player who is in the match roster but is
    // currently DISCONNECTED (e.g. brief network blip, dropped
    // socket that hasn't yet hit the presence sweep) must get
    // a distinct error code so the frontend can drive a
    // reconnect flow instead of an error toast. The
    // SPECTATOR_CANNOT_ANSWER gate above passes (player IS in
    // the roster), but this inner guard rejects before the
    // answer is graded.
    it("rejects submitAnswer from a DISCONNECTED player with PLAYER_DISCONNECTED (not SPECTATOR_CANNOT_ANSWER)", async () => {
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([
            [
              "u1",
              {
                id: "u1",
                status: PlayerStatus.DISCONNECTED,
              },
            ],
          ]),
        }),
        submitAnswer: vi.fn(),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      // The state machine must never be invoked — the
      // disconnect guard fires first.
      expect(mockMachine.submitAnswer).not.toHaveBeenCalled();
      // The client must receive PLAYER_DISCONNECTED, not the
      // spectator error and not the generic MATCH_NOT_FOUND.
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.PLAYER_DISCONNECTED,
        message: ERROR_MESSAGES[ErrorCode.PLAYER_DISCONNECTED],
        failedEvent: ClientEvent.SUBMIT_ANSWER,
        submissionId: "s1",
      });
    });

    it("emits error when match not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.MATCH_NOT_FOUND,
        message: ERROR_MESSAGES[ErrorCode.MATCH_NOT_FOUND],
        failedEvent: ClientEvent.SUBMIT_ANSWER,
        submissionId: "s1",
      });
    });

    it("emits error when not authenticated", async () => {
      client.data = {};
      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it("does not map Error.message strings as ErrorCode values", async () => {
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockImplementation(() => {
          throw new Error(ErrorCode.MATCH_NOT_FOUND);
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "Internal server error",
        failedEvent: ClientEvent.SUBMIT_ANSWER,
        submissionId: "s1",
      });
    });

    it("emits error when submitAnswer throws", async () => {
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockImplementation(() => {
          throw new RoomError(ErrorCode.ALREADY_ANSWERED);
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.ALREADY_ANSWERED,
          message: ERROR_MESSAGES[ErrorCode.ALREADY_ANSWERED],
          failedEvent: ClientEvent.SUBMIT_ANSWER,
          submissionId: "s1",
        }),
      );
    });

    it("handles non-Error thrown values", async () => {
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId: "r1",
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockImplementation(() => {
          throw 42;
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "Internal server error",
        failedEvent: ClientEvent.SUBMIT_ANSWER,
        submissionId: "s1",
      });
    });

    it("calls checkEarlyTermination after submitting answer", async () => {
      const matchId = "m1";
      const roomId = "r1";
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId,
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "s1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId,
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(gameLoopService.checkEarlyTermination).toHaveBeenCalledWith(
        matchId,
        roomId,
        server,
      );
    });

    it("does not emit submit failure when post-submit early termination fails", async () => {
      const matchId = "m1";
      const roomId = "r1";
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({
          roundNo: 1,
          answers: new Map(),
        }),
        getState: vi.fn().mockReturnValue({
          roomId,
          players: new Map([["u1", { id: "u1" }]]),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "s1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);
      gameLoopService.checkEarlyTermination.mockRejectedValueOnce(
        new Error("post-submit failed"),
      );

      await handler.handleSubmitAnswer(client, {
        matchId,
        answer: "A",
        roundNo: 1,
        submissionId: "s1",
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ANSWER_RESULT, {
        matchId,
        roundNo: 1,
        submissionId: "s1",
        isCorrect: true,
        responseTimeMs: 500,
      });
      expect(client.emit).not.toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ submissionId: "s1" }),
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
});
