import { ArgumentsHost } from "@nestjs/common";
import { Socket } from "socket.io";
import { ErrorCode, ServerEvent, RoomError } from "@arena/shared";
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
  it("emits ServerEvent.ERROR with INVALID_PAYLOAD and the Zod message for WsValidationError", () => {
    // The WsValidationPipe formats Zod issues as "field: message" lines;
    // the filter must surface that exact string so the client can render
    // per-field details in forms.
    const err = new WsValidationError(
      "answer: Invalid input; roundNo: Expected number",
    );

    filter.catch(err, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.INVALID_PAYLOAD,
      message: "answer: Invalid input; roundNo: Expected number",
    });
  });

  it("emits the fallback 'Invalid payload' message when the pipe used it", () => {
    // Defensive: formatZodError can return an empty array if Zod
    // produced zero issues (shouldn't happen in practice but the
    // pipe falls back to "Invalid payload"). The filter must
    // forward whatever the pipe produced, verbatim.
    const err = new WsValidationError("Invalid payload");

    filter.catch(err, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.INVALID_PAYLOAD,
      message: "Invalid payload",
    });
  });

  it("emits the RoomError's own code and message for other RoomError instances", () => {
    // Synchronous path leaks: e.g. a requireAuth() throw inside a
    // handler. The filter must not re-wrap it as INVALID_PAYLOAD.
    const err = new RoomError(ErrorCode.UNAUTHORIZED, "Not authenticated");

    filter.catch(err, host as unknown as ArgumentsHost);

    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.UNAUTHORIZED,
      message: "Not authenticated",
    });
  });

  it("emits INTERNAL_ERROR with a generic message and logs the stack for unknown throwables", () => {
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
      message: "Internal server error",
    });
    // Operators see the real stack; the client only sees the
    // generic message (no server details leaked over the wire).
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
      message: "Internal server error",
    });
    expect(client.emit).toHaveBeenNthCalledWith(2, ServerEvent.ERROR, {
      code: ErrorCode.INTERNAL_ERROR,
      message: "Internal server error",
    });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for non-WS contexts (HTTP / RPC delegated to the HTTP filter)", () => {
    const err = new WsValidationError("ignored");

    filter.catch(err, buildHttpHost() as unknown as ArgumentsHost);

    expect(client.emit).not.toHaveBeenCalled();
  });
});
