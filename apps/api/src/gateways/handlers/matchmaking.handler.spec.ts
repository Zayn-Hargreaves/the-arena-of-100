import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchmakingHandler } from "./matchmaking.handler";
import type { MatchmakingService } from "../../modules/matchmaking/matchmaking.service";
import { ServerEvent } from "@arena/shared";

describe("MatchmakingHandler", () => {
  let handler: MatchmakingHandler;
  let mockMatchmakingService: any;
  let mockSocket: any;

  beforeEach(() => {
    mockMatchmakingService = {
      joinQueue: vi.fn().mockResolvedValue({
        isQueued: true,
        queuedAt: 123456,
        elapsedSeconds: 0,
        estimatedWaitSeconds: 15,
        playersInQueue: 2,
      }),
      leaveQueue: vi.fn().mockResolvedValue(true),
      getQueueStatus: vi.fn().mockResolvedValue({
        isQueued: false,
        queuedAt: null,
        elapsedSeconds: 0,
        estimatedWaitSeconds: 15,
        playersInQueue: 1,
      }),
    };

    mockSocket = {
      id: "socket-123",
      data: {
        userId: "user-123",
        username: "Player1",
      },
      emit: vi.fn(),
    };

    handler = new MatchmakingHandler(
      mockMatchmakingService as unknown as MatchmakingService,
    );
  });

  it("handles join_matchmaking event", async () => {
    await handler.handleJoinMatchmaking(mockSocket, { category: "SCIENCE" });

    expect(mockMatchmakingService.joinQueue).toHaveBeenCalledWith(
      { id: "user-123", username: "Player1" },
      "socket-123",
      "SCIENCE",
    );
    expect(mockSocket.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_STATUS,
      expect.objectContaining({ isQueued: true }),
    );
  });

  it("handles leave_matchmaking event", async () => {
    await handler.handleLeaveMatchmaking(mockSocket);

    expect(mockMatchmakingService.leaveQueue).toHaveBeenCalledWith("user-123");
    expect(mockSocket.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_STATUS,
      expect.objectContaining({ isQueued: false }),
    );
  });

  it("emits error and skips joinQueue when client is unauthenticated", async () => {
    mockSocket.data.userId = undefined;
    await handler.handleJoinMatchmaking(mockSocket);

    expect(mockMatchmakingService.joinQueue).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith(
      ServerEvent.ERROR,
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
  });

  it("uses default 'Player' username when username is missing", async () => {
    delete mockSocket.data.username;
    delete mockSocket.data.user;
    await handler.handleJoinMatchmaking(mockSocket);

    expect(mockMatchmakingService.joinQueue).toHaveBeenCalledWith(
      { id: "user-123", username: "Player" },
      "socket-123",
      undefined,
    );
  });

  it("contains joinQueue rejection and emits error event", async () => {
    mockMatchmakingService.joinQueue.mockRejectedValueOnce(
      new Error("Queue error"),
    );
    await expect(
      handler.handleJoinMatchmaking(mockSocket),
    ).resolves.toBeUndefined();
    expect(mockSocket.emit).toHaveBeenCalledWith(
      ServerEvent.ERROR,
      expect.objectContaining({ message: "Queue error" }),
    );
  });

  it("cleans up on socket disconnect", async () => {
    await handler.handleDisconnect(mockSocket);
    expect(mockMatchmakingService.leaveQueue).toHaveBeenCalledWith("user-123");
  });

  it("skips leaveQueue on disconnect when userId is absent", async () => {
    mockSocket.data = {};
    await handler.handleDisconnect(mockSocket);
    expect(mockMatchmakingService.leaveQueue).not.toHaveBeenCalled();
  });

  it("handles leaveQueue failure during disconnect without throwing", async () => {
    mockMatchmakingService.leaveQueue.mockRejectedValueOnce(
      new Error("Redis error"),
    );
    await expect(handler.handleDisconnect(mockSocket)).resolves.toBeUndefined();
  });
});
