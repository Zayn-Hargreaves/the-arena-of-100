// ============================================================
// WebSocket Exception Filter
// ============================================================
//
// Companion to HttpExceptionFilter for Socket.io contexts. The
// WsValidationPipe throws WsValidationError (a RoomError) during
// NestJS parameter resolution, BEFORE the @SubscribeMessage
// handler body runs. That means the per-handler
// `try { … } catch (RoomError) { emitError(…) }` blocks never
// see validation failures, and the only registered global filter
// was the HTTP one — which would call `host.switchToHttp()` on a
// WS context and TypeError on `response.status().send()`.
//
// This filter:
//   1. Early-returns on non-WS contexts (so HTTP requests are
//      still handled by HttpExceptionFilter).
//   2. Maps WsValidationError → ServerEvent.ERROR INVALID_PAYLOAD
//      with the Zod-formatted message (same contract the handler
//      try/catch used to enforce; now enforced at the boundary).
//   3. Maps other RoomError instances → their own code (e.g.
//      UNAUTHORIZED leaking out of a synchronous auth check).
//   4. Maps anything else → INTERNAL_ERROR, logging the full
//      stack for operators and emitting a generic message so
//      server details don't leak to the client.
// ============================================================

import { ArgumentsHost, Catch, ExceptionFilter, Logger } from "@nestjs/common";
import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, RoomError } from "@arena/shared";
import { WsValidationError } from "../pipes/ws-validation.pipe";

@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Defer to HttpExceptionFilter for HTTP / RPC contexts. This
    // filter only owns WebSocket delivery.
    if (host.getType() !== "ws") {
      return;
    }

    const client = host.switchToWs().getClient<Socket>();

    if (exception instanceof WsValidationError) {
      client.emit(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_PAYLOAD,
        message: exception.message,
      });
      return;
    }

    if (exception instanceof RoomError) {
      client.emit(ServerEvent.ERROR, {
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      `Unhandled WS exception on socket ${client.id}: ${err.message}`,
      err.stack,
    );
    client.emit(ServerEvent.ERROR, {
      code: ErrorCode.INTERNAL_ERROR,
      message: "Internal server error",
    });
  }
}
