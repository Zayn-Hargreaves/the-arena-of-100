// ============================================================
// WebSocket Validation Pipe (Zod)
// ============================================================
//
// WS analogue of ZodValidationPipe. Applies a Zod schema to the
// payload of a Socket.io event before the handler runs. Used on
// every @MessageBody in game.gateway.ts.
//
// Behaviour:
// - On success: returns the parsed (and potentially transformed)
//   payload, typed as the schema's inferred type.
// - On failure: throws WsValidationError, which the gateway catches
//   and emits as ServerEvent.ERROR with ErrorCode.INVALID_PAYLOAD.
//
// WsValidationError extends RoomError so the existing per-handler
// catch blocks work without any modification:
//
//   const code = error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
//   ...
//   this.emitError(client, code, msg);
//
// evaluates to ErrorCode.INVALID_PAYLOAD with the formatted Zod
// field paths as the user-facing message. The single handler
// (AuthHandler.handleAuthenticate) that hard-codes INVALID_TOKEN
// has been updated separately to short-circuit on WsValidationError.

import { ArgumentMetadata, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";
import { ErrorCode, RoomError } from "@arena/shared";
import { formatZodError } from "./zod-validation.pipe";

export class WsValidationError extends RoomError {
  constructor(message: string) {
    super(ErrorCode.INVALID_PAYLOAD, message);
    this.name = "WsValidationError";
  }
}

@Injectable()
export class WsValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // Format Zod issues as "field: message" lines (same shape the HTTP
      // ZodValidationPipe produces) so clients can render per-field
      // errors in forms if they want to.
      const formatted = formatZodError(result.error).join("; ");
      throw new WsValidationError(formatted || "Invalid payload");
    }

    return result.data;
  }
}
