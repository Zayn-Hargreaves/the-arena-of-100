import type { RoomStatus } from "@arena/shared";

export interface LobbyCountdownEntry {
  timer?: NodeJS.Timeout;
  countdownEndsAt: number;
}

export interface PendingRecoveryEntry {
  roomId: string;
  countdownEndsAt: number;
  expired: boolean;
}

export interface RoomStatusUpdatePayload {
  roomId: string;
  roomStatus: RoomStatus;
  currentMatchId: string | null;
  updatedAt: number;
}

export type WaitingRoomReason = "PLAYER_LEFT" | "NOT_ENOUGH_PLAYERS";
