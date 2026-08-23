import type { StateCreator } from "zustand";
import { ClientEvent, type CardId } from "@arena/shared";
import { generateId } from "@/lib/id";
import {
  createInitialCardState,
  type CardState,
  type SocketState,
} from "../socket-store.types";
import { emitIfConnected } from "../socket-store.helpers";
import {
  applyConsumeSecondChance,
  applyOptimisticCardPick,
  applyOptimisticCardPlay,
} from "../updaters/card.updaters";
import { pendingCardCommands } from "../socket-store.state-maps";

export interface CardSlice {
  cardState: CardState;

  pickCard: (cardId: CardId, offerSeqNo: number) => void;
  playCard: (
    cardId: CardId,
    offerSeqNo: number,
    targetPlayerId?: string,
  ) => void;
  dismissCardOffer: () => void;
  clearResolvedCardEffect: () => void;
  consumeSecondChance: (playerId?: string) => void;
}

export const createCardSlice: StateCreator<SocketState, [], [], CardSlice> = (
  set,
  get,
) => ({
  cardState: createInitialCardState(),

  pickCard: (cardId, offerSeqNo) => {
    if (!offerSeqNo || offerSeqNo <= 0) return;
    const socket = get().socket;
    const matchId = get().room?.currentMatchId ?? get().match?.id;
    if (!socket?.connected || !matchId) return;

    const commandId = generateId();
    const currentCardState = get().cardState;
    const wasAlreadyInHand = currentCardState.hand.includes(cardId);
    const previousOffer = currentCardState.currentOffer;

    pendingCardCommands.set(commandId, {
      type: "PICK",
      commandId,
      matchId,
      cardId,
      offerSeqNo,
      addedToHand: !wasAlreadyInHand,
      previousOffer,
    });

    // Optimistically dismiss offer and put in hand
    set((state) => applyOptimisticCardPick(state, { cardId, offerSeqNo }));

    emitIfConnected(socket, ClientEvent.CARD_PICK, {
      matchId,
      cardId,
      offerSeqNo,
      commandId,
    });
  },

  playCard: (cardId, offerSeqNo, targetPlayerId) => {
    if (!offerSeqNo || offerSeqNo <= 0) return;
    const socket = get().socket;
    const matchId = get().room?.currentMatchId ?? get().match?.id;
    if (!socket?.connected || !matchId) return;

    const commandId = generateId();
    const currentCardState = get().cardState;
    const wasAlreadyInPlayed = currentCardState.playedCardIds.includes(cardId);

    pendingCardCommands.set(commandId, {
      type: "PLAY",
      commandId,
      matchId,
      cardId,
      offerSeqNo,
      addedToPlayed: !wasAlreadyInPlayed,
    });

    // Optimistically mark as played
    set((state) => applyOptimisticCardPlay(state, { cardId }));

    emitIfConnected(
      socket,
      ClientEvent.CARD_PLAY,
      targetPlayerId
        ? {
            matchId,
            cardId,
            offerSeqNo,
            targetPlayerId,
            commandId,
          }
        : {
            matchId,
            cardId,
            offerSeqNo,
            commandId,
          },
    );
  },

  dismissCardOffer: () => {
    set((state) => ({
      cardState: {
        ...state.cardState,
        currentOffer: null,
      },
    }));
  },

  clearResolvedCardEffect: () => {
    set((state) => ({
      cardState: {
        ...state.cardState,
        lastResolvedEffect: null,
      },
    }));
  },

  consumeSecondChance: (playerId?: string) => {
    set((state) => applyConsumeSecondChance(state, playerId));
  },
});
