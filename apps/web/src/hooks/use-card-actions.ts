// ============================================================
// `useCardActions` — Web client hook for card commands.
// Source of truth: memory-bank/spec/class-cards-phase.md §5.2
// sub-task E.
//
// Generates a per-call `commandId` (UUID-like) and forwards
// `card_pick` / `card_play` over the socket. The server's
// `MatchHandler.handleCardPlay` validates against the catalogue,
// the player's hand, the AOE cap, and the offer correlation
// (`offerSeqNo` ↔ `CARD_OFFER.seqNo`).
// ============================================================

import { useCallback, useEffect, useMemo } from "react";
import { useSocketStore } from "@/stores/socket-store";
import { ServerEvent, type CardId } from "@arena/shared";

export interface UseCardActionsOptions {
  matchId: string | null;
  onError?: (code: string, message: string) => void;
}

export interface UseCardActionsResult {
  pickCard: (cardId: CardId, offerSeqNo: number) => void;
  playCard: (
    cardId: CardId,
    offerSeqNo: number,
    targetPlayerId?: string,
  ) => void;
  isReady: boolean;
}

export function useCardActions({
  matchId,
  onError,
}: UseCardActionsOptions): UseCardActionsResult {
  const socket = useSocketStore((state) => state.socket);
  const storePickCard = useSocketStore((state) => state.pickCard);
  const storePlayCard = useSocketStore((state) => state.playCard);

  const pickCard = useCallback(
    (cardId: CardId, offerSeqNo: number) => {
      if (!socket || !matchId) return;
      storePickCard(cardId, offerSeqNo);
    },
    [socket, matchId, storePickCard],
  );

  const playCard = useCallback(
    (cardId: CardId, offerSeqNo: number, targetPlayerId?: string) => {
      if (!socket || !matchId || !offerSeqNo || offerSeqNo <= 0) return;
      storePlayCard(cardId, offerSeqNo, targetPlayerId);
    },
    [socket, matchId, storePlayCard],
  );

  const isReady = useMemo(() => Boolean(socket && matchId), [socket, matchId]);

  // Forward ERRORs to the caller. Server-side errors carry
  // `code` + `message`; the existing `ServerEvent.ERROR` listener
  // (registered in the socket store) fans these out so the
  // hook stays a thin wrapper.
  useEffect(() => {
    if (!socket || !onError) return;
    const handler = (payload: { code?: string; message?: string }) => {
      if (payload.code && payload.message) {
        onError(payload.code, payload.message);
      }
    };
    socket.on(ServerEvent.ERROR, handler);
    return () => {
      socket.off(ServerEvent.ERROR, handler);
    };
  }, [socket, onError]);

  return {
    pickCard,
    playCard,
    isReady,
  };
}
