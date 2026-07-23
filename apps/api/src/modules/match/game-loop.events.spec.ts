import { describe, it, expect, vi } from "vitest";
import { Server } from "socket.io";
import { ServerEvent, getPlayerChannel } from "@arena/shared";
import { emitAnswerResult } from "./game-loop.events";

describe("emitAnswerResult", () => {
  it("emits to the SUBMITTER-ONLY player:${userId} channel, never the room channel", () => {
    // B4b privacy contract: per-answer correctness MUST be private to the
    // submitter. Broadcasting to the room would leak every other player's
    // isCorrect to every connected client and spectator in real time.
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const server = { to } as unknown as Server;

    emitAnswerResult(
      server,
      "room-1",
      "match-1",
      "p1",
      { submissionId: "sub-1", isCorrect: true, responseTimeMs: 250 },
      3,
    );

    expect(to).toHaveBeenCalledWith(getPlayerChannel("p1"));
    expect(to).not.toHaveBeenCalledWith("room:room-1");
    expect(emit).toHaveBeenCalledWith(
      ServerEvent.ANSWER_RESULT,
      expect.objectContaining({
        matchId: "match-1",
        userId: "p1",
        submissionId: "sub-1",
        roundNo: 3,
        isCorrect: true,
        responseTimeMs: 250,
      }),
    );
  });

  it("routes different submitters to different channels (no cross-delivery)", () => {
    // Two submitters in the same match get two distinct per-player channels.
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const server = { to } as unknown as Server;

    emitAnswerResult(
      server,
      "room-1",
      "match-1",
      "p1",
      { submissionId: "sub-1", isCorrect: true, responseTimeMs: 100 },
      1,
    );
    emitAnswerResult(
      server,
      "room-1",
      "match-1",
      "p2",
      { submissionId: "sub-2", isCorrect: false, responseTimeMs: 200 },
      1,
    );

    expect(to).toHaveBeenNthCalledWith(1, getPlayerChannel("p1"));
    expect(to).toHaveBeenNthCalledWith(2, getPlayerChannel("p2"));
  });
});
