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

import { useCallback, useMemo } from "react";
import { useSocketStore } from "@/stores/socket-store";
import { ClientEvent, type CardId } from "@arena/shared";

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
  newCommandId: () => string;
  isReady: boolean;
}

// 64-char-cap commandId — `crypto.randomUUID` produces 36 chars,
// well under the boundary. The fallback keeps SSR / older
// browsers safe.
function makeCommandId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useCardActions({
  matchId,
  onError,
}: UseCardActionsOptions): UseCardActionsResult {
  const socket = useSocketStore((state) => state.socket);

  const pickCard = useCallback(
    (cardId: CardId, offerSeqNo: number) => {
      if (!socket || !matchId) return;
      socket.emit(ClientEvent.CARD_PICK, {
        matchId,
        cardId,
        offerSeqNo,
        commandId: makeCommandId(),
      });
    },
    [socket, matchId],
  );

  const playCard = useCallback(
    (cardId: CardId, offerSeqNo: number, targetPlayerId?: string) => {
      if (!socket || !matchId || !offerSeqNo || offerSeqNo <= 0) return;
      socket.emit(
        ClientEvent.CARD_PLAY,
        targetPlayerId
          ? {
              matchId,
              cardId,
              offerSeqNo,
              targetPlayerId,
              commandId: makeCommandId(),
            }
          : {
              matchId,
              cardId,
              offerSeqNo,
              commandId: makeCommandId(),
            },
      );
    },
    [socket, matchId],
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
    socket.on("error", handler);
    return () => {
      socket.off("error", handler);
    };
  }, [socket, onError]);

  return {
    pickCard,
    playCard,
    newCommandId: makeCommandId,
    isReady,
  };
}

// Re-exported so consumers can `import { useCardActions } from "..."`.
import { useEffect } from "react";
