import { GameLoopService } from "./game-loop.service";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { MatchStateMachine } from "@arena/game-core";
import { MatchStatus, PlayerStatus } from "@arena/shared";
import { Server } from "socket.io";
import { vi, beforeEach, it, expect, describe } from "vitest";

describe("GameLoopService Persistence", () => {
  let service: GameLoopService;
  let matchService: MatchService;
  let questionService: QuestionService;
  let mockServer: Server;
  let stateMachine: MatchStateMachine;

  beforeEach(() => {
    // Create real state machine with test players
    const players = [
      {
        id: "p1",
        name: "Player 1",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 0,
        correctAnswers: 0,
        isOnline: true,
      },
      {
        id: "p2",
        name: "Player 2",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 0,
        correctAnswers: 0,
        isOnline: true,
      },
    ];
    stateMachine = new MatchStateMachine("match-1", "room-1", players);

    matchService = {
      getStateMachine: vi.fn().mockResolvedValue(stateMachine),
      persistStateMachine: vi.fn().mockResolvedValue(undefined),
      finishMatch: vi.fn().mockResolvedValue({}),
      saveRound: vi.fn().mockResolvedValue({ id: "round-record-123" }),
      saveAnswer: vi.fn().mockResolvedValue({}),
      saveAnswers: vi.fn().mockResolvedValue({ count: 2 }),
    } as unknown as MatchService;

    questionService = {
      getRandom: vi.fn().mockResolvedValue({
        id: "q1",
        content: "Test question",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      }),
    } as unknown as QuestionService;

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    service = new GameLoopService(matchService, questionService);
  });

  describe("endRound persistence", () => {
    it("should save round and answers with correct parameters", async () => {
      // Setup: transition through required states and submit answers
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q1",
        content: "Test question",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });

      // Submit answers from players
      const now = Date.now();
      stateMachine.submitAnswer("p1", "A", now);
      stateMachine.submitAnswer("p2", "B", now);

      // Mock the saveRound to return a specific round record ID
      const mockRoundRecord = { id: "round-record-xyz" };
      (matchService.saveRound as any).mockResolvedValue(mockRoundRecord);

      // Execute endRound
      await (service as any).endRound("match-1", "room-1", mockServer);

      // Verify saveRound was called with correct parameters
      expect(matchService.saveRound).toHaveBeenCalledWith(
        "match-1", // matchId
        1, // roundNo (first round)
        "q1", // questionId
      );

      // Verify saveAnswers was called with correct parameters
      expect(matchService.saveAnswers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            matchId: "match-1",
            roundId: "round-record-xyz",
            userId: "p1",
            answer: "A",
            isCorrect: true,
            responseTimeMs: expect.any(Number),
          }),
          expect.objectContaining({
            matchId: "match-1",
            roundId: "round-record-xyz",
            userId: "p2",
            answer: "B",
            isCorrect: false,
            responseTimeMs: expect.any(Number),
          }),
        ]),
      );
    });

    it("should use the round record ID returned from saveRound when saving answers", async () => {
      // Setup state machine
      stateMachine.transition(MatchStatus.COUNTDOWN);
      stateMachine.transition(MatchStatus.ROUND_ACTIVE);
      stateMachine.startRound({
        id: "q2",
        content: "Another test question",
        options: ["X", "Y", "Z"],
        correctAnswer: "Y",
        difficulty: "HARD",
      });

      // Submit one answer
      stateMachine.submitAnswer("p1", "Y", Date.now());

      // Mock saveRound to return a specific round record with unique ID
      const uniqueRoundId = "unique-round-id-789";
      const mockRoundRecord = { id: uniqueRoundId };
      (matchService.saveRound as any).mockResolvedValue(mockRoundRecord);

      // Execute endRound
      await (service as any).endRound("match-1", "room-1", mockServer);

      // Verify that saveAnswers was called with the exact round ID returned from saveRound
      expect(matchService.saveAnswers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            matchId: "match-1",
            roundId: uniqueRoundId, // This should be the exact ID returned from saveRound
            userId: "p1",
            answer: "Y",
            isCorrect: true,
            responseTimeMs: expect.any(Number),
          }),
        ]),
      );
    });
  });
});
