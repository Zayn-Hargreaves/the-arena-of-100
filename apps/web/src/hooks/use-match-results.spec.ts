"use client";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchResult, useMatchResults } from "./use-match-results";

// Build a fetch mock that listens to AbortSignal — jsdom + fake
// timers don't auto-reject fetch on signal abort, so we wire that
// link manually. This mirrors the real browser behavior where the
// fetch promise rejects with an `AbortError`-named DOMException.
//
// The impl receives (input, init) and may stash init.signal so the
// response body mock can observe the SAME signal — pinning the
// contract that fetch + body share a controller.
function makeAbortableFetch(
  impl: (input: unknown, init: RequestInit | undefined) => Promise<Response>,
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(((
    input: unknown,
    init?: RequestInit,
  ) => {
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      if (signal?.aborted) {
        settle(() =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
        return;
      }
      signal?.addEventListener("abort", () => {
        settle(() =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
      impl(input, init).then(
        (r) => settle(() => resolve(r)),
        (e) => settle(() => reject(e)),
      );
    });
  }) as typeof fetch);
}

// Build a Response-like object whose `json()` returns a Promise that
// observes the SHARED abort signal — rejecting with an AbortError
// when the controller aborts. This mirrors a real stream-backed
// body consumer that cancels its read on signal abort.
function makeSignalAwareBody(signalRef: { current: AbortSignal | undefined }) {
  const observation = {
    bodySawAbort: false,
    jsonInvocationCount: 0,
  };
  const body = {
    ok: true,
    status: 200,
    json: vi.fn().mockImplementation(() => {
      observation.jsonInvocationCount++;
      const signal = signalRef.current;
      if (signal?.aborted) {
        observation.bodySawAbort = true;
        return Promise.reject(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        );
      }
      return new Promise<unknown>((resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            observation.bodySawAbort = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      });
    }),
  };
  return { body, observation };
}

// Network-phase timeout: the network-phase timeout must gate the HTTP
// fetch line (no body parse yet). When the fetch is aborted by the
// 10s ceiling, the hook should treat it as a network_error.
describe("useMatchResults — network phase timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("surfaces network_error when fetch() never resolves (timeout abort)", async () => {
    makeAbortableFetch(() => new Promise<Response>(() => undefined));

    const { result } = renderHook(() => useMatchResults("m1", "u1"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.loadState).toBe("network_error");
  });
});

// Body-never-completes coverage: the network phase finishes
// successfully, but the body reader hangs forever. The 10s timer
// from the SHARED controller must fire AND the body reader must
// observe the abort via its signal — not just the surrounding
// Promise.race wrapper. The body mock below listens to the same
// signal that fetch was wired with.
describe("useMatchResults — body never completes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts the body reader via the shared signal when the 10s timer fires", async () => {
    const signalRef: { current: AbortSignal | undefined } = {
      current: undefined,
    };
    const { body, observation } = makeSignalAwareBody(signalRef);
    makeAbortableFetch((_input, init) => {
      signalRef.current = init?.signal;
      return Promise.resolve(body as unknown as Response);
    });

    const { result } = renderHook(() => useMatchResults("m1", "u1"));

    // Network phase completes immediately; body reader hangs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(observation.jsonInvocationCount).toBe(1);
    expect(result.current.loadState).toBe("loading");

    // Advance past the 10s shared-controller timer. The abort
    // propagates to the body reader (same signal), which rejects
    // with AbortError; the helper surfaces it as wasTimeout: true.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(observation.bodySawAbort).toBe(true);
    expect(result.current.loadState).toBe("network_error");
  });
});

// External abort during body parse: the hook's cleanup aborts the
// AbortController on unmount. The shared controller must respect
// that signal so the catch block's `abortController.signal.aborted`
// guard keeps the network_error state from being set on a stale
// request.
describe("useMatchResults — external abort during body parse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not change loadState when the parent unmounts mid-body-parse", async () => {
    const signalRef: { current: AbortSignal | undefined } = {
      current: undefined,
    };
    let resolveJson: (value: unknown) => void = () => undefined;
    const body = {
      ok: true,
      status: 200,
      json: vi.fn().mockReturnValueOnce(
        new Promise<unknown>((resolve) => {
          resolveJson = resolve;
        }),
      ),
    };
    makeAbortableFetch((_input, init) => {
      signalRef.current = init?.signal;
      return Promise.resolve(body as unknown as Response);
    });

    const { result, unmount } = renderHook(() => useMatchResults("m1", "u1"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Parent unmounts; cleanup aborts the hook's controller. The
    // body mock above doesn't observe the signal (it just resolves
    // on demand), so the body stays pending — the unmount does NOT
    // surface as a state change because the catch-block guard sees
    // `aborted === true`.
    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    // Resolve the orphaned body.
    resolveJson({ winnerId: "p9", players: [] });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loadState).toBe("loading");
  });
});

// fetchResult — direct unit coverage of the unified helper. The
// critical contract here is that the body reader's AbortSignal is
// wired to the SAME controller as the fetch, so a 10s timer abort
// reaches the body reader, not just the surrounding helper.
describe("fetchResult", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns parsed data on a successful fetch + body parse", async () => {
    const response = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValueOnce({ winnerId: "p1", players: [] }),
    } as unknown as Response;
    makeAbortableFetch(() => Promise.resolve(response));
    const controller = new AbortController();
    const result = await fetchResult("m1", controller.signal);
    expect(result.wasTimeout).toBe(false);
    expect(result.data).toEqual({ winnerId: "p1", players: [] });
    expect(result.response).toBe(response);
  });

  it("aborts the body reader's signal when the 10s timer fires before json resolves", async () => {
    // Pin the contract the finding requires: when the shared
    // controller's timer fires, the body reader observes the
    // SAME signal as aborted. We stashed init.signal during the
    // fetch call and the body mock observes it via addEventListener.
    const signalRef: { current: AbortSignal | undefined } = {
      current: undefined,
    };
    const { body, observation } = makeSignalAwareBody(signalRef);
    makeAbortableFetch((_input, init) => {
      signalRef.current = init?.signal;
      return Promise.resolve(body as unknown as Response);
    });

    const controller = new AbortController();
    const promise = fetchResult("m1", controller.signal);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(observation.jsonInvocationCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const result = await promise;
    expect(result.wasTimeout).toBe(true);
    expect(result.data).toBeNull();
    // The contract pin: the body reader observed the shared
    // signal as aborted. This proves the controller is shared
    // across fetch + body, not a Promise.race band-aid.
    expect(observation.bodySawAbort).toBe(true);
  });

  it("returns wasTimeout: false when the external signal aborts mid-fetch", async () => {
    makeAbortableFetch(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const promise = fetchResult("m1", controller.signal);
    // External abort (not timer-driven): helper must surface this
    // as wasTimeout: false because the timer did NOT fire.
    controller.abort();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const result = await promise;
    expect(result.wasTimeout).toBe(false);
    expect(result.response).toBeNull();
  });

  it("returns wasTimeout: true when fetch never resolves (network-phase timeout)", async () => {
    makeAbortableFetch(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const promise = fetchResult("m1", controller.signal);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const result = await promise;
    expect(result.wasTimeout).toBe(true);
    expect(result.response).toBeNull();
  });
});
