import type { CardId } from "@arena/shared";
import type { CardOfferState, CardState } from "./socket-store.types";

export interface PendingTopicVoteCommand {
  commandId: string;
  matchId: string;
  topic: string;
}

export type PendingCardCommand =
  | {
      type: "PICK";
      commandId: string;
      matchId: string;
      cardId: CardId;
      offerSeqNo: number;
      addedToHand: boolean;
      previousOffer: CardOfferState | null;
    }
  | {
      type: "PLAY";
      commandId: string;
      matchId: string;
      cardId: CardId;
      offerSeqNo: number;
      addedToPlayed: boolean;
    };

export interface PendingSecondChanceConsumption {
  matchId: string;
  cardState: CardState;
}

export const pendingTopicVoteCommandsByMatch = new Map<
  string,
  PendingTopicVoteCommand[]
>();
export const confirmedTopicVoteBaselineByMatch = new Map<
  string,
  string | null
>();
export const pendingCardCommands = new Map<string, PendingCardCommand>();
export const consumedSecondChanceBySubmissionId = new Map<
  string,
  PendingSecondChanceConsumption
>();

export function resetSocketStateMaps(): void {
  pendingTopicVoteCommandsByMatch.clear();
  confirmedTopicVoteBaselineByMatch.clear();
  pendingCardCommands.clear();
  consumedSecondChanceBySubmissionId.clear();
}

export function clearTopicVoteState(matchId?: string) {
  if (matchId) {
    pendingTopicVoteCommandsByMatch.delete(matchId);
    confirmedTopicVoteBaselineByMatch.delete(matchId);
  } else {
    pendingTopicVoteCommandsByMatch.clear();
    confirmedTopicVoteBaselineByMatch.clear();
  }
}

export function clearCardCommandState(matchId?: string) {
  if (matchId) {
    for (const [cmdId, cmd] of pendingCardCommands.entries()) {
      if (cmd.matchId === matchId) {
        pendingCardCommands.delete(cmdId);
      }
    }
    for (const [subId, entry] of consumedSecondChanceBySubmissionId.entries()) {
      if (entry.matchId === matchId) {
        consumedSecondChanceBySubmissionId.delete(subId);
      }
    }
  } else {
    pendingCardCommands.clear();
    consumedSecondChanceBySubmissionId.clear();
  }
}

export function getEffectiveTopicVote(matchId: string): string | null {
  const pending = pendingTopicVoteCommandsByMatch.get(matchId);
  return (
    pending?.[pending.length - 1]?.topic ??
    confirmedTopicVoteBaselineByMatch.get(matchId) ??
    null
  );
}

export function resolvePendingCardCommand(
  type: "PICK" | "PLAY",
  matchId: string,
  cardId: CardId,
  commandId?: string,
): void {
  if (commandId && pendingCardCommands.has(commandId)) {
    pendingCardCommands.delete(commandId);
    return;
  }
  for (const [cmdId, cmd] of pendingCardCommands.entries()) {
    if (cmd.type === type && cmd.matchId === matchId && cmd.cardId === cardId) {
      pendingCardCommands.delete(cmdId);
      break;
    }
  }
}
