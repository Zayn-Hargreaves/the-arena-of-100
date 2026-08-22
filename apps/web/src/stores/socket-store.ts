// ============================================================
// Socket Store - Zustand
// Real-time WebSocket Connection Management
// ============================================================

import { create } from "zustand";
import {
  ClientEvent,
  ServerEvent,
  type RoomCreatedPayload,
  type SnapshotPayload,
  type EventBatchPayload,
  type AnswerResultPayload,
  type ErrorPayload,
  type RoomJoinedPayload,
  type RoomPlayerJoinedPayload,
  type RoomPlayerLeftPayload,
  type RoomCountdownStartedPayload,
  type RoomCountdownCancelledPayload,
  type RoomPresenceUpdatedPayload,
  type RoomStatusUpdatedPayload,
  type RoomTerminatedPayload,
  type RoundStartedPayload,
  type RoundEndedPayload,
  type MatchFinishedPayload,
  type PlayerEliminatedPayload,
  type TopicVotingStartedPayload,
  type TopicVotingSummaryPayload,
  type TopicVotingFinishedPayload,
  type MatchmakingStatusPayload,
  type MatchmakingMatchedPayload,
  type CardResolvedBatchEvent,
  type CardId,
  ErrorCode,
} from "@arena/shared";
import { io } from "socket.io-client";
import { API_URL, apiFetch } from "@/lib/api";
import { parseErrorPayload } from "@/lib/api-client";
import { generateId } from "@/lib/id";
import {
  createInitialCardState,
  type AuthResponse,
  type CardOfferState,
  type SocketState,
} from "./socket-store.types";
import {
  applyClearedTerminationState,
  emitIfConnected,
  requireSocket,
  waitForSocketAck,
} from "./socket-store.helpers";

import {
  applyAnswerResultState,
  applyAuthenticatedState,
  applyMatchFinishedState,
  applyMatchStartedState,
  applyMatchStartingState,
  applyPlayerEliminatedState,
  applyPlayerJoinedState,
  applyPlayerLeftState,
  applyRoomCountdownCancelledState,
  applyRoomCountdownStartedState,
  applyRoomCreatedState,
  applyRoomJoinedState,
  applyRoomPresenceUpdatedState,
  applyRoomStatusUpdatedState,
  applyRoomTerminatedState,
  applyRoundEndedState,
  applyRoundStartedState,
  applySnapshotState,
  applyEventBatchState,
  applyUnauthorizedErrorState,
  applyTopicVotingStartedState,
  applyTopicVotingSummaryState,
  applyTopicVotingFinishedState,
  applyMatchmakingStatusState,
  applyMatchmakingMatchedState,
  applyClassAssignedState,
  applyCardOfferState,
  applyCardPickedState,
  applyCardResolvedState,
  applyConsumeSecondChance,
} from "./socket-store.updaters";

interface PendingTopicVoteCommand {
  commandId: string;
  matchId: string;
  topic: string;
}

type PendingCardCommand =
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

const pendingTopicVoteCommandsByMatch = new Map<
  string,
  PendingTopicVoteCommand[]
>();
const confirmedTopicVoteBaselineByMatch = new Map<string, string | null>();
const pendingCardCommands = new Map<string, PendingCardCommand>();

function clearTopicVoteState(matchId?: string) {
  if (matchId) {
    pendingTopicVoteCommandsByMatch.delete(matchId);
    confirmedTopicVoteBaselineByMatch.delete(matchId);
  } else {
    pendingTopicVoteCommandsByMatch.clear();
    confirmedTopicVoteBaselineByMatch.clear();
  }
}

function clearCardCommandState(matchId?: string) {
  if (matchId) {
    for (const [cmdId, cmd] of pendingCardCommands.entries()) {
      if (cmd.matchId === matchId) {
        pendingCardCommands.delete(cmdId);
      }
    }
  } else {
    pendingCardCommands.clear();
  }
}

function getEffectiveTopicVote(matchId: string): string | null {
  const pending = pendingTopicVoteCommandsByMatch.get(matchId);
  if (pending && pending.length > 0) {
    return pending[pending.length - 1].topic;
  }
  return confirmedTopicVoteBaselineByMatch.get(matchId) ?? null;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  // Initial state
  socket: null,
  isConnected: false,
  isAuthenticated: false,
  userId: null,
  username: null,
  accessToken: null,
  userRole: null,
  room: null,
  match: null,
  topicVoting: null,
  matchmaking: {
    isQueued: false,
    queuedAt: null,
    elapsedSeconds: 0,
    estimatedWaitSeconds: 0,
    playersInQueue: 0,
    matchedRoomCode: null,
    matchedRoomId: null,
    matchedMatchId: null,
  },
  cardState: createInitialCardState(),
  lastAnswerResult: null,
  pendingAnswer: null,

  remainingCount: null,
  lastSeenSeqNo: 0,
  error: null,
  heartbeatInterval: null,
  isEliminated: false,
  eliminationReason: null,
  roomTerminated: false,
  roomTerminationMessage: null,

  // Connect to WebSocket
  connect: async () => {
    const state = get();
    // Require both transport + auth so a connected-but-unauthenticated
    // socket does not short-circuit and leave callers without a ready session.
    if (state.socket?.connected && state.isAuthenticated) return;
    if (state.socket) {
      state.socket.disconnect();
    }

    const newSocket = io(`${API_URL}/game`, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    set({ socket: newSocket });

    // Plan D reconnect: capture match/lastSeenSeqNo across the
    // auth handshake, but defer the REQUEST_SNAPSHOT call until the
    // server-side `syncReconnection` has joined our channels and
    // emitted a SNAPSHOT. Firing it inside AUTHENTICATED raced
    // against that sync and produced UNAUTHORIZED errors.
    let pendingSnapshotRequest: {
      matchId: string;
      lastSeenSeqNo: number;
    } | null = null;

    // Resolve only when the socket is both connected AND the server has
    // acknowledged authentication, so callers' `await connect()` guarantees
    // a ready/authenticated socket before invoking createRoom/joinRoom.
    const AUTH_TIMEOUT_MS = 5000;
    const authPromise = waitForSocketAck<void>({
      socket: newSocket,
      successEvent: ServerEvent.AUTHENTICATED,
      timeoutMs: AUTH_TIMEOUT_MS,
      timeoutMessage: "Authentication timed out",
      mapSuccess: () => undefined,
      shouldRejectOnError: (data) =>
        data.code === ErrorCode.INVALID_TOKEN ||
        data.code === ErrorCode.UNAUTHORIZED,
      getErrorMessage: (data) => data.message,
    });

    newSocket.on("connect", () => {
      set({ isConnected: true, error: null });
      console.log("🔌 Connected to game server");

      const stateToken = get().accessToken;
      if (stateToken) {
        newSocket.emit(ClientEvent.AUTHENTICATE, { token: stateToken });
      }
    });

    newSocket.on("disconnect", () => {
      // Only reset state if this socket is still the active one.
      // A previous socket's delayed disconnect event must not
      // clobber the state of a newer connection.
      if (get().socket !== newSocket) return;
      // Clear heartbeat on unexpected socket disconnects (network drop, server
      // restart) so we never leave orphaned intervals running. A reconnection
      // (connect() called again) will create a fresh interval below.
      const { heartbeatInterval: hb } = get();
      if (hb) {
        clearInterval(hb);
      }
      set((state) => ({
        isConnected: false,
        isAuthenticated: false,
        pendingAnswer: null,
        heartbeatInterval: null,
        matchmaking: {
          ...state.matchmaking,
          isQueued: false,
          queuedAt: null,
          elapsedSeconds: 0,
          estimatedWaitSeconds: 0,
          playersInQueue: 0,
        },
      }));
      console.log("🔌 Disconnected from game server");
    });

    newSocket.on(ServerEvent.AUTHENTICATED, (data) => {
      if (get().socket !== newSocket) return;
      set(applyAuthenticatedState(data));
      console.log("✅ Authenticated:", data.username);

      // Plan D minimal reconnect: after socket re-auth (including auto
      // reconnect), remember that we want a cursor-aware snapshot when
      // we still hold match context. Server may also push a full
      // SNAPSHOT via syncReconnection; REQUEST_SNAPSHOT with
      // lastSeenSeqNo enables EVENT_BATCH delta when the store
      // survived the disconnect. We capture the intent here and fire
      // it from the SNAPSHOT handler — by then `syncReconnection` has
      // joined the room and reattached us, so the request won't be
      // rejected with UNAUTHORIZED.
      const { match, room, lastSeenSeqNo } = get();
      const matchId = match?.id ?? room?.currentMatchId;
      if (matchId) {
        pendingSnapshotRequest = { matchId, lastSeenSeqNo };
      } else {
        pendingSnapshotRequest = null;
      }
    });

    newSocket.on(ServerEvent.ROOM_CREATED, (data: RoomCreatedPayload) => {
      if (get().socket !== newSocket) return;
      set(applyRoomCreatedState(data));
      console.log("🏠 Room created:", data.code);
    });

    newSocket.on(ServerEvent.ROOM_JOINED, (data: RoomJoinedPayload) => {
      if (get().socket !== newSocket) return;
      set(applyRoomJoinedState(data));
      console.log("🏠 Room joined:", data.code, "as", data.joinedAs);
    });

    newSocket.on(ServerEvent.PLAYER_JOINED, (data: RoomPlayerJoinedPayload) => {
      if (get().socket !== newSocket) return;
      set((state) => applyPlayerJoinedState(state, data));
      console.log("👤 Player joined:", data);
    });

    newSocket.on(ServerEvent.PLAYER_LEFT, (data: RoomPlayerLeftPayload) => {
      if (get().socket !== newSocket) return;
      set((state) => applyPlayerLeftState(state, data));
      console.log("👤 Player left:", data);
    });

    newSocket.on(
      ServerEvent.ROOM_STATUS_UPDATED,
      (data: RoomStatusUpdatedPayload) => {
        if (get().socket !== newSocket) return;
        set((state) => applyRoomStatusUpdatedState(state, data));
      },
    );

    newSocket.on(
      ServerEvent.ROOM_COUNTDOWN_STARTED,
      (data: RoomCountdownStartedPayload) => {
        if (get().socket !== newSocket) return;
        set((state) => applyRoomCountdownStartedState(state, data));
      },
    );

    newSocket.on(
      ServerEvent.ROOM_COUNTDOWN_CANCELLED,
      (data: RoomCountdownCancelledPayload) => {
        if (get().socket !== newSocket) return;
        set((state) => applyRoomCountdownCancelledState(state, data));
      },
    );

    newSocket.on(
      ServerEvent.ROOM_PRESENCE_UPDATED,
      (data: RoomPresenceUpdatedPayload) => {
        if (get().socket !== newSocket) return;
        set((state) => applyRoomPresenceUpdatedState(state, data));
      },
    );

    newSocket.on(
      ServerEvent.TOPIC_VOTING_STARTED,
      (data: TopicVotingStartedPayload) => {
        if (get().socket !== newSocket) return;
        clearTopicVoteState(data.matchId);
        set((state) => applyTopicVotingStartedState(state, data));
        console.log("🗳️ Topic voting started:", data);
      },
    );

    newSocket.on(
      ServerEvent.TOPIC_VOTING_SUMMARY,
      (data: TopicVotingSummaryPayload) => {
        if (get().socket !== newSocket) return;
        set((state) => applyTopicVotingSummaryState(state, data));
        console.log("🗳️ Topic voting summary:", data);
      },
    );

    newSocket.on(
      ServerEvent.TOPIC_VOTING_FINISHED,
      (data: TopicVotingFinishedPayload) => {
        if (get().socket !== newSocket) return;
        clearTopicVoteState(data.matchId);
        set((state) => applyTopicVotingFinishedState(state, data));
        console.log("🗳️ Topic voting finished:", data);
      },
    );

    newSocket.on(
      ServerEvent.MATCHMAKING_STATUS,
      (data: MatchmakingStatusPayload) => {
        if (get().socket !== newSocket) return;
        set((state) => applyMatchmakingStatusState(state, data));
        console.log("🎯 Matchmaking status:", data);
      },
    );

    newSocket.on(
      ServerEvent.MATCHMAKING_MATCHED,
      (data: MatchmakingMatchedPayload) => {
        if (get().socket !== newSocket) return;
        set((state) => applyMatchmakingMatchedState(state, data));
        console.log("🎉 Matchmaking matched:", data);
      },
    );

    newSocket.on(ServerEvent.MATCH_STARTING, (data) => {
      if (get().socket !== newSocket) return;
      clearCardCommandState();
      set((state) => applyMatchStartingState(state, data));
      console.log("⚔️ Match starting:", data);
    });

    newSocket.on(ServerEvent.MATCH_STARTED, (data) => {
      if (get().socket !== newSocket) return;
      set((state) => applyMatchStartedState(state, data));
      console.log("🚀 Match started:", data);
    });

    newSocket.on(ServerEvent.ROUND_STARTED, (data: RoundStartedPayload) => {
      if (get().socket !== newSocket) return;
      set((state) => applyRoundStartedState(state, data));
      console.log("⏱️ Round started:", data);
    });

    newSocket.on(ServerEvent.ROUND_ENDED, (data: RoundEndedPayload) => {
      if (get().socket !== newSocket) return;
      const prev = get().lastAnswerResult;
      const priorForThisRound =
        prev?.matchId === data.matchId && prev?.roundNo === data.roundNo
          ? prev
          : null;

      // F1 fix: cross-check the server's `eliminatedPlayerIds` array
      // and stamp `status = "ELIMINATED"` on each player in
      // `match.players`. The previous sidebar rendered a hardcoded
      // list of mock opponents (`Zero_Cool`, `Acid_Burn`, …) that
      // was a flat-out deception to the user. Now the sidebar reads
      // from `match.players` and reflects actual server-side
      // elimination state. We use an immutable map update so React
      // re-renders on player status changes.
      set((state) => applyRoundEndedState(state, data, priorForThisRound));
      console.log("🏁 Round ended:", data);
    });

    newSocket.on(
      ServerEvent.PLAYER_ELIMINATED,
      (data: PlayerEliminatedPayload) => {
        if (get().socket !== newSocket) return;
        const currentState = get();
        // Guard: ignore stale PLAYER_ELIMINATED events from a previous
        // match after reconnect or room switch. The active match id is
        // room.currentMatchId (authoritative after MATCH_STARTING)
        // falling back to match.id; when neither matches the event's
        // matchId, the event is stale and must not mark the local user
        // as eliminated or mutate the current match roster.
        const activeMatchId =
          currentState.room?.currentMatchId ?? currentState.match?.id ?? null;
        if (activeMatchId === null || activeMatchId !== data.matchId) return;
        if (data.playerId === currentState.userId) {
          // Stamp the reason (WRONG_ANSWER / TIMEOUT) alongside the flag
          // so the eliminated overlay can explain *why* without waiting
          // for any further event.
          set({ isEliminated: true, eliminationReason: data.reason });
        }
        // F1 fix: stamp `status = "ELIMINATED"` on the affected
        // player in `match.players` so the sidebar / opponents
        // list can render the correct badge without waiting for
        // the ROUND_ENDED broadcast (which carries the full
        // `eliminatedPlayerIds` array). This is a real-time
        // mirror of the per-player event.
        set((state) => applyPlayerEliminatedState(state, data));
        console.log("💀 Player eliminated:", data);
      },
    );

    newSocket.on(ServerEvent.MATCH_FINISHED, (data: MatchFinishedPayload) => {
      if (get().socket !== newSocket) return;
      set((state) => applyMatchFinishedState(state, data));
      console.log("🏆 Match finished:", data);
    });

    newSocket.on(ServerEvent.SNAPSHOT, (data: SnapshotPayload) => {
      if (get().socket !== newSocket) return;

      // Plan D reconnect: if AUTHENTICATED armed a cursor-aware
      // request and the server-pushed SNAPSHOT belongs to the same
      // match, optimistically hydrate display fields for UI freshness
      // but keep the pre-disconnect lastSeenSeqNo so the deferred
      // REQUEST_SNAPSHOT can still delta-replay. Always clear pending
      // outside the matchId guard so a mismatched/stale arm cannot
      // stick around. This is also the point where server-side
      // `syncReconnection` has finished joining channels, so the
      // request is safe.
      const pending = pendingSnapshotRequest;
      pendingSnapshotRequest = null;
      if (pending?.matchId === data.matchId) {
        set((state) => {
          const hydrated = applySnapshotState(state, data);
          return { ...hydrated, lastSeenSeqNo: state.lastSeenSeqNo };
        });
        get().requestSnapshot(pending.matchId, pending.lastSeenSeqNo, data);
      } else {
        set((state) => applySnapshotState(state, data));
      }
      console.log("📸 Snapshot received");
    });

    // Plan D delta replay: the server may answer REQUEST_SNAPSHOT with a
    // delta of only the events after our cursor. Apply them onto the
    // current match (idempotent) instead of re-hydrating the whole roster.
    newSocket.on(ServerEvent.EVENT_BATCH, (data: EventBatchPayload) => {
      if (get().socket !== newSocket) return;
      set((state) => applyEventBatchState(state, data));
      console.log(`🔁 Event batch received (${data.events.length} events)`);
    });

    newSocket.on(ServerEvent.ANSWER_RESULT, (data: AnswerResultPayload) => {
      if (get().socket !== newSocket) return;
      set((state) => applyAnswerResultState(state, data));
      console.log("✅ Answer result:", data);
    });

    // Phase 2: Class & Card Event Listeners
    newSocket.on(ServerEvent.CLASS_ASSIGNED, (data) => {
      if (get().socket !== newSocket) return;
      set((state) => applyClassAssignedState(state, data));
      console.log("🛡️ Class assigned:", data);
    });

    newSocket.on(ServerEvent.CARD_OFFER, (data) => {
      if (get().socket !== newSocket) return;
      set((state) => applyCardOfferState(state, data));
      console.log("🃏 Card offer received:", data);
    });

    newSocket.on(ServerEvent.CARD_PICKED, (data) => {
      if (get().socket !== newSocket) return;
      if (data.playerId === get().userId) {
        if (data.commandId && pendingCardCommands.has(data.commandId)) {
          pendingCardCommands.delete(data.commandId);
        } else {
          for (const [cmdId, cmd] of pendingCardCommands.entries()) {
            if (
              cmd.type === "PICK" &&
              cmd.matchId === data.matchId &&
              cmd.cardId === data.selectedCardId
            ) {
              pendingCardCommands.delete(cmdId);
              break;
            }
          }
        }
      }
      set((state) => applyCardPickedState(state, data));
      console.log("🎴 Card picked:", data);
    });

    newSocket.on(ServerEvent.CARD_RESOLVED, (data) => {
      if (get().socket !== newSocket) return;
      if (data.playedByPlayerId === get().userId) {
        if (data.commandId && pendingCardCommands.has(data.commandId)) {
          pendingCardCommands.delete(data.commandId);
        } else {
          for (const [cmdId, cmd] of pendingCardCommands.entries()) {
            if (
              cmd.type === "PLAY" &&
              cmd.matchId === data.matchId &&
              cmd.cardId === data.cardId
            ) {
              pendingCardCommands.delete(cmdId);
              break;
            }
          }
        }
      }
      set((state) => applyCardResolvedState(state, data));
      console.log("✨ Card resolved:", data);
    });

    newSocket.on(
      ServerEvent.CARD_RESOLVED_BATCH,
      (data: CardResolvedBatchEvent) => {
        if (get().socket !== newSocket) return;
        if (data.effects && Array.isArray(data.effects)) {
          const currentUserId = get().userId;
          for (const effect of data.effects) {
            if (effect.playedByPlayerId === currentUserId) {
              if (
                effect.commandId &&
                pendingCardCommands.has(effect.commandId)
              ) {
                pendingCardCommands.delete(effect.commandId);
              } else {
                for (const [cmdId, cmd] of pendingCardCommands.entries()) {
                  if (
                    cmd.type === "PLAY" &&
                    cmd.matchId === effect.matchId &&
                    cmd.cardId === effect.cardId
                  ) {
                    pendingCardCommands.delete(cmdId);
                    break;
                  }
                }
              }
            }
          }
          set((state) => {
            let currentState = state;
            for (const effect of data.effects) {
              const partial = applyCardResolvedState(currentState, effect);
              currentState = { ...currentState, ...partial };
            }
            return currentState;
          });
        }
        console.log("✨ Card resolved batch:", data);
      },
    );

    // Admin kill-switch: server has force-terminated this room (and any
    // active match in it). Clear local room/match state and surface a
    // termination flag so the lobby page can redirect + toast. We do NOT
    // auto-redirect here — page-level navigation needs the i18n router.
    // `isEliminated` is also reset: a previous match's elimination state
    // must not leak into the next room after a forced restart, otherwise
    // the spectator/ELIMINATED UI would persist on reconnect/join.
    newSocket.on(ServerEvent.ROOM_TERMINATED, (data: RoomTerminatedPayload) => {
      if (get().socket !== newSocket) return;
      clearCardCommandState();
      set(applyRoomTerminatedState(data));
      console.warn("🛑 Room terminated by server:", data);
    });

    newSocket.on(ServerEvent.ERROR, (data: ErrorPayload) => {
      if (get().socket !== newSocket) return;
      const { pendingAnswer, topicVoting } = get();
      const { submissionId } = data;
      if (
        pendingAnswer &&
        data.failedEvent === ClientEvent.SUBMIT_ANSWER &&
        submissionId === pendingAnswer.submissionId
      ) {
        set({ pendingAnswer: null });
      }
      if (
        (data.failedEvent === ClientEvent.CARD_PICK ||
          data.failedEvent === ClientEvent.CARD_PLAY) &&
        data.commandId
      ) {
        const pending = pendingCardCommands.get(data.commandId);
        if (pending) {
          pendingCardCommands.delete(data.commandId);
          const currentMatchId = get().room?.currentMatchId ?? get().match?.id;
          if (currentMatchId === pending.matchId) {
            if (pending.type === "PICK") {
              set((state) => {
                const nextOfferSeqNo = {
                  ...(state.cardState.offerSeqNoByCardId ?? {}),
                };
                delete nextOfferSeqNo[pending.cardId];
                return {
                  cardState: {
                    ...state.cardState,
                    hand: pending.addedToHand
                      ? state.cardState.hand.filter(
                          (id) => id !== pending.cardId,
                        )
                      : state.cardState.hand,
                    offerSeqNoByCardId: nextOfferSeqNo,
                    currentOffer:
                      state.cardState.currentOffer ??
                      (pending.previousOffer?.matchId === currentMatchId
                        ? pending.previousOffer
                        : null),
                  },
                };
              });
            } else if (pending.type === "PLAY") {
              set((state) => ({
                cardState: {
                  ...state.cardState,
                  playedCardIds: pending.addedToPlayed
                    ? state.cardState.playedCardIds.filter(
                        (id) => id !== pending.cardId,
                      )
                    : state.cardState.playedCardIds,
                },
              }));
            }
          }
        }
      }
      if (data.failedEvent === ClientEvent.VOTE_BAN_TOPIC && data.commandId) {
        let failedCmd: PendingTopicVoteCommand | null = null;

        for (const [
          matchId,
          cmds,
        ] of pendingTopicVoteCommandsByMatch.entries()) {
          const cmdIndex = cmds.findIndex(
            (c) => c.commandId === data.commandId,
          );
          if (cmdIndex !== -1) {
            [failedCmd] = cmds.splice(cmdIndex, 1);
            if (cmds.length === 0) {
              pendingTopicVoteCommandsByMatch.delete(matchId);
            }
            break;
          }
        }

        if (failedCmd) {
          const matchPending =
            pendingTopicVoteCommandsByMatch.get(failedCmd.matchId) ?? [];
          const hasRemainingMatchCmds = matchPending.length > 0;
          const recomputedTopic = getEffectiveTopicVote(failedCmd.matchId);

          if (!hasRemainingMatchCmds) {
            confirmedTopicVoteBaselineByMatch.delete(failedCmd.matchId);
          }

          if (topicVoting && topicVoting.matchId === failedCmd.matchId) {
            set({
              topicVoting: {
                ...topicVoting,
                myVotedTopic: recomputedTopic,
              },
            });
          }
        }
      }
      // If unauthorized or invalid token, clear local auth state and
      // null the socket so the next connect() can reinitialize
      // (otherwise the connect guard would short-circuit on
      // socket.connected and skip re-auth). Also disconnect the socket
      // so dangling listeners and duplicate reconnects don't linger.
      // Only reset state if this socket is still the active one — a
      // stale socket's ERROR must not clobber a newer connection.
      // The error message is merged into the SAME set call so the
      // message survives the socket reset (a follow-up `set({ error })`
      // would never run because socket is now null).
      if (
        data.code === ErrorCode.INVALID_TOKEN ||
        data.code === ErrorCode.UNAUTHORIZED
      ) {
        if (get().socket === newSocket) {
          const { heartbeatInterval: hb } = get();
          if (hb) clearInterval(hb);
          set((state) => applyUnauthorizedErrorState(data.message, state));
        }
        newSocket.disconnect();
      }
      console.error("❌ Error:", data.message);
    });

    const stateToken = get().accessToken;
    let effectiveToken = stateToken;
    if (!effectiveToken) {
      try {
        effectiveToken = await get().refreshAccessToken();
      } catch {
        effectiveToken = null;
      }
    }

    if (!effectiveToken) {
      newSocket.disconnect();
      if (get().socket === newSocket) {
        set({
          socket: null,
          isConnected: false,
          isAuthenticated: false,
          error: "Authentication required",
        });
      }
      throw new Error("Authentication required");
    }

    newSocket.emit(ClientEvent.AUTHENTICATE, { token: effectiveToken });
    try {
      await authPromise;
    } catch (error) {
      // Authentication failed or timed out — tear down the socket so
      // we don't leave dangling listeners or buffered events that
      // would fire on an automatic reconnect.
      newSocket.disconnect();
      throw error;
    }

    // Start heartbeat interval (every 25 seconds)
    const currentState = get();
    if (currentState.socket !== newSocket) {
      newSocket.disconnect();
      return;
    }
    if (currentState.heartbeatInterval) {
      clearInterval(currentState.heartbeatInterval);
    }
    const interval = setInterval(() => {
      const state = get();
      if (state.socket?.connected && state.room?.id) {
        state.socket.emit(ClientEvent.HEARTBEAT, {
          roomId: state.room.id,
          sentAt: Date.now(),
        });
      }
    }, 25000);

    if (get().socket !== newSocket) {
      clearInterval(interval);
      newSocket.disconnect();
      return;
    }

    set({ heartbeatInterval: interval });
  },

  // Disconnect
  disconnect: () => {
    const { socket, heartbeatInterval } = get();
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    if (socket) {
      clearTopicVoteState();
      clearCardCommandState();
      socket.disconnect();
      set((state) => ({
        socket: null,
        isConnected: false,
        isAuthenticated: false,
        userId: null,
        username: null,
        accessToken: null,
        userRole: null,
        room: null,
        match: null,
        topicVoting: null,
        remainingCount: null,
        lastAnswerResult: null,
        pendingAnswer: null,
        heartbeatInterval: null,
        roomTerminated: false,
        roomTerminationMessage: null,
        matchmaking: {
          isQueued: false,
          queuedAt: null,
          elapsedSeconds: 0,
          estimatedWaitSeconds: 0,
          playersInQueue: 0,
          matchedRoomCode: state.matchmaking.matchedRoomCode,
          matchedRoomId: state.matchmaking.matchedRoomId,
          matchedMatchId: state.matchmaking.matchedMatchId,
        },
        // Plan D — reset the delta cursor alongside match/room so a
        // stale seqNo from the previous session cannot qualify for
        // delta delivery on the next reconnect. The next
        // REQUEST_SNAPSHOT will be a full SNAPSHOT, then delta kicks
        // in from there.
        lastSeenSeqNo: 0,
      }));
    }
  },

  refreshAccessToken: async () => {
    try {
      const response = await apiFetch("/api/v1/auth/refresh", {
        method: "POST",
      });

      if (!response.ok) {
        set({
          accessToken: null,
          isAuthenticated: false,
          userId: null,
          username: null,
          userRole: null,
        });
        return null;
      }

      const raw = (await response.json()) as {
        data?: AuthResponse;
      } & AuthResponse;
      const data = raw.data || raw;

      if (!data.user) {
        throw new Error("Invalid authentication response");
      }

      set({
        accessToken: data.accessToken,
        userId: data.user.id,
        username: data.user.username,
        userRole: data.user.role,
      });

      return data.accessToken;
    } catch {
      set({
        accessToken: null,
        isAuthenticated: false,
        userId: null,
        username: null,
        userRole: null,
      });
      return null;
    }
  },

  // Authenticate
  authenticate: async (nickname: string): Promise<void> => {
    const socket = requireSocket(get().socket);

    const AUTH_TIMEOUT_MS = 5000;

    let guestSecret: string | null = null;
    let storedAvatar: string | null = null;
    if (typeof window !== "undefined") {
      try {
        guestSecret = localStorage.getItem(`guestSecret:${nickname.trim()}`);
        storedAvatar = localStorage.getItem("avatarSeed");
      } catch {
        // ignore storage error
      }
    }

    let token: string;
    try {
      const response = await apiFetch("/api/v1/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: nickname,
          guestSecret: guestSecret || undefined,
          avatar: storedAvatar || undefined,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Authentication failed";
        try {
          const errorData = await response.json();
          const parsed = parseErrorPayload(errorData);
          if (parsed) {
            errorMessage = parsed;
          }
        } catch {
          // Ignore JSON parse failure
        }
        throw new Error(errorMessage);
      }

      const raw = (await response.json()) as {
        data?: AuthResponse;
      } & AuthResponse;
      const data = raw.data || raw;

      if (!data.user) {
        throw new Error("Invalid authentication response");
      }

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("userId", data.user.id);
          localStorage.setItem("callsign", data.user.username);
          if (data.guestSecret) {
            localStorage.setItem(
              `guestSecret:${data.user.username}`,
              data.guestSecret,
            );
          }
        } catch {
          // ignore storage error
        }
      }

      set({
        accessToken: data.accessToken,
        userId: data.user.id,
        username: data.user.username,
        userRole: data.user.role,
      });
      token = data.accessToken;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to authenticate";
      set({ error: message });
      console.error("❌ Authentication error:", err);
      throw err instanceof Error ? err : new Error(message);
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off(ServerEvent.AUTHENTICATED, onAuthenticated);
        socket.off(ServerEvent.ERROR, onAuthError);
      };

      const onAuthenticated = () => {
        cleanup();
        resolve();
      };

      const onAuthError = (data: ErrorPayload) => {
        if (
          data.code === ErrorCode.INVALID_TOKEN ||
          data.code === ErrorCode.UNAUTHORIZED
        ) {
          cleanup();
          reject(new Error(data.message));
        }
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Authentication timed out"));
      }, AUTH_TIMEOUT_MS);

      socket.on(ServerEvent.AUTHENTICATED, onAuthenticated);
      socket.on(ServerEvent.ERROR, onAuthError);

      emitIfConnected(socket, ClientEvent.AUTHENTICATE, {
        token,
      });
    });
  },

  // Create Room
  createRoom: async (config) => {
    const socket = requireSocket(get().socket);

    const ack = waitForSocketAck<string, { roomId: string; code: string }>({
      socket,
      successEvent: ServerEvent.ROOM_CREATED,
      timeoutMs: 8000,
      timeoutMessage: "Create room timed out",
      mapSuccess: (data) => {
        applyClearedTerminationState(set, get);
        return data.code;
      },
      getErrorMessage: (data) => data.message || "Failed to create room",
    });

    emitIfConnected(socket, ClientEvent.CREATE_ROOM, {
      roomType: config.roomType,
      maxPlayers: config.maxPlayers,
      timeLimit: config.timeLimit,
      category: config.category,
    });

    return ack;
  },

  // Join Room
  joinRoom: async (roomCode: string) => {
    const socket = requireSocket(get().socket);

    const ack = waitForSocketAck<void, RoomJoinedPayload>({
      socket,
      successEvent: ServerEvent.ROOM_JOINED,
      timeoutMs: 8000,
      timeoutMessage: "Join room timed out",
      matchesSuccess: (data) => data.code === roomCode,
      mapSuccess: () => {
        applyClearedTerminationState(set, get);
      },
      getErrorMessage: (data) => data.message || "Failed to join room",
    });

    emitIfConnected(socket, ClientEvent.JOIN_ROOM, { roomCode });
    return ack;
  },

  // Leave Room
  leaveRoom: (roomId: string) => {
    const { socket } = get();
    clearCardCommandState();
    emitIfConnected(socket, ClientEvent.LEAVE_ROOM, { roomId });
    set({
      room: null,
      match: null,
      cardState: createInitialCardState(),
      topicVoting: null,
      lastAnswerResult: null,
      pendingAnswer: null,
      remainingCount: null,
      isEliminated: false,
      eliminationReason: null,
    });
  },

  // Start Match
  startMatch: (roomId: string) => {
    const { socket } = get();
    emitIfConnected(socket, ClientEvent.START_MATCH, { roomId });
  },

  joinMatchmaking: (category?: string) => {
    const socket = get().socket;
    if (!socket?.connected) {
      set({ error: "Socket is not connected" });
      return;
    }
    clearCardCommandState();
    set({
      room: null,
      match: null,
      cardState: createInitialCardState(),
      topicVoting: null,
      lastAnswerResult: null,
      pendingAnswer: null,
      remainingCount: null,
      isEliminated: false,
      eliminationReason: null,
    });
    emitIfConnected(socket, ClientEvent.JOIN_MATCHMAKING, {
      category: category && category !== "ALL" ? category : undefined,
    });
  },

  leaveMatchmaking: () => {
    const socket = get().socket;
    if (socket?.connected) {
      emitIfConnected(socket, ClientEvent.LEAVE_MATCHMAKING, {});
    }
    set((state) => ({
      cardState: createInitialCardState(),
      matchmaking: {
        ...state.matchmaking,
        isQueued: false,
        queuedAt: null,
        elapsedSeconds: 0,
        estimatedWaitSeconds: 0,
        playersInQueue: 0,
        matchedRoomCode: null,
        matchedRoomId: null,
        matchedMatchId: null,
      },
    }));
  },

  clearMatchmakingMatched: () => {
    set((state) => ({
      matchmaking: {
        ...state.matchmaking,
        matchedRoomCode: null,
        matchedRoomId: null,
        matchedMatchId: null,
      },
    }));
  },

  // Vote Ban Topic

  voteBanTopic: (matchId: string, topic: string) => {
    const { socket, topicVoting } = get();
    if (!socket?.connected) return;

    const commandId = generateId();

    if (topicVoting && topicVoting.matchId === matchId) {
      const matchCmds = pendingTopicVoteCommandsByMatch.get(matchId) ?? [];

      if (
        !confirmedTopicVoteBaselineByMatch.has(matchId) ||
        matchCmds.length === 0
      ) {
        confirmedTopicVoteBaselineByMatch.set(
          matchId,
          topicVoting.myVotedTopic,
        );
      }

      const newCmd: PendingTopicVoteCommand = {
        commandId,
        matchId,
        topic,
      };
      matchCmds.push(newCmd);
      pendingTopicVoteCommandsByMatch.set(matchId, matchCmds);

      const effectiveTopic = getEffectiveTopicVote(matchId);

      set({
        topicVoting: {
          ...topicVoting,
          myVotedTopic: effectiveTopic,
        },
      });
    }

    emitIfConnected(socket, ClientEvent.VOTE_BAN_TOPIC, {
      matchId,
      topic,
      commandId,
    });
  },

  // Phase 2: Card Actions
  pickCard: (cardId, offerSeqNo) => {
    const socket = get().socket;
    const matchId = get().room?.currentMatchId ?? get().match?.id;
    if (!socket || !matchId) return;

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
    set((state) => ({
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
    }));

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
    if (!socket || !matchId) return;

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
    set((state) => ({
      cardState: {
        ...state.cardState,
        playedCardIds: state.cardState.playedCardIds.includes(cardId)
          ? state.cardState.playedCardIds
          : [...state.cardState.playedCardIds, cardId],
      },
    }));

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

  // Submit Answer

  submitAnswer: (matchId: string, roundNo: number, answer: string) => {
    const { socket, pendingAnswer, cardState, userId } = get();
    if (!socket?.connected) return null;

    const hasExistingSubmission =
      pendingAnswer?.matchId === matchId && pendingAnswer.roundNo === roundNo;

    const currentUserId = userId;
    const hasSecondChancePermission =
      Boolean(currentUserId) &&
      Boolean(
        currentUserId &&
        (cardState.activeRoundEffects?.some(
          (e) =>
            (e.playedByPlayerId === currentUserId ||
              e.targetPlayerIds?.includes(currentUserId)) &&
            e.effect.kind === "SECOND_CHANCE",
        ) ||
          ((cardState.lastResolvedEffect?.playedByPlayerId === currentUserId ||
            cardState.lastResolvedEffect?.targetPlayerIds?.includes(
              currentUserId,
            )) &&
            cardState.lastResolvedEffect?.effect.kind === "SECOND_CHANCE" &&
            (cardState.lastResolvedEffect.targetRoundNo ??
              cardState.lastResolvedEffect.roundNo) === roundNo)),
      );

    if (hasExistingSubmission && !hasSecondChancePermission) {
      return null;
    }

    const submissionId = generateId();
    set({ pendingAnswer: { matchId, roundNo, answer, submissionId } });

    emitIfConnected(socket, ClientEvent.SUBMIT_ANSWER, {
      matchId,
      roundNo,
      answer,
      submissionId,
      clientTimestamp: Date.now(),
    });
    return submissionId;
  },

  // Request Snapshot
  requestSnapshot: (
    matchId: string,
    lastSeenSeqNo: number,
    fallbackSnapshot?: SnapshotPayload,
  ) => {
    const socket = get().socket;
    if (!socket) return;

    emitIfConnected(socket, ClientEvent.REQUEST_SNAPSHOT, {
      matchId,
      lastSeenSeqNo,
    });

    if (!fallbackSnapshot) return;

    const TIMEOUT_MS = 5000;
    let resolved = false;

    const cleanup = () => {
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      socket.off(ServerEvent.EVENT_BATCH, handleMatchEvent);
      socket.off(ServerEvent.SNAPSHOT, handleMatchEvent);
      socket.off(ServerEvent.ERROR, handleError);
      socket.off("disconnect", handleDisconnect);
    };

    const applyFallback = () => {
      if (resolved) return;
      cleanup();

      // Ignore fallback from a previous socket generation after reconnect churn.
      if (get().socket !== socket) return;

      const currentMatch = get().match;
      if (currentMatch?.id === matchId) {
        set((state) => applySnapshotState(state, fallbackSnapshot));
        console.warn(
          `⚠️ Delta request failed or timed out. Hydrated fallback snapshot for match: ${matchId}`,
        );
      }
    };

    const handleMatchEvent = (data: { matchId: string }) => {
      if (get().socket !== socket) return;
      if (data.matchId === matchId) {
        cleanup();
      }
    };

    const handleError = (data: ErrorPayload) => {
      if (get().socket !== socket) return;
      // Only fall back on errors tied to this snapshot request.
      // Unrelated ERRORs (e.g. SUBMIT_ANSWER) must not clobber match state.
      if (data.failedEvent === ClientEvent.REQUEST_SNAPSHOT) {
        applyFallback();
      }
    };

    const handleDisconnect = () => {
      if (get().socket !== socket) {
        cleanup();
        return;
      }
      applyFallback();
    };

    socket.on(ServerEvent.EVENT_BATCH, handleMatchEvent);
    socket.on(ServerEvent.SNAPSHOT, handleMatchEvent);
    socket.on(ServerEvent.ERROR, handleError);
    socket.on("disconnect", handleDisconnect);

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        console.log(
          `⏱️ Delta request for match ${matchId} timed out after ${TIMEOUT_MS}ms.`,
        );
        applyFallback();
      }
    }, TIMEOUT_MS);
  },
}));
