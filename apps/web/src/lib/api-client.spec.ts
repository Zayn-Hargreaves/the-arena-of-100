import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import { ApiError, apiGetJson } from "./api-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Assert the rejected value is an actual `ApiError` instance
// (not just a plain object that happens to match message/status).
// `toThrow` / `rejects.toEqual(objectContaining(...))` only check
// shape; this helper additionally enforces `instanceof ApiError`
// and `name === "ApiError"`, which is what callers rely on (see
// `apps/web/src/app/[locale]/admin/page.tsx:266`).
function expectApiError(
  promise: Promise<unknown>,
  expected: { message: string; status: number },
): Promise<ApiError> {
  return promise.then(
    (value) => {
      throw new Error(
        `Expected promise to reject with ApiError(${expected.status}, ${expected.message}), but it resolved with ${JSON.stringify(value)}`,
      );
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({
        name: "ApiError",
        message: expected.message,
        status: expected.status,
      });
      return err as ApiError;
    },
  );
}

describe("api-client error normalization", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("joins string arrays from payload.message into a safe ApiError message", async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(400, { message: ["first issue", "second issue"] }),
    );

    await expectApiError(apiGetJson("/test"), {
      message: "first issue, second issue",
      status: 400,
    });
  });

  it("returns a non-empty string message as-is", async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(422, { message: "validation failed" }),
    );

    await expectApiError(apiGetJson("/test"), {
      message: "validation failed",
      status: 422,
    });
  });

  it("falls back when payload.message is an empty string", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(400, { message: "" }));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 400",
      status: 400,
    });
  });

  it("falls back when payload.message is an empty array", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(400, { message: [] }));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 400",
      status: 400,
    });
  });

  it("falls back when payload.message is a mixed array (non-string items)", async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(400, { message: ["ok", 42, true] }),
    );

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 400",
      status: 400,
    });
  });

  it("falls back when payload.message is a number", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(400, { message: 42 }));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 400",
      status: 400,
    });
  });

  it("falls back when payload.message is null", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(400, { message: null }));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 400",
      status: 400,
    });
  });

  it("falls back when payload is a bare string (no message field)", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(500, "boom"));

    await expectApiError(apiGetJson("/test"), {
      message: "boom",
      status: 500,
    });
  });

  it("falls back when payload is a bare number", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(500, 42));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 500",
      status: 500,
    });
  });

  it("falls back when payload is an empty string", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(500, ""));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 500",
      status: 500,
    });
  });

  it("falls back when payload is null", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(500, null));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 500",
      status: 500,
    });
  });

  it("falls back when the response body is not JSON", async () => {
    apiFetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 502",
      status: 502,
    });
  });

  it("falls back when payload.error.message is not a string", async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(500, { error: { message: { nested: true } } }),
    );

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 500",
      status: 500,
    });
  });

  it("trims whitespace-only string messages to fallback", async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(400, { message: "   " }));

    await expectApiError(apiGetJson("/test"), {
      message: "Request failed with status 400",
      status: 400,
    });
  });
});
