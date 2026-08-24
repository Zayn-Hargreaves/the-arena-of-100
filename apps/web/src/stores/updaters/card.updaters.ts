import {
  ClientEvent,
  GAME_CONFIG,
  type CardId,
  type ClassId,
  type CardEffectEvent,
} from "@arena/shared";
import type { SocketState } from "../socket-store.types";
import type {
  PendingCardCommand,
  PendingSecondChanceConsumption,
} from "../socket-store.state-maps";

function getEffectId(eff: CardEffectEvent): string {
  if (eff.eventId) return eff.eventId;
  if (eff.commandId) return eff.commandId;
  return `${eff.matchId}-${eff.roundNo}-${eff.cardId}-${eff.playedByPlayerId}-${eff.offerSeqNo}-${eff.serverTimestamp}`;
}

export function hasSecondChance(
  cardState: SocketState["cardState"] | undefined,
  userId: string | null | undefined,
  roundNo: number,
): boolean {
  if (!userId || !cardState) return false;

  const activeMatch = cardState.activeRoundEffects?.some(
    (e) =>
      (e.playedByPlayerId === userId || e.targetPlayerIds?.includes(userId)) &&
      e.effect.kind === "SECOND_CHANCE" &&
      (e.targetRoundNo ?? e.roundNo) === roundNo,
  );
  if (activeMatch) return true;

  const lastResolved = cardState.lastResolvedEffect;
  if (
    lastResolved &&
    (lastResolved.playedByPlayerId === userId ||
      lastResolved.targetPlayerIds?.includes(userId)) &&
    lastResolved.effect.kind === "SECOND_CHANCE" &&
    (lastResolved.targetRoundNo ?? lastResolved.roundNo) === roundNo
  ) {
    return true;
  }

  return false;
}

export function applyClassAssignedState(
  state: SocketState,
  data: {
    matchId: string;
    assignments: Array<{ playerId: string; classId: ClassId }>;
    seedUsed: string;
  },
): Partial<SocketState> {
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (!activeMatchId || data.matchId !== activeMatchId) {
    return {};
  }

  const assignmentMap = new Map<string, ClassId>();
  for (const a of data.assignments) {
    assignmentMap.set(a.playerId, a.classId);
  }

  const ownClassId =
    (state.userId ? assignmentMap.get(state.userId) : undefined) ??
    state.cardState.classId;

  // Independently map room and match player rosters
  const updatedRoomPlayers = state.room?.players.map((p) => {
    const classId = assignmentMap.get(p.id);
    return classId !== undefined ? { ...p, classId } : p;
  });

  const updatedMatchPlayers = state.match?.players.map((p) => {
    const classId = assignmentMap.get(p.id);
    return classId !== undefined ? { ...p, classId } : p;
  });

  return {
    cardState: {
      ...state.cardState,
      classId: ownClassId,
    },
    room:
      state.room && updatedRoomPlayers
        ? { ...state.room, players: updatedRoomPlayers }
        : state.room,
    match:
      state.match && updatedMatchPlayers
        ? { ...state.match, players: updatedMatchPlayers }
        : state.match,
  };
}

export function applyCardOfferState(
  state: SocketState,
  data: {
    matchId: string;
    roundNo: number;
    playerId: string;
    offeredCardIds: readonly [CardId, CardId, CardId];
    offerSeqNo: number;
    seedUsed: string;
    durationMs?: number;
    expiresAt?: number;
  },
): Partial<SocketState> {
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || data.matchId !== activeMatchId) {
    return {};
  }
  // Only apply to the designated player
  if (state.userId && data.playerId !== state.userId) {
    return {};
  }

  // If there is an existing offer, only accept newer/matching sequence
  if (
    state.cardState.currentOffer &&
    data.offerSeqNo < state.cardState.currentOffer.offerSeqNo
  ) {
    return {};
  }

  const serverExpiresAt = data.expiresAt;
  const serverDurationMs = data.durationMs;
  const fallbackDurationMs = GAME_CONFIG.CARD_OFFER_DURATION_MS;
  const expiresAt =
    serverExpiresAt ??
    (state.cardState.currentOffer?.offerSeqNo === data.offerSeqNo &&
    state.cardState.currentOffer.expiresAt
      ? state.cardState.currentOffer.expiresAt
      : serverDurationMs
        ? Date.now() + serverDurationMs
        : Date.now() + fallbackDurationMs);

  return {
    cardState: {
      ...state.cardState,
      currentOffer: {
        matchId: data.matchId,
        roundNo: data.roundNo,
        offeredCardIds: data.offeredCardIds,
        offerSeqNo: data.offerSeqNo,
        seedUsed: data.seedUsed,
        expiresAt,
      },
    },
  };
}

export function applyCardPickedState(
  state: SocketState,
  data: {
    matchId: string;
    roundNo: number;
    playerId: string;
    selectedCardId: CardId;
    offerSeqNo: number;
  },
): Partial<SocketState> {
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || data.matchId !== activeMatchId) {
    return {};
  }
  if (state.userId && data.playerId !== state.userId) {
    return {};
  }

  // If currentOffer is active and offerSeqNo does not match, ignore stale pick
  if (
    state.cardState.currentOffer &&
    data.offerSeqNo !== state.cardState.currentOffer.offerSeqNo
  ) {
    return {};
  }

  const currentHand = state.cardState.hand;
  const isAlreadyInHand = currentHand.includes(data.selectedCardId);
  const nextHand = isAlreadyInHand
    ? currentHand
    : [...currentHand, data.selectedCardId];

  return {
    cardState: {
      ...state.cardState,
      hand: nextHand,
      offerSeqNoByCardId: {
        ...(state.cardState.offerSeqNoByCardId ?? {}),
        [data.selectedCardId]: data.offerSeqNo,
      },
      currentOffer: null, // dismiss active offer
    },
  };
}

export function applyCardResolvedState(
  state: SocketState,
  data: CardEffectEvent,
): Partial<SocketState> {
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || data.matchId !== activeMatchId) {
    return {};
  }

  const isPlayedBySelf = state.userId && data.playedByPlayerId === state.userId;
  const currentPlayed = state.cardState.playedCardIds;
  const nextPlayed =
    isPlayedBySelf && data.cardId && !currentPlayed.includes(data.cardId)
      ? [...currentPlayed, data.cardId]
      : currentPlayed;

  const currentRoundNo = state.match?.currentRoundNo ?? data.roundNo;
  const targetRoundNo = data.targetRoundNo ?? data.roundNo;

  const isCurrentRound = targetRoundNo <= currentRoundNo;

  const currentActive = state.cardState.activeRoundEffects ?? [];
  const currentPending = state.cardState.pendingNextRoundEffects ?? [];

  const effectId = getEffectId(data);
  const consumedIds = state.cardState.consumedEffectIds ?? [];
  if (consumedIds.includes(effectId)) {
    return {
      cardState: {
        ...state.cardState,
        playedCardIds: nextPlayed,
      },
    };
  }

  const alreadyInActive = currentActive.some(
    (e) => getEffectId(e) === effectId,
  );
  const alreadyInPending = currentPending.some(
    (e) => getEffectId(e) === effectId,
  );

  if (alreadyInActive || alreadyInPending) {
    return {
      cardState: {
        ...state.cardState,
        playedCardIds: nextPlayed,
        lastResolvedEffect: data,
      },
    };
  }

  const nextActive = isCurrentRound ? [...currentActive, data] : currentActive;
  const nextPending = isCurrentRound
    ? currentPending
    : [...currentPending, data];

  return {
    cardState: {
      ...state.cardState,
      playedCardIds: nextPlayed,
      lastResolvedEffect: data,
      activeRoundEffects: nextActive,
      pendingNextRoundEffects: nextPending,
    },
  };
}

export function applyConsumeSecondChance(
  state: SocketState,
  playerId?: string,
): Partial<SocketState> {
  const targetId = playerId ?? state.userId;
  if (!targetId) return {};

  const currentActive = state.cardState.activeRoundEffects ?? [];
  const consumedFromActive: string[] = [];
  const nextActive = currentActive.filter((e) => {
    const isTarget =
      (e.playedByPlayerId === targetId ||
        e.targetPlayerIds?.includes(targetId)) &&
      e.effect.kind === "SECOND_CHANCE";
    if (isTarget) {
      consumedFromActive.push(getEffectId(e));
      return false;
    }
    return true;
  });

  const isLastResolvedTarget =
    (state.cardState.lastResolvedEffect?.playedByPlayerId === targetId ||
      state.cardState.lastResolvedEffect?.targetPlayerIds?.includes(
        targetId,
      )) &&
    state.cardState.lastResolvedEffect?.effect.kind === "SECOND_CHANCE";

  if (isLastResolvedTarget && state.cardState.lastResolvedEffect) {
    consumedFromActive.push(getEffectId(state.cardState.lastResolvedEffect));
  }

  const nextLastResolved = isLastResolvedTarget
    ? null
    : state.cardState.lastResolvedEffect;

  const currentConsumed = state.cardState.consumedEffectIds ?? [];
  const nextConsumed = Array.from(
    new Set([...currentConsumed, ...consumedFromActive]),
  );

  return {
    cardState: {
      ...state.cardState,
      activeRoundEffects: nextActive,
      lastResolvedEffect: nextLastResolved,
      consumedEffectIds: nextConsumed,
    },
  };
}

export function applyOptimisticCardPick(
  state: SocketState,
  data: { cardId: CardId; offerSeqNo: number },
): Partial<SocketState> {
  const { cardId, offerSeqNo } = data;
  return {
    cardState: {
      ...state.cardState,
      hand: state.cardState.hand.includes(cardId)
        ? state.cardState.hand
        : [...state.cardState.hand, cardId],
      offerSeqNoByCardId: {
        ...(state.cardState.offerSeqNoByCardId ?? {}),
        [cardId]: offerSeqNo,
      },
      currentOffer: null,
    },
  };
}

export function applyOptimisticCardPlay(
  state: SocketState,
  data: { cardId: CardId },
): Partial<SocketState> {
  const { cardId } = data;
  return {
    cardState: {
      ...state.cardState,
      playedCardIds: state.cardState.playedCardIds.includes(cardId)
        ? state.cardState.playedCardIds
        : [...state.cardState.playedCardIds, cardId],
    },
  };
}

export function applySubmitAnswerErrorState(
  state: SocketState,
  data: { failedEvent?: string; submissionId?: string },
  savedSecondChance?: PendingSecondChanceConsumption,
): Partial<SocketState> {
  const { submissionId } = data;
  const pendingAnswer = state.pendingAnswer;
  if (
    !pendingAnswer ||
    data.failedEvent !== ClientEvent.SUBMIT_ANSWER ||
    submissionId !== pendingAnswer.submissionId
  ) {
    return {};
  }

  const currentMatchId = state.room?.currentMatchId ?? state.match?.id;
  const shouldRestoreCard =
    savedSecondChance &&
    (!currentMatchId || savedSecondChance.matchId === currentMatchId);

  return {
    pendingAnswer: null,
    ...(shouldRestoreCard ? { cardState: savedSecondChance.cardState } : {}),
  };
}

export function applyCardCommandErrorState(
  state: SocketState,
  data: { failedEvent?: string; commandId?: string },
  pending?: PendingCardCommand,
): Partial<SocketState> {
  if (
    (data.failedEvent !== ClientEvent.CARD_PICK &&
      data.failedEvent !== ClientEvent.CARD_PLAY) ||
    !data.commandId ||
    !pending
  ) {
    return {};
  }

  const currentMatchId = state.room?.currentMatchId ?? state.match?.id;
  if (currentMatchId !== pending.matchId) {
    return {};
  }

  if (pending.type === "PICK") {
    const nextOfferSeqNo = {
      ...(state.cardState.offerSeqNoByCardId ?? {}),
    };
    if (pending.addedToHand) {
      delete nextOfferSeqNo[pending.cardId];
    }
    return {
      cardState: {
        ...state.cardState,
        hand: pending.addedToHand
          ? state.cardState.hand.filter((id) => id !== pending.cardId)
          : state.cardState.hand,
        offerSeqNoByCardId: nextOfferSeqNo,
        currentOffer:
          state.cardState.currentOffer ??
          (pending.previousOffer?.matchId === currentMatchId
            ? pending.previousOffer
            : null),
      },
    };
  }

  if (pending.type === "PLAY") {
    return {
      cardState: {
        ...state.cardState,
        playedCardIds: pending.addedToPlayed
          ? state.cardState.playedCardIds.filter((id) => id !== pending.cardId)
          : state.cardState.playedCardIds,
      },
    };
  }

  return {};
}
