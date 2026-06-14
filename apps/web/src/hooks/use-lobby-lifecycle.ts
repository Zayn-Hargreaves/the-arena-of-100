"use client";

import { useEffect, useState } from "react";
import { RoomStatus } from "@arena/shared";
import { useSocketStore } from "@/stores/socket-store";

/**
 * Encapsulates lobby lifecycle wiring for the room page.
 *
 * Replaces page-local lifecycle hacks (countdown interval, auto-join effect,
 * dev mock player fallback) with a single reactive hook that derives
 * presentation state directly from the socket store.
 *
 * NOTE: This hook intentionally does NOT depend on `next-intl`. The
 * human-readable `roomStatusMessage` is built by the caller (LobbyPage) using
 * `useTranslations("lobby.status")` so the hook stays a pure domain adapter.
 */
export function useLobbyLifecycle(roomCode: string) {
  const { room, userId, username, isConnected, joinRoom } = useSocketStore();

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  // Auto-join when the socket is ready and we are not already in the room.
  useEffect(() => {
    if (!isConnected || (room && room.code === roomCode)) {
      return;
    }

    let cancelled = false;

    const autoJoin = async () => {
      setJoining(true);
      setJoinError(null);

      try {
        await joinRoom(roomCode);
      } catch (error) {
        if (!cancelled) {
          setJoinError(
            error instanceof Error ? error.message : "lobby.unknownError",
          );
        }
      } finally {
        if (!cancelled) {
          setJoining(false);
        }
      }
    };

    void autoJoin();

    return () => {
      cancelled = true;
    };
  }, [isConnected, roomCode, room, joinRoom]);

  // Drive the countdown display from the server-authoritative
  // `countdownEndsAt` timestamp.
  useEffect(() => {
    if (!room?.countdownEndsAt) {
      return;
    }

    setCountdownNow(Date.now());
    const interval = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [room?.countdownEndsAt]);

  const roomHostId = room?.hostId ?? null;
  const isHost = Boolean(userId && roomHostId && userId === roomHostId);
  const isPrivateRoom = room?.roomType === "PRIVATE";
  const roomStatus = room?.status ?? RoomStatus.WAITING;

  const countdownRemainingMs = room?.countdownEndsAt
    ? Math.max(room.countdownEndsAt - countdownNow, 0)
    : 0;
  const countdownRemainingSeconds = Math.ceil(countdownRemainingMs / 1000);

  const isStarting =
    roomStatus === RoomStatus.COUNTDOWN || roomStatus === RoomStatus.STARTING;
  const isInGame = roomStatus === RoomStatus.IN_GAME;

  // Phase 3: dev-only mock fallback removed. The page now reads strictly
  // from the server-authoritative player list. Empty arrays mean "waiting
  // for players", which the UI already handles.
  const playersList = room?.players ?? [];

  // Host can start a private room only when the room is idle and at least
  // two players have joined. `!joining` is intentionally omitted: the start
  // button is independently disabled while `joining` is true via the
  // transient network state, and the server is the source of truth for
  // race conditions (a stale client state will be reconciled on the next
  // ROOM_* event).
  const canHostStart =
    isHost &&
    isPrivateRoom &&
    roomStatus === RoomStatus.WAITING &&
    playersList.length >= 2;

  return {
    room,
    userId,
    username,
    isConnected,
    isHost,
    isPrivateRoom,
    roomStatus,
    countdownRemainingSeconds,
    isStarting,
    isInGame,
    playersList,
    canHostStart,
    joining,
    joinError,
    roomHostId,
  };
}
