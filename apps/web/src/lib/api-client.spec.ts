import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import { ApiError, apiGetJson } from "./api-client";

describe("api-client error normalization", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("joins string arrays from payload.message into a safe ApiError message", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: ["first issue", "second issue"],
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(apiGetJson("/test")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: "ApiError",
        message: "first issue, second issue",
        status: 400,
      }),
    );
  });

  it("falls back when payload.error.message is not a string", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: { nested: true } },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(apiGetJson("/test")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: "ApiError",
        message: "Request failed with status 500",
        status: 500,
      }),
    );
  });
});
