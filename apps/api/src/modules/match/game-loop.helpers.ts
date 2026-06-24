import { ServerEvent, getRoomChannel, type RoomStatus } from "@arena/shared";
import type { Server } from "socket.io";
import type {
  LobbyCountdownEntry,
  PendingRecoveryEntry,
  RoomStatusUpdatePayload,
  WaitingRoomReason,
} from "./game-loop.types";

export function makeLobbyCountdownEntry(
  countdownEndsAt: number,
  timer?: NodeJS.Timeout,
): LobbyCountdownEntry {
  return { timer, countdownEndsAt };
}

export function makePendingRecoveryEntry(
  roomId: string,
  countdownEndsAt: number,
  expired: boolean,
  retryCount: number = 0,
): PendingRecoveryEntry {
  return { roomId, countdownEndsAt, expired, retryCount };
}

export function emitRoomStatusUpdated(
  server: Server,
  payload: RoomStatusUpdatePayload,
) {
  server
    .to(getRoomChannel(payload.roomId))
    .emit(ServerEvent.ROOM_STATUS_UPDATED, payload);
}

export function emitWaitingRoomState(
  roomId: string,
  server: Server,
  reason: WaitingRoomReason,
  roomStatus: RoomStatus,
) {
  const updatedAt = Date.now();
  server.to(getRoomChannel(roomId)).emit(ServerEvent.ROOM_COUNTDOWN_CANCELLED, {
    roomId,
    roomStatus,
    reason,
    cancelledAt: updatedAt,
  });

  emitRoomStatusUpdated(server, {
    roomId,
    roomStatus,
    currentMatchId: null,
    updatedAt,
  });
}

export function emitMatchStarting(
  server: Server,
  roomId: string,
  matchId: string,
  countdownSeconds: number,
) {
  server.to(getRoomChannel(roomId)).emit(ServerEvent.MATCH_STARTING, {
    matchId,
    countdown: countdownSeconds,
  });
}

export function emitMatchStarted(
  server: Server,
  roomId: string,
  matchId: string,
  status: string,
  countdownMs: number,
) {
  server.to(getRoomChannel(roomId)).emit(ServerEvent.MATCH_STARTED, {
    matchId,
    roomId,
    status,
    countdownMs,
  });
}

export function emitRoomTerminated(
  server: Server,
  roomId: string,
  payload: { matchId: string | null; message?: string },
) {
  server.to(getRoomChannel(roomId)).emit(ServerEvent.ROOM_TERMINATED, {
    roomId,
    reason: "ADMIN_TERMINATED",
    matchId: payload.matchId,
    message: payload.message,
    terminatedAt: Date.now(),
  });
}
