import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  GAME_CONFIG,
  ERROR_MESSAGES,
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
    startMatchLoop: ReturnType<typeof vi.fn>;
  };
  let client: Socket;
  let server: Server;

  beforeEach(() => {
    roomService = { getRoom: vi.fn() } as unknown as RoomService;
    matchService = {
      createMatch: vi.fn(),
      getStateMachine: vi.fn(),
      persistStateMachine: vi.fn(),
    } as unknown as MatchService;
    gameLoopService = {
      checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      startMatchLoop: vi.fn().mockResolvedValue(undefined),
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
      nsp: {
        server: server,
      },
    } as unknown as Socket;
  });

  describe("handleStartMatch", () => {
    it("starts match when user is host", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValue({ hostId: "u1" } as any);
      vi.mocked(matchService.createMatch).mockResolvedValue({
        id: "m1",
      } as any);

      await handler.handleStartMatch(client, server, { roomId: "r1" });

      expect(matchService.createMatch).toHaveBeenCalledWith("r1");
      expect(server.to).toHaveBeenCalledWith("room:r1");
      const emitFn = (server.to as any).mock.results[0].value.emit;
      expect(emitFn).toHaveBeenCalledWith(ServerEvent.MATCH_STARTING, {
        matchId: "m1",
        countdown: GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
      });
      expect(gameLoopService.startMatchLoop).toHaveBeenCalledWith(
        "m1",
        "r1",
        server,
      );
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
        expect.objectContaining({ code: ErrorCode.INTERNAL_ERROR }),
      );
    });

    it("handles non-Error thrown values", async () => {
      vi.mocked(roomService.getRoom).mockRejectedValue("string error");
      await handler.handleStartMatch(client, server, { roomId: "r1" });
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "string error",
      });
    });
  });

  describe("handleSubmitAnswer", () => {
    it("submits answer and emits ANSWER_RESULT", async () => {
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({ roundNo: 1 }),
        getState: vi.fn().mockReturnValue({ roomId: "r1" }),
        submitAnswer: vi
          .fn()
          .mockReturnValue({ isCorrect: true, responseTimeMs: 500 }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      });

      expect(mockMachine.submitAnswer).toHaveBeenCalledWith(
        "u1",
        "A",
        expect.any(Number),
      );
      expect(matchService.persistStateMachine).toHaveBeenCalledWith("m1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ANSWER_RESULT, {
        matchId: "m1",
        roundNo: 1,
        isCorrect: true,
        responseTimeMs: 500,
      });
    });

    it("emits error when match not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.MATCH_NOT_FOUND,
        message: ERROR_MESSAGES[ErrorCode.MATCH_NOT_FOUND],
      });
    });

    it("emits error when not authenticated", async () => {
      client.data = {};
      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it("emits error when submitAnswer throws", async () => {
      const mockMachine = {
        submitAnswer: vi.fn().mockImplementation(() => {
          throw new Error(ErrorCode.ALREADY_ANSWERED);
        }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );

      await handler.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ message: ErrorCode.ALREADY_ANSWERED }),
      );
    });

    it("handles non-Error thrown values", async () => {
      const mockMachine = {
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
        clientTimestamp: 1234567890,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: "42",
      });
    });

    it("calls checkEarlyTermination after submitting answer", async () => {
      const matchId = "m1";
      const roomId = "r1";
      const mockMachine = {
        getCurrentRound: vi.fn().mockReturnValue({ roundNo: 1 }),
        getState: vi.fn().mockReturnValue({ roomId }),
        submitAnswer: vi
          .fn()
          .mockReturnValue({ isCorrect: true, responseTimeMs: 500 }),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue(undefined);

      await handler.handleSubmitAnswer(client, {
        matchId,
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      });

      // Verify that checkEarlyTermination was called with exact parameters
      expect(gameLoopService.checkEarlyTermination).toHaveBeenCalledWith(
        matchId,
        roomId,
        server,
      );
    });
  });

  describe("handleRequestSnapshot", () => {
    it("emits snapshot on success", async () => {
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      const mockMachine = { getSnapshot: vi.fn().mockReturnValue(snapshot) };
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

    it("emits error when match not found", async () => {
      vi.mocked(matchService.getStateMachine).mockResolvedValue(undefined);

      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.MATCH_NOT_FOUND,
        message: ERROR_MESSAGES[ErrorCode.MATCH_NOT_FOUND],
      });
    });

    it("emits error when not authenticated", async () => {
      client.data = {};
      await handler.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it("handles non-Error thrown values", async () => {
      const mockMachine = {
        getSnapshot: vi.fn().mockImplementation(() => {
          throw "snapshot failure";
        }),
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
        message: "snapshot failure",
      });
    });
  });
});
