import { ClientEvent, ServerEvent, type ErrorPayload } from "@arena/shared";
import type { Socket } from "socket.io-client";
import type { SocketState } from "./socket-store.types";

export const SOCKET_NOT_CONNECTED_MESSAGE = "Socket not connected";

export function requireSocket(socket: Socket | null): Socket {
  if (!socket) {
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
  if (!socket || !socket.connected) return;
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
