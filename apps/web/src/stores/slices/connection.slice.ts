import type { StateCreator } from "zustand";
import { io, type Socket } from "socket.io-client";
import {
  ClientEvent,
  ServerEvent,
  ErrorCode,
  type AnswerResultPayload,
  type CardId,
  type CardResolvedBatchEvent,
  type ErrorPayload,
  type EventBatchPayload,
  type MatchFinishedPayload,
  type MatchmakingMatchedPayload,
  type MatchmakingStatusPayload,
  type PlayerEliminatedPayload,
  type RoomCountdownCancelledPayload,
  type RoomCountdownStartedPayload,
  type RoomCreatedPayload,
  type RoomJoinedPayload,
  type RoomPlayerJoinedPayload,
  type RoomPlayerLeftPayload,
  type RoomPresenceUpdatedPayload,
  type RoomStatusUpdatedPayload,
  type RoomTerminatedPayload,
  type RoundEndedPayload,
  type RoundStartedPayload,
  type SnapshotPayload,
  type TopicVotingFinishedPayload,
  type TopicVotingStartedPayload,
  type TopicVotingSummaryPayload,
} from "@arena/shared";
import { API_URL } from "@/lib/api";
import type { SocketState } from "../socket-store.types";
import { debugLog, waitForAuthAck } from "../socket-store.helpers";
import {
  applyAnswerResultState,
  applyAuthenticatedState,
  applyCardCommandErrorState,
  applyCardOfferState,
  applyCardPickedState,
  applyCardResolvedState,
  applyClassAssignedState,
  applyEventBatchState,
  applyMatchFinishedState,
  applyMatchmakingMatchedState,
  applyMatchmakingStatusState,
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
  applySubmitAnswerErrorState,
  applyTopicVoteErrorState,
  applyTopicVotingFinishedState,
  applyTopicVotingStartedState,
  applyTopicVotingSummaryState,
  applyUnauthorizedErrorState,
  removePendingTopicVoteCommand,
} from "../socket-store.updaters";
import {
  clearCardCommandState,
  clearTopicVoteState,
  consumedSecondChanceBySubmissionId,
  pendingCardCommands,
  resolvePendingCardCommand,
} from "../socket-store.state-maps";

export interface ConnectionSlice {
  socket: Socket | null;
  isConnected: boolean;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  error: string | null;

  connect: () => Promise<void>;
  disconnect: () => void;
}

export const createConnectionSlice: StateCreator<
  SocketState,
  [],
  [],
  ConnectionSlice
> = (set, get) => {
  let inFlightConnectPromise: Promise<void> | null = null;
  let connectGeneration = 0;

  return {
    socket: null,
    isConnected: false,
    heartbeatInterval: null,
    error: null,

    connect: () => {
      const state = get();
      if (state.socket?.connected && state.isAuthenticated) {
        return Promise.resolve();
      }
      if (inFlightConnectPromise) {
        return inFlightConnectPromise;
      }

      const generation = ++connectGeneration;

      inFlightConnectPromise = (async () => {
        try {
          if (state.heartbeatInterval) {
            clearInterval(state.heartbeatInterval);
          }
          if (state.socket) {
            state.socket.disconnect();
          }

          const newSocket = io(`${API_URL}/game`, {
            transports: ["websocket", "polling"],
            autoConnect: true,
          });

          set({ socket: newSocket });

          let pendingSnapshotRequest: {
            matchId: string;
            lastSeenSeqNo: number;
          } | null = null;

          let isInitialConnect = true;
          newSocket.on("connect", () => {
            if (get().socket !== newSocket) return;
            set({ isConnected: true, error: null });
            debugLog("🔌 Connected to game server");

            if (isInitialConnect) {
              isInitialConnect = false;
              return;
            }

            const stateToken = get().accessToken;
            if (stateToken) {
              newSocket.emit(ClientEvent.AUTHENTICATE, { token: stateToken });
            } else {
              get()
                .refreshAccessToken()
                .then((refreshedToken) => {
                  if (get().socket !== newSocket) return;
                  if (refreshedToken) {
                    newSocket.emit(ClientEvent.AUTHENTICATE, {
                      token: refreshedToken,
                    });
                  }
                });
            }
          });

          newSocket.on("disconnect", () => {
            if (get().socket !== newSocket) return;
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
            debugLog("🔌 Disconnected from game server");
          });

          newSocket.on(ServerEvent.AUTHENTICATED, (data) => {
            if (get().socket !== newSocket) return;
            set(applyAuthenticatedState(data));
            debugLog("✅ Authenticated");

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
            debugLog("🏠 Room created", { code: data.code });
          });

          newSocket.on(ServerEvent.ROOM_JOINED, (data: RoomJoinedPayload) => {
            if (get().socket !== newSocket) return;
            set(applyRoomJoinedState(data));
            debugLog("🏠 Room joined", {
              code: data.code,
              joinedAs: data.joinedAs,
            });
          });

          newSocket.on(
            ServerEvent.PLAYER_JOINED,
            (data: RoomPlayerJoinedPayload) => {
              if (get().socket !== newSocket) return;
              set((state) => applyPlayerJoinedState(state, data));
              debugLog("👤 Player joined");
            },
          );

          newSocket.on(
            ServerEvent.PLAYER_LEFT,
            (data: RoomPlayerLeftPayload) => {
              if (get().socket !== newSocket) return;
              set((state) => applyPlayerLeftState(state, data));
              debugLog("👤 Player left");
            },
          );

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
              debugLog("🗳️ Topic voting started", { matchId: data.matchId });
            },
          );

          newSocket.on(
            ServerEvent.TOPIC_VOTING_SUMMARY,
            (data: TopicVotingSummaryPayload) => {
              if (get().socket !== newSocket) return;
              set((state) => applyTopicVotingSummaryState(state, data));
              debugLog("🗳️ Topic voting summary", { matchId: data.matchId });
            },
          );

          newSocket.on(
            ServerEvent.TOPIC_VOTING_FINISHED,
            (data: TopicVotingFinishedPayload) => {
              if (get().socket !== newSocket) return;
              clearTopicVoteState(data.matchId);
              set((state) => applyTopicVotingFinishedState(state, data));
              debugLog("🗳️ Topic voting finished", { matchId: data.matchId });
            },
          );

          newSocket.on(
            ServerEvent.MATCHMAKING_STATUS,
            (data: MatchmakingStatusPayload) => {
              if (get().socket !== newSocket) return;
              set((state) => applyMatchmakingStatusState(state, data));
              debugLog("🎯 Matchmaking status");
            },
          );

          newSocket.on(
            ServerEvent.MATCHMAKING_MATCHED,
            (data: MatchmakingMatchedPayload) => {
              if (get().socket !== newSocket) return;
              set((state) => applyMatchmakingMatchedState(state, data));
              debugLog("🎉 Matchmaking matched", { roomCode: data.roomCode });
            },
          );

          newSocket.on(ServerEvent.MATCH_STARTING, (data) => {
            if (get().socket !== newSocket) return;
            clearCardCommandState();
            set((state) => applyMatchStartingState(state, data));
            debugLog("⚔️ Match starting", { matchId: data.matchId });
          });

          newSocket.on(ServerEvent.MATCH_STARTED, (data) => {
            if (get().socket !== newSocket) return;
            set((state) => applyMatchStartedState(state, data));
            debugLog("🚀 Match started", { matchId: data.matchId });
          });

          newSocket.on(
            ServerEvent.ROUND_STARTED,
            (data: RoundStartedPayload) => {
              if (get().socket !== newSocket) return;
              set((state) => applyRoundStartedState(state, data));
              debugLog("⏱️ Round started", {
                matchId: data.matchId,
                roundNo: data.roundNo,
              });
            },
          );

          newSocket.on(ServerEvent.ROUND_ENDED, (data: RoundEndedPayload) => {
            if (get().socket !== newSocket) return;
            const prev = get().lastAnswerResult;
            const priorForThisRound =
              prev?.matchId === data.matchId && prev?.roundNo === data.roundNo
                ? prev
                : null;

            set((state) =>
              applyRoundEndedState(state, data, priorForThisRound),
            );
            debugLog("🏁 Round ended", {
              matchId: data.matchId,
              roundNo: data.roundNo,
            });
          });

          newSocket.on(
            ServerEvent.PLAYER_ELIMINATED,
            (data: PlayerEliminatedPayload) => {
              if (get().socket !== newSocket) return;
              const currentState = get();
              const activeMatchId =
                currentState.room?.currentMatchId ??
                currentState.match?.id ??
                null;
              if (activeMatchId === null || activeMatchId !== data.matchId)
                return;
              if (data.playerId === currentState.userId) {
                set({ isEliminated: true, eliminationReason: data.reason });
              }
              set((state) => applyPlayerEliminatedState(state, data));
              debugLog("💀 Player eliminated", { matchId: data.matchId });
            },
          );

          newSocket.on(
            ServerEvent.MATCH_FINISHED,
            (data: MatchFinishedPayload) => {
              if (get().socket !== newSocket) return;
              set((state) => applyMatchFinishedState(state, data));
              debugLog("🏆 Match finished", { matchId: data.matchId });
            },
          );

          newSocket.on(ServerEvent.SNAPSHOT, (data: SnapshotPayload) => {
            if (get().socket !== newSocket) return;

            const pending = pendingSnapshotRequest;
            pendingSnapshotRequest = null;
            if (pending?.matchId === data.matchId) {
              set((state) => {
                const hydrated = applySnapshotState(state, data);
                return { ...hydrated, lastSeenSeqNo: state.lastSeenSeqNo };
              });
              get().requestSnapshot(
                pending.matchId,
                pending.lastSeenSeqNo,
                data,
              );
            } else {
              set((state) => applySnapshotState(state, data));
            }
            debugLog("📸 Snapshot received");
          });

          newSocket.on(ServerEvent.EVENT_BATCH, (data: EventBatchPayload) => {
            if (get().socket !== newSocket) return;
            set((state) => applyEventBatchState(state, data));
            debugLog(`🔁 Event batch received (${data.events.length} events)`);
          });

          newSocket.on(
            ServerEvent.ANSWER_RESULT,
            (data: AnswerResultPayload) => {
              if (get().socket !== newSocket) return;
              if (data.submissionId) {
                consumedSecondChanceBySubmissionId.delete(data.submissionId);
              }
              set((state) => applyAnswerResultState(state, data));
              debugLog("✅ Answer result", {
                matchId: data.matchId,
                roundNo: data.roundNo,
              });
            },
          );

          newSocket.on(ServerEvent.CLASS_ASSIGNED, (data) => {
            if (get().socket !== newSocket) return;
            set((state) => applyClassAssignedState(state, data));
            debugLog("🛡️ Class assigned", { matchId: data.matchId });
          });

          newSocket.on(ServerEvent.CARD_OFFER, (data) => {
            if (get().socket !== newSocket) return;
            set((state) => applyCardOfferState(state, data));
            debugLog("🃏 Card offer received", {
              matchId: data.matchId,
              roundNo: data.roundNo,
              offerSeqNo: data.offerSeqNo,
            });
          });

          newSocket.on(ServerEvent.CARD_PICKED, (data) => {
            if (get().socket !== newSocket) return;
            if (data.playerId === get().userId) {
              resolvePendingCardCommand(
                "PICK",
                data.matchId,
                data.selectedCardId as CardId,
                data.commandId,
              );
            }
            set((state) => applyCardPickedState(state, data));
            debugLog("🎴 Card picked", {
              matchId: data.matchId,
              cardId: data.selectedCardId,
            });
          });

          newSocket.on(ServerEvent.CARD_RESOLVED, (data) => {
            if (get().socket !== newSocket) return;
            if (data.playedByPlayerId === get().userId) {
              resolvePendingCardCommand(
                "PLAY",
                data.matchId,
                data.cardId as CardId,
                data.commandId,
              );
            }
            set((state) => applyCardResolvedState(state, data));
            debugLog("✨ Card resolved", {
              matchId: data.matchId,
              cardId: data.cardId,
            });
          });

          newSocket.on(
            ServerEvent.CARD_RESOLVED_BATCH,
            (data: CardResolvedBatchEvent) => {
              if (get().socket !== newSocket) return;
              if (data.effects && Array.isArray(data.effects)) {
                const currentUserId = get().userId;
                const activeMatchId =
                  get().room?.currentMatchId ?? get().match?.id;
                for (const effect of data.effects) {
                  if (
                    effect.playedByPlayerId === currentUserId &&
                    effect.matchId === activeMatchId
                  ) {
                    resolvePendingCardCommand(
                      "PLAY",
                      effect.matchId,
                      effect.cardId as CardId,
                      effect.commandId,
                    );
                  }
                }
                set((state) => {
                  let currentState = state;
                  for (const effect of data.effects) {
                    const partial = applyCardResolvedState(
                      currentState,
                      effect,
                    );
                    currentState = { ...currentState, ...partial };
                  }
                  return currentState;
                });
              }
              debugLog("✨ Card resolved batch", {
                matchId: data.matchId,
                count: data.effects?.length,
              });
            },
          );

          newSocket.on(
            ServerEvent.ROOM_TERMINATED,
            (data: RoomTerminatedPayload) => {
              if (get().socket !== newSocket) return;
              clearCardCommandState();
              set(applyRoomTerminatedState(data));
              console.warn("🛑 Room terminated by server:", data);
            },
          );

          newSocket.on(ServerEvent.ERROR, (data: ErrorPayload) => {
            if (get().socket !== newSocket) return;

            if (data.failedEvent === ClientEvent.SUBMIT_ANSWER) {
              const saved = data.submissionId
                ? consumedSecondChanceBySubmissionId.get(data.submissionId)
                : undefined;
              if (data.submissionId) {
                consumedSecondChanceBySubmissionId.delete(data.submissionId);
              }
              set((state) => applySubmitAnswerErrorState(state, data, saved));
            } else if (
              data.failedEvent === ClientEvent.CARD_PICK ||
              data.failedEvent === ClientEvent.CARD_PLAY
            ) {
              const pending = data.commandId
                ? pendingCardCommands.get(data.commandId)
                : undefined;
              if (data.commandId) {
                pendingCardCommands.delete(data.commandId);
              }
              set((state) => applyCardCommandErrorState(state, data, pending));
            } else if (data.failedEvent === ClientEvent.VOTE_BAN_TOPIC) {
              const { matchId, recomputedTopic } = data.commandId
                ? removePendingTopicVoteCommand(data.commandId)
                : { matchId: null, recomputedTopic: null };
              set((state) =>
                applyTopicVoteErrorState(state, matchId, recomputedTopic),
              );
            }
            if (
              data.code === ErrorCode.INVALID_TOKEN ||
              data.code === ErrorCode.UNAUTHORIZED
            ) {
              if (get().socket === newSocket) {
                const { heartbeatInterval: hb } = get();
                if (hb) clearInterval(hb);
                set((state) =>
                  applyUnauthorizedErrorState(data.message, state),
                );
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

          const authPromise = waitForAuthAck(newSocket);
          newSocket.emit(ClientEvent.AUTHENTICATE, { token: effectiveToken });
          try {
            await authPromise;
          } catch (error) {
            if (get().socket === newSocket) {
              set({
                socket: null,
                isConnected: false,
                isAuthenticated: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Authentication failed",
              });
            }
            newSocket.disconnect();
            throw error;
          }

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
        } finally {
          if (connectGeneration === generation) {
            inFlightConnectPromise = null;
          }
        }
      })();

      return inFlightConnectPromise;
    },

    disconnect: () => {
      connectGeneration++;
      inFlightConnectPromise = null;

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
          lastSeenSeqNo: 0,
        }));
      }
    },
  };
};
