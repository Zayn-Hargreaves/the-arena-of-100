import { ArgumentsHost } from "@nestjs/common";
import { Socket } from "socket.io";
import {
  ErrorCode,
  ServerEvent,
  RoomError,
  ERROR_MESSAGE_KEYS,
} from "@arena/shared";
import { WsExceptionFilter } from "./ws-exception.filter";
import { WsValidationError } from "../pipes/ws-validation.pipe";

interface MockHost {
  getType: () => "http" | "ws" | "rpc";
  switchToWs: () => { getClient: () => Socket };
}

const buildWsHost = (): MockHost => ({
  getType: () => "ws",
  switchToWs: () => ({ getClient: () => client }),
});

const buildHttpHost = (): MockHost => ({
  getType: () => "http",
  // Should not be called for non-WS hosts.
  switchToWs: () => {
    throw new Error("switchToWs should not be called on non-WS hosts");
  },
});

let client: Socket;
let host: MockHost;
let filter: WsExceptionFilter;

beforeEach(() => {
  client = { emit: vi.fn() } as unknown as Socket;
  host = buildWsHost();
  filter = new WsExceptionFilter();
});

describe("WsExceptionFilter", () => {
  it("emits ServerEvent.ERROR with INVALID_PAYLOAD and the i18n key for WsValidationError", () => {
    // The wire contract is now a stable i18n key, NOT the raw
    // Zod message — the client translates the key at the
    // locale-aware boundary. Per-field validation details travel
    // in `details` so forms can render field-level feedback
    // (e.g. "matchId: required").
    const err = new WsValidationError(
      "answer: Invalid input; roundNo: Expected number",
    );

    filter.catch(err, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.INVALID_PAYLOAD,
      message: ERROR_MESSAGE_KEYS[ErrorCode.INVALID_PAYLOAD],
      details: "answer: Invalid input; roundNo: Expected number",
    });
  });

  it("emits the i18n key for the fallback 'Invalid payload' message", () => {
    // Defensive: formatZodError can return an empty array if Zod
    // produced zero issues (shouldn't happen in practice but the
    // pipe falls back to "Invalid payload"). The filter maps it
    // to the SAME i18n key as the structured case so the client
    // never sees raw Zod output.
    const err = new WsValidationError("Invalid payload");

    filter.catch(err, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.INVALID_PAYLOAD,
      message: ERROR_MESSAGE_KEYS[ErrorCode.INVALID_PAYLOAD],
      details: "Invalid payload",
    });
  });

  it("emits the RoomError's code and the i18n key (not exception.message) for other RoomError instances", () => {
    // Synchronous path leaks: e.g. a requireAuth() throw inside a
    // handler. The filter must not re-wrap it as INVALID_PAYLOAD
    // and MUST NOT leak the raw exception message (which may
    // include internal details).
    const err = new RoomError(ErrorCode.UNAUTHORIZED, "Not authenticated");

    filter.catch(err, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.UNAUTHORIZED,
      message: ERROR_MESSAGE_KEYS[ErrorCode.UNAUTHORIZED],
    });
  });

  it("emits INTERNAL_ERROR with the i18n key and logs the stack for unknown throwables", () => {
    const stack = "Error: kaboom\n    at handler:1:1";
    const boom = new Error("kaboom");
    boom.stack = stack;
    const errorSpy = vi
      .spyOn(
        (filter as unknown as { logger: { error: ReturnType<typeof vi.fn> } })
          .logger,
        "error",
      )
      .mockImplementation(() => {});

    filter.catch(boom, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.INTERNAL_ERROR,
      message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
    });
    // Operators see the real stack; the client only sees the
    // i18n key (no server details leaked over the wire).
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unhandled WS exception on socket"),
      stack,
    );
  });

  it("coerces non-Error throwables to INTERNAL_ERROR without crashing", () => {
    // Branch coverage: a misbehaving upstream that throws a
    // string or a plain object must not crash the filter. We
    // should still emit INTERNAL_ERROR.
    const errorSpy = vi
      .spyOn(
        (filter as unknown as { logger: { error: ReturnType<typeof vi.fn> } })
          .logger,
        "error",
      )
      .mockImplementation(() => {});

    filter.catch("a string was thrown", host as unknown as ArgumentsHost);
    filter.catch({ weird: "object" }, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledTimes(2);
    expect(client.emit).toHaveBeenNthCalledWith(1, ServerEvent.ERROR, {
      code: ErrorCode.INTERNAL_ERROR,
      message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
    });
    expect(client.emit).toHaveBeenNthCalledWith(2, ServerEvent.ERROR, {
      code: ErrorCode.INTERNAL_ERROR,
      message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
    });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for non-WS contexts (HTTP / RPC delegated to the HTTP filter)", () => {
    const err = new WsValidationError("ignored");

    filter.catch(err, buildHttpHost() as unknown as ArgumentsHost);

    expect(client.emit).not.toHaveBeenCalled();
  });

  it("falls back to the INTERNAL_ERROR i18n key when a RoomError code is not in the translation table", () => {
    // Defensive: a RoomError whose code is outside the i18n
    // table (e.g. a new code added to shared without a matching
    // ERROR_MESSAGE_KEYS entry) must NOT silently emit `undefined`
    // as the message — fall back to the INTERNAL_ERROR key so the
    // client always renders a known string.
    const unknownCode = 99999 as unknown as ErrorCode;
    const err = new RoomError(unknownCode, "unknown cause");

    filter.catch(err, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: unknownCode,
      message: ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR],
    });
  });
});
