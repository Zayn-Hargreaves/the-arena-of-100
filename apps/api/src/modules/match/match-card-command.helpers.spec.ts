// ============================================================
// match-card-command.helpers — dedicated spec
// Source of truth: PR #87 added new private helpers
// (findCanonicalCardEvent, emitPlayerCommandError,
// sanitizeCardEffect, emitCardResolved) under
// apps/api/src/modules/match/. This spec drives the three
// uncovered branches documented in the PR review:
//   - emitPlayerCommandError `error == null ? "null" : String(error)` arm
//   - sanitizeCardEffect default case (exhaustive-never fallback)
//   - emitCardResolved `resolvedEffect == null` early return
// plus a happy-path round-trip to lock the public contract.
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import {
  findCanonicalCardEvent,
  emitPlayerCommandError,
  sanitizeCardEffect,
  emitCardResolved,
} from "./match-card-command.helpers";
import { MatchStateMachine } from "@arena/game-core";
import {
  ClientEvent,
  ErrorCode,
  PlayerStatus,
  RoomError,
  ServerEvent,
  type CardEffect,
  type CardId,
} from "@arena/shared";

type MockCall = {
  channel: string;
  event: string;
  payload: unknown;
  excluded: readonly string[];
};

function makeMockServer(): {
  server: Server;
  callsByEvent: (event: string) => Array<[string, unknown]>;
  callsByChannelAndEvent: (
    channel: string,
    event: string,
  ) => Array<[string, unknown]>;
  callsWithExclusion: () => MockCall[];
} {
  const calls: MockCall[] = [];
  const builder = (channel: string, excluded: readonly string[] = []) => ({
    emit: (event: string, payload: unknown) => {
      calls.push({ channel, event, payload, excluded });
      return builder(channel, excluded);
    },
    except: (...rooms: (string | string[])[]) => {
      const flat = rooms.flat();
      return builder(channel, [...excluded, ...flat]);
    },
  });
  const server = {
    to: (channel: string) => builder(channel),
  } as unknown as Server;
  return {
    server,
    callsByEvent: (event: string) =>
      calls
        .filter((c) => c.event === event)
        .map((c): [string, unknown] => [c.event, c.payload]),
    callsByChannelAndEvent: (channel: string, event: string) =>
      calls
        .filter((c) => c.channel === channel && c.event === event)
        .map((c): [string, unknown] => [c.event, c.payload]),
    callsWithExclusion: () => [...calls],
  };
}

function makeSm(): MatchStateMachine {
  return new MatchStateMachine("m1", "r1", [
    {
      id: "p1",
      name: "P1",
      status: PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    },
  ]);
}

describe("findCanonicalCardEvent", () => {
  it("returns the most recent matching CARD_PICKED by (playerId, selectedCardId, offerSeqNo)", () => {
    const sm = makeSm();
    sm.classAssignment(["p1"], "seed");
    const cards = sm.pickOffer("p1", 5, "offer-1");
    const pickedCardId = cards[0]!;
    const offerSeqNo = sm.getHeadSeqNo();
    sm.pickCard("p1", pickedCardId, offerSeqNo);

    const found = findCanonicalCardEvent(
      sm,
      "CARD_PICKED",
      "p1",
      pickedCardId,
      offerSeqNo,
    );

    expect(found).not.toBeNull();
    expect(found!.payload.playerId).toBe("p1");
    expect(found!.payload.selectedCardId).toBe(pickedCardId);
    expect(found!.payload.offerSeqNo).toBe(offerSeqNo);
    expect(found!.seqNo).toBeGreaterThan(0);
  });

  it("returns the most recent matching CARD_RESOLVED by (playedByPlayerId, cardId, offerSeqNo)", () => {
    const sm = makeSm();
    sm.classAssignment(["p1"], "seed");
    const cards = sm.pickOffer("p1", 5, "offer-2");
    const pickedCardId = cards[0]!;
    const offerSeqNo = sm.getHeadSeqNo();
    sm.pickCard("p1", pickedCardId, offerSeqNo);
    sm.playCard(
      "p1",
      pickedCardId,
      offerSeqNo,
      {
        kind: "TIMER_MODIFY",
        deltaMs: -1000,
        targetCount: 1,
      },
      ["p1"],
      1000,
      { eventId: "evt-canon", commandId: "cmd-canon" },
    );

    const found = findCanonicalCardEvent(
      sm,
      "CARD_RESOLVED",
      "p1",
      pickedCardId,
      offerSeqNo,
    );

    expect(found).not.toBeNull();
    expect(found!.payload.playedByPlayerId).toBe("p1");
    expect(found!.payload.cardId).toBe(pickedCardId);
    expect(found!.payload.offerSeqNo).toBe(offerSeqNo);
    expect(found!.payload.eventId).toBe("evt-canon");
  });

  it("returns null when no matching CARD_PICKED exists", () => {
    const sm = makeSm();
    const found = findCanonicalCardEvent(
      sm,
      "CARD_PICKED",
      "p1",
      "CB-1" as CardId,
      1,
    );
    expect(found).toBeNull();
  });

  it("skips non-matching CARD_PICKED entries (wrong playerId / cardId / offerSeqNo) and returns null", () => {
    const sm = makeSm();
    sm.classAssignment(["p1"], "seed");
    const cards = sm.pickOffer("p1", 5, "offer-skip");
    const offerSeqNo = sm.getHeadSeqNo();
    const mismatchedCard = cards[1]!;
    sm.pickCard("p1", mismatchedCard, offerSeqNo);

    // The log has exactly one CARD_PICKED — but it doesn't match
    // (playerId, selectedCardId, offerSeqNo). The helper walks the
    // log in reverse, sees a type match, falls into the mismatch
    // guard, returns undefined, and keeps iterating until empty.
    const found = findCanonicalCardEvent(
      sm,
      "CARD_PICKED",
      "p2",
      cards[0]!,
      offerSeqNo + 999,
    );
    expect(found).toBeNull();
  });
});

describe("emitPlayerCommandError", () => {
  let logger: Logger;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger("t", { timestamp: false });
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  it("emits ServerEvent.ERROR with the mapped RoomError code (logger.warn NOT called)", () => {
    const recorder = makeMockServer();
    const err = new RoomError(ErrorCode.CARD_NOT_IN_HAND);
    emitPlayerCommandError(
      logger,
      recorder.server,
      "p1",
      ClientEvent.CARD_PLAY,
      "cmd-room-1",
      err,
    );

    const errors = recorder.callsByEvent(ServerEvent.ERROR);
    expect(errors.length).toBe(1);
    const payload = errors[0]?.[1] as {
      code: ErrorCode;
      failedEvent: string;
      commandId: string;
    };
    expect(payload.code).toBe(ErrorCode.CARD_NOT_IN_HAND);
    expect(payload.failedEvent).toBe(ClientEvent.CARD_PLAY);
    expect(payload.commandId).toBe("cmd-room-1");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits ServerEvent.ERROR with INVALID_PAYLOAD and warns with 'null' when error is null", () => {
    const recorder = makeMockServer();
    emitPlayerCommandError(
      logger,
      recorder.server,
      "p1",
      ClientEvent.CARD_PLAY,
      "cmd-null",
      null,
    );

    const errors = recorder.callsByEvent(ServerEvent.ERROR);
    expect(errors.length).toBe(1);
    const payload = errors[0]?.[1] as {
      code: ErrorCode;
      failedEvent: string;
      commandId: string;
    };
    expect(payload.code).toBe(ErrorCode.INVALID_PAYLOAD);
    expect(payload.failedEvent).toBe(ClientEvent.CARD_PLAY);
    expect(payload.commandId).toBe("cmd-null");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain("null");
  });

  it("emits ServerEvent.ERROR with INVALID_PAYLOAD and warns with the String(error) of a non-Error value", () => {
    const recorder = makeMockServer();
    emitPlayerCommandError(
      logger,
      recorder.server,
      "p1",
      ClientEvent.CARD_PLAY,
      "cmd-num",
      42,
    );

    const errors = recorder.callsByEvent(ServerEvent.ERROR);
    expect(errors.length).toBe(1);
    const payload = errors[0]?.[1] as {
      code: ErrorCode;
      failedEvent: string;
      commandId: string;
    };
    expect(payload.code).toBe(ErrorCode.INVALID_PAYLOAD);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain("42");
  });

  it("emits ServerEvent.ERROR with INVALID_PAYLOAD and warns with `error.message` for a plain Error", () => {
    const recorder = makeMockServer();
    emitPlayerCommandError(
      logger,
      recorder.server,
      "p1",
      ClientEvent.CARD_PLAY,
      "cmd-err",
      new Error("synthetic failure"),
    );

    const errors = recorder.callsByEvent(ServerEvent.ERROR);
    expect(errors.length).toBe(1);
    expect((errors[0]?.[1] as { code: ErrorCode }).code).toBe(
      ErrorCode.INVALID_PAYLOAD,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain("synthetic failure");
  });
});

describe("sanitizeCardEffect", () => {
  it("clears `indexes` for OPTION_DISABLE", () => {
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [1, 2],
      count: 2,
      availableAtResolution: 3,
      durationMs: 5000,
    };
    const sanitized = sanitizeCardEffect(effect);
    expect(sanitized.kind).toBe("OPTION_DISABLE");
    expect(
      (sanitized as Extract<CardEffect, { kind: "OPTION_DISABLE" }>).indexes,
    ).toEqual([]);
  });

  it("clears `indexes` for OPTION_FAKE", () => {
    const effect: CardEffect = {
      kind: "OPTION_FAKE",
      indexes: [0, 3],
      durationMs: 8000,
    };
    const sanitized = sanitizeCardEffect(effect);
    expect(sanitized.kind).toBe("OPTION_FAKE");
    expect(
      (sanitized as Extract<CardEffect, { kind: "OPTION_FAKE" }>).indexes,
    ).toEqual([]);
  });

  it("clears `partial` for HINT_REVEAL", () => {
    const effect: CardEffect = {
      kind: "HINT_REVEAL",
      partial: "first-3-chars",
    };
    const sanitized = sanitizeCardEffect(effect);
    expect(sanitized.kind).toBe("HINT_REVEAL");
    expect(
      (sanitized as Extract<CardEffect, { kind: "HINT_REVEAL" }>).partial,
    ).toBe("");
  });

  it("clears `destroyedCardIds` for HAND_DESTROY", () => {
    const effect: CardEffect = {
      kind: "HAND_DESTROY",
      count: 1,
      availableAtResolution: 2,
      destroyedCardIds: ["CB-1", "CB-2"],
    };
    const sanitized = sanitizeCardEffect(effect);
    expect(sanitized.kind).toBe("HAND_DESTROY");
    expect(
      (sanitized as Extract<CardEffect, { kind: "HAND_DESTROY" }>)
        .destroyedCardIds,
    ).toEqual([]);
  });

  it("passes through TIMER_MODIFY verbatim", () => {
    const effect: CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -2000,
      targetCount: 3,
    };
    const sanitized = sanitizeCardEffect(effect);
    expect(sanitized).toBe(effect);
  });

  it("returns the same effect reference for an unknown kind (default branch)", () => {
    const bogusEffect = {
      kind: "__NOT_A_KIND__",
      payload: "x",
    } as unknown as CardEffect;
    const sanitized = sanitizeCardEffect(bogusEffect);
    expect(sanitized).toBe(bogusEffect);
  });
});

describe("emitCardResolved", () => {
  let logger: Logger;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger("t", { timestamp: false });
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  it("warns 'missing roomId' and skips the broadcast when roomId is undefined", () => {
    const recorder = makeMockServer();
    emitCardResolved(logger, recorder.server, undefined, {
      matchId: "m1",
      cardId: "CB-1",
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2"],
      effect: {
        kind: "TIMER_MODIFY",
        deltaMs: -1000,
        targetCount: 1,
      },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain("missing roomId");
    expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length).toBe(0);
  });

  it("warns 'null resolvedEffect' and skips the broadcast when effect is null", () => {
    const recorder = makeMockServer();
    emitCardResolved(logger, recorder.server, "r1", {
      matchId: "m1",
      cardId: "CB-1",
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2"],
      effect: null as unknown as CardEffect,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain(
      "null resolvedEffect",
    );
    expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length).toBe(0);
  });

  it("happy path — sanitized room broadcast excludes per-target rooms; per-target receives full effect", () => {
    const recorder = makeMockServer();
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [1, 2],
      count: 2,
      availableAtResolution: 3,
      durationMs: 5000,
    };
    emitCardResolved(logger, recorder.server, "r1", {
      matchId: "m1",
      cardId: "CB-1",
      offerSeqNo: 7,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2", "p3"],
      effect,
    });

    const room = recorder.callsByChannelAndEvent(
      "room:r1",
      ServerEvent.CARD_RESOLVED,
    );
    const p2 = recorder.callsByChannelAndEvent(
      "player:p2",
      ServerEvent.CARD_RESOLVED,
    );
    const p3 = recorder.callsByChannelAndEvent(
      "player:p3",
      ServerEvent.CARD_RESOLVED,
    );
    expect(room.length).toBe(1);
    expect(p2.length).toBe(1);
    expect(p3.length).toBe(1);

    // Sanitized room broadcast: indexes cleared.
    const roomPayload = room[0]?.[1] as { effect: CardEffect };
    const roomEffect = roomPayload.effect as Extract<
      CardEffect,
      { kind: "OPTION_DISABLE" }
    >;
    expect(roomEffect.indexes).toEqual([]);

    // Per-target broadcasts: full effect retained.
    const p2Payload = p2[0]?.[1] as { effect: CardEffect };
    const p2Effect = p2Payload.effect as Extract<
      CardEffect,
      { kind: "OPTION_DISABLE" }
    >;
    expect(p2Effect.indexes).toEqual([1, 2]);
    const p3Payload = p3[0]?.[1] as { effect: CardEffect };
    const p3Effect = p3Payload.effect as Extract<
      CardEffect,
      { kind: "OPTION_DISABLE" }
    >;
    expect(p3Effect.indexes).toEqual([1, 2]);

    // The room broadcast MUST exclude the per-target rooms.
    const roomCall = recorder
      .callsWithExclusion()
      .find(
        (c) => c.channel === "room:r1" && c.event === ServerEvent.CARD_RESOLVED,
      );
    expect(roomCall?.excluded).toEqual(["player:p2", "player:p3"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("treats a non-array targetPlayerIds as empty (defensive replay safety)", () => {
    const recorder = makeMockServer();
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [1, 2],
      count: 2,
      availableAtResolution: 3,
      durationMs: 5000,
    };
    emitCardResolved(logger, recorder.server, "r1", {
      matchId: "m1",
      cardId: "CB-1",
      offerSeqNo: 7,
      playedByPlayerId: "p1",
      targetPlayerIds: "not-an-array" as unknown as string[],
      effect,
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length).toBe(1);
  });
});
