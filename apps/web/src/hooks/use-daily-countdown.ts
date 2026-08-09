"use client";

import { useEffect, useMemo, useState } from "react";

interface UseDailyCountdownResult {
  /** Milliseconds until reset; clamped to 0 once the deadline passes. */
  remainingMs: number;
  /** Human-friendly countdown string, e.g. "12:34:56". */
  display: string;
  /** True the instant the deadline is reached. */
  isExpired: boolean;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Counts down to a server-supplied reset moment without trusting
 * the client clock. The clock offset (serverNow - Date.now()) is
 * captured once per `serverNowIso` change via `useMemo` so it is
 * stable across renders — otherwise the effect would tear down and
 * re-arm its interval on every tick.
 *
 * `serverNowIso` MUST come from the API response (or the page's
 * initial server-render time), not from `new Date()`. The hook
 * falls back to `Date.now()` when no `serverNowIso` is supplied,
 * but every production caller is expected to pass it.
 */
export function useDailyCountdown(
  targetIso: string,
  serverNowIso?: string,
  intervalMs = 1000,
): UseDailyCountdownResult {
  const targetMs = useMemo(() => new Date(targetIso).getTime(), [targetIso]);

  const clockOffsetMs = useMemo(() => {
    const serverNowMs = serverNowIso
      ? new Date(serverNowIso).getTime()
      : Date.now();
    return serverNowMs - Date.now();
  }, [serverNowIso]);

  const [now, setNow] = useState<number>(() => Date.now() + clockOffsetMs);

  useEffect(() => {
    if (Number.isNaN(targetMs)) return;
    setNow(Date.now() + clockOffsetMs);

    const id = window.setInterval(() => {
      setNow(Date.now() + clockOffsetMs);
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [targetMs, clockOffsetMs, intervalMs]);

  const remainingMs = Math.max(0, targetMs - now);
  const isExpired = remainingMs === 0;

  return {
    remainingMs,
    display: formatDuration(remainingMs),
    isExpired,
  };
}
