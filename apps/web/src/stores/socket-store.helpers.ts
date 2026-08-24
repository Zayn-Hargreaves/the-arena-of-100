import {
  ClientEvent,
  ErrorCode,
  ServerEvent,
  type ErrorPayload,
  type CardEffectEvent,
} from "@arena/shared";
import type { Socket } from "socket.io-client";
import type { SocketState, CardState } from "./socket-store.types";

export const SOCKET_NOT_CONNECTED_MESSAGE = "Socket not connected";

export function requireSocket(socket: Socket | null): Socket {
  if (!socket?.connected) {
    throw new Error(SOCKET_NOT_CONNECTED_MESSAGE);
  }

  return socket;
}

export function getClearedTerminationState(
  state: Pick<SocketState, "roomTerminated" | "roomTerminationMessage">,
) {
  if (!state.roomTerminated && !state.roomTerminationMessage) {
    return null;
  }

  return {
    roomTerminated: false,
    roomTerminationMessage: null,
  };
}

export function applyClearedTerminationState(
  set: (partial: Partial<SocketState>) => void,
  get: () => SocketState,
) {
  const nextState = getClearedTerminationState(get());
  if (nextState) {
    set(nextState);
  }
}

export function emitIfConnected<TPayload>(
  socket: Socket | null,
  event: ClientEvent,
  payload: TPayload,
) {
  if (!socket?.connected) return;
  socket.emit(event, payload);
}

export function waitForSocketAck<TResult, TSuccess = unknown>(options: {
  socket: Socket;
  successEvent: ServerEvent;
  timeoutMs: number;
  timeoutMessage: string;
  mapSuccess: (data: TSuccess) => TResult;
  matchesSuccess?: (data: TSuccess) => boolean;
  shouldRejectOnError?: (data: ErrorPayload) => boolean;
  getErrorMessage?: (data: ErrorPayload) => string;
}) {
  const {
    socket,
    successEvent,
    timeoutMs,
    timeoutMessage,
    mapSuccess,
    matchesSuccess = () => true,
    shouldRejectOnError = () => true,
    getErrorMessage = (data) => data.message || timeoutMessage,
  } = options;

  return new Promise<TResult>((resolve, reject) => {
    const handleSuccess = (data: TSuccess) => {
      if (!matchesSuccess(data)) return;
      cleanup();
      resolve(mapSuccess(data));
    };

    const handleError = (data: ErrorPayload) => {
      if (!shouldRejectOnError(data)) return;
      cleanup();
      reject(new Error(getErrorMessage(data)));
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off(successEvent, handleSuccess);
      socket.off(ServerEvent.ERROR, handleError);
    };

    socket.on(successEvent, handleSuccess);
    socket.on(ServerEvent.ERROR, handleError);
  });
}

export function hasSecondChancePermission(
  cardState:
    | Pick<CardState, "activeRoundEffects" | "lastResolvedEffect">
    | null
    | undefined,
  userId: string | null | undefined,
  roundNo: number,
): boolean {
  if (!userId || !cardState) return false;

  const matchesPlayer = (e: CardEffectEvent) =>
    (e.playedByPlayerId === userId || e.targetPlayerIds?.includes(userId)) &&
    e.effect.kind === "SECOND_CHANCE" &&
    (e.targetRoundNo ?? e.roundNo) === roundNo;

  const hasInActive = Boolean(
    cardState.activeRoundEffects?.some(matchesPlayer),
  );
  const hasInLastResolved = Boolean(
    cardState.lastResolvedEffect && matchesPlayer(cardState.lastResolvedEffect),
  );

  return hasInActive || hasInLastResolved;
}

const IS_DEBUG = process.env.NODE_ENV !== "production";

export function debugLog(...args: unknown[]) {
  if (IS_DEBUG) {
    console.log(...args);
  }
}

export const AUTH_TIMEOUT_MS = 5000;

export function waitForAuthAck(socket: Socket): Promise<void> {
  return waitForSocketAck<void>({
    socket,
    successEvent: ServerEvent.AUTHENTICATED,
    timeoutMs: AUTH_TIMEOUT_MS,
    timeoutMessage: "Authentication timed out",
    mapSuccess: () => undefined,
    shouldRejectOnError: (data) =>
      data.code === ErrorCode.INVALID_TOKEN ||
      data.code === ErrorCode.UNAUTHORIZED,
    getErrorMessage: (data) => data.message || "Authentication timed out",
  });
}
