// ============================================================
// HttpExceptionFilter - Unit Tests
// ============================================================
//
// Codecov patch coverage for PR #50. The PR added the WS-context
// early-return guard at the top of `catch()` so the HTTP filter
// defers to WsExceptionFilter on Socket.io contexts (which would
// otherwise TypeError on `response.status().send()`). The
// remaining branches (HttpException 4xx, generic Error 5xx, the
// `getLogMessage` helper's `message` fallback chain) were not
// covered by a dedicated spec — this file pins them all.
//
// Mirrors the structure of `ws-exception.filter.spec.ts` so the
// two filters are easy to compare side-by-side.
// ============================================================

import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { vi, beforeEach, afterEach, it, expect, describe } from "vitest";
import { HttpExceptionFilter } from "./http-exception.filter";

interface MockHost {
  getType: () => "http" | "ws" | "rpc";
  switchToHttp: () => {
    getResponse: () => FastifyReply;
    getRequest: () => FastifyRequest;
  };
}

const buildHttpHost = (
  responseOverrides: Partial<FastifyReply> = {},
): { host: MockHost; response: FastifyReply; request: FastifyRequest } => {
  const status = vi.fn().mockReturnThis();
  const send = vi.fn().mockReturnThis();
  const response = {
    status,
    send,
    ...responseOverrides,
  } as unknown as FastifyReply;
  const request = {
    method: "GET",
    url: "/test/path",
  } as unknown as FastifyRequest;
  const host: MockHost = {
    getType: () => "http",
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  };
  return { host, response, request };
};

const buildNonHttpHost = (type: "ws" | "rpc"): { host: MockHost } => ({
  // switchToHttp must NEVER be called for non-HTTP hosts; we
  // throw so a regression that forgets the early-return guard
  // fails loudly.
  host: {
    getType: () => type,
    switchToHttp: () => {
      throw new Error("switchToHttp should not be called on non-HTTP hosts");
    },
  },
});

let filter: HttpExceptionFilter;

beforeEach(() => {
  filter = new HttpExceptionFilter();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HttpExceptionFilter", () => {
  it("returns early without calling switchToHttp when host type is 'ws'", () => {
    // The new branch added in PR #50. WsExceptionFilter owns
    // WebSocket delivery; if we get called for a WS context,
    // the HTTP filter must defer and NOT call switchToHttp()
    // (which would TypeError on `response.status().send()`).
    const { host } = buildNonHttpHost("ws");

    // Should not throw, should not call switchToHttp.
    expect(() =>
      filter.catch(new Error("ws boom"), host as unknown as ArgumentsHost),
    ).not.toThrow();
  });

  it("returns early without calling switchToHttp when host type is 'rpc'", () => {
    // Defensive: the early-return guard must match any non-HTTP
    // context, not just 'ws'. An RPC call routed through Nest's
    // exception filter pipeline would otherwise TypeError.
    const { host } = buildNonHttpHost("rpc");

    expect(() =>
      filter.catch(new Error("rpc boom"), host as unknown as ArgumentsHost),
    ).not.toThrow();
  });

  it("formats a 4xx HttpException with the exception's message and status", () => {
    // HttpException branch: status comes from the exception,
    // message comes from the exception body, logger.warn (not
    // error) is used for 4xx codes.
    const { host, response, request } = buildHttpHost();
    const exception = new HttpException(
      { statusCode: 404, message: "Resource missing", error: "Not Found" },
      HttpStatus.NOT_FOUND,
    );
    const warnSpy = vi
      .spyOn(
        (filter as unknown as { logger: { warn: ReturnType<typeof vi.fn> } })
          .logger,
        "warn",
      )
      .mockImplementation(() => {});

    filter.catch(exception, host as unknown as ArgumentsHost);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          statusCode: 404,
          message: "Resource missing",
          path: request.url,
          timestamp: expect.any(String),
        }),
      }),
    );
    // 4xx → warn, not error.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("GET /test/path 404"),
    );
  });

  it("falls back to 'error' field when HttpException body has no message", () => {
    // Branch coverage for the `message` extraction chain at
    // `http-exception.filter.ts:39-44`. A NestJS-internal
    // exception may produce a body with only `{ error: "Bad
    // Request" }` and no `message` — we must fall back to
    // that field rather than emit an empty string.
    const { host, response } = buildHttpHost();
    const exception = new HttpException(
      { error: "Bad Request" },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host as unknown as ArgumentsHost);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "Bad Request" }),
      }),
    );
  });

  it("uses the string body as the message when HttpException.getResponse() returns a string", () => {
    // `getResponse()` can return a string (NestJS does this
    // for some built-in exceptions). The `typeof exceptionResponse
    // === "string"` branch must surface that string verbatim.
    const { host, response } = buildHttpHost();
    const exception = new HttpException("Forbidden", HttpStatus.FORBIDDEN);

    filter.catch(exception, host as unknown as ArgumentsHost);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "Forbidden" }),
      }),
    );
  });

  it("formats a 5xx generic Error as INTERNAL_SERVER_ERROR and logs the stack at error level", () => {
    // Generic throwable branch: 5xx → status 500, generic
    // message (no server details leak to the client), the
    // real stack is inlined into the operator log line.
    //
    // Note the call shape: `logger.error(logInfo)` is a SINGLE
    // argument. The stack is inlined into the formatted log
    // string by `getLogMessage`, not passed as a second arg
    // (the WS sibling uses the 2-arg shape; the HTTP filter
    // uses the 1-arg shape). Don't conflate the two.
    const { host, response, request } = buildHttpHost();
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

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          statusCode: 500,
          message: "Internal server error",
          path: request.url,
        }),
      }),
    );
    // 5xx → error (not warn). The logInfo string is built as
    //   `GET /test/path 500 - ${logMessage}`
    // and `getLogMessage(exception, message)` returns the stack
    // for 5xx. We assert the stack is inlined into the log
    // line.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logArg = errorSpy.mock.calls[0][0] as string;
    expect(logArg).toContain("GET /test/path 500");
    expect(logArg).toContain("Error: kaboom");
    expect(logArg).toContain("at handler:1:1");
  });

  it("uses the message string in the log when the exception has no stack", () => {
    // `getLogMessage` fallback chain: a non-Error throwable
    // with `message: "..."` must surface that string in the
    // log line.
    const { host } = buildHttpHost();
    const errorSpy = vi
      .spyOn(
        (filter as unknown as { logger: { error: ReturnType<typeof vi.fn> } })
          .logger,
        "error",
      )
      .mockImplementation(() => {});

    // A plain object that quacks like `{ message: "..." }` and
    // is still "object-like" enough to enter the `getLogMessage`
    // branch (no `stack`, has `message`).
    filter.catch(
      { message: "plain object with no stack" },
      host as unknown as ArgumentsHost,
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("plain object with no stack"),
    );
  });

  it("JSON.stringifies an array message in the log when neither stack nor message string is present", () => {
    // `getLogMessage` falls back to JSON.stringify when
    // `message` is an array (e.g. ZodValidationPipe surfaces
    // validation errors as a string[]). We exercise that path
    // by passing an HttpException whose body has a `message`
    // array and no usable stack on the error itself.
    const { host } = buildHttpHost();
    const warnSpy = vi
      .spyOn(
        (filter as unknown as { logger: { warn: ReturnType<typeof vi.fn> } })
          .logger,
        "warn",
      )
      .mockImplementation(() => {});

    // HttpException with array body message — 4xx path, so we
    // assert on warn.
    const exception = new HttpException(
      { message: ["field a: bad", "field b: bad"], error: "ValidationError" },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    filter.catch(exception, host as unknown as ArgumentsHost);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("field a: bad"),
    );
  });

  it("falls back to 'Unknown error' inside getLogMessage when neither stack nor a non-empty message exists", () => {
    // `getLogMessage` final fallback. The public `catch` path
    // ALWAYS populates `message` (either from the exception
    // body or the hard-coded "Internal server error"
    // default), so the `(message as string) || "Unknown error"`
    // branch is unreachable from `catch()`. We exercise it by
    // calling the private helper directly with an empty
    // message string, which is the only way to land in the
    // final fallback.
    const logMessage = (
      filter as unknown as {
        getLogMessage: (ex: unknown, msg: unknown) => string;
      }
    ).getLogMessage(null, "");

    expect(logMessage).toBe("Unknown error");
  });

  it("does NOT include the exception's stack in the 4xx log (stack path is 5xx-only)", () => {
    // The `getLogMessage` helper is called with `null` for the
    // exception on the 4xx path, so even if an HttpException
    // subclass has a stack, it is intentionally NOT inlined
    // into the log line. This is a deliberate choice — 4xx is
    // a client error, not a server error, and surfacing the
    // stack would be noise. We pin the contract.
    const { host } = buildHttpHost();
    const warnSpy = vi
      .spyOn(
        (filter as unknown as { logger: { warn: ReturnType<typeof vi.fn> } })
          .logger,
        "warn",
      )
      .mockImplementation(() => {});

    const exception = new HttpException("Bad", HttpStatus.BAD_REQUEST);
    // Force a stack on the HttpException (JS allows this).
    (exception as unknown as { stack: string }).stack =
      "Error: Bad\n    at fake:1:1";

    filter.catch(exception, host as unknown as ArgumentsHost);

    // The log line is built from message ("Bad"), NOT from the
    // stack. The warn call has exactly one arg.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logArg = warnSpy.mock.calls[0][0] as string;
    expect(logArg).toContain("GET /test/path 400");
    expect(logArg).toContain("Bad");
    // The stack is intentionally NOT included on the 4xx
    // path. A regression that passed `exception` (instead of
    // `null`) to getLogMessage on the 4xx branch would
    // surface the stack here and fail this assertion.
    expect(logArg).not.toContain("at fake:1:1");
  });

  it("handles logger errors gracefully and sends the HTTP error response", () => {
    const { host, response, request } = buildHttpHost();
    vi.spyOn(
      Logger.prototype as unknown as { warn: () => void },
      "warn",
    ).mockImplementation(() => {
      throw new Error("logger down");
    });

    const exception = new HttpException("Bad", HttpStatus.BAD_REQUEST);

    // The logger throw should be caught and not propagate to the caller.
    expect(() =>
      filter.catch(exception, host as unknown as ArgumentsHost),
    ).not.toThrow();

    // The response should STILL be sent.
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          statusCode: 400,
          message: "Bad",
          path: request.url,
          timestamp: expect.any(String),
        }),
      }),
    );
  });
});
