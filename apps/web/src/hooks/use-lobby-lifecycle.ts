"use client";

import { useEffect, useRef, useState } from "react";
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

  // F8 fix: in-flight guard for the auto-join effect. The
  // previous code's effect re-ran whenever the `room` object
  // changed (which happens on every PLAYER_JOINED / presence
  // tick — i.e. every ~10s of heartbeat). Each re-run started a
  // new `autoJoin` async function. The `cancelled` flag it set in
  // the cleanup only blocked the post-await `setJoining` /
  // `setJoinError` calls, but it did NOT cancel the in-flight
  // `await joinRoom(roomCode)`. The result was a second (and
  // sometimes third) `JOIN_ROOM` emit hitting the server before
  // the first had resolved — racing the server's join policy
  // and, on the `WAITING` rejoin path, tripping the
  // `@@unique([roomId, userId])` constraint.
  //
  // The new `joinInFlightRef` is a synchronous gate: we check
  // it at the start of the effect, and we set/clear it around
  // the `await joinRoom` call. This makes the effect strictly
  // single-flight across the entire `room` lifecycle, so a
  // rapid sequence of presence ticks (or React 18 strict-mode
  // double-invoke in dev) cannot double-emit.
  const joinInFlightRef = useRef(false);

  // Auto-join when the socket is ready and we are not already in the room.
  useEffect(() => {
    if (!isConnected || (room && room.code === roomCode)) {
      return;
    }

    // F8 fix: short-circuit if an auto-join is already in
    // flight for this hook instance. This guards against the
    // re-run-during-await race described above.
    if (joinInFlightRef.current) {
      return;
    }

    let cancelled = false;

    const autoJoin = async () => {
      // F8 fix: claim the in-flight slot synchronously, before
      // the await. This way, even if the effect re-runs the
      // moment we suspend, the second run sees `current === true`
      // and exits without emitting.
      joinInFlightRef.current = true;
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
        // F8 fix: always release the slot, including on the
        // cancelled path (so a future legitimate re-join can
        // proceed after the user has explicitly left the room).
        joinInFlightRef.current = false;
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
