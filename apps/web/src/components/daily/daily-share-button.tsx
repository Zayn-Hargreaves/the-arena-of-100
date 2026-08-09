"use client";

import React from "react";
import type { DailySubmitResponse } from "@/types/daily";

interface DailyShareButtonProps {
  result: DailySubmitResponse;
  shareLabel: string;
  copyLabel: string;
  copiedLabel: string;
  errorLabel: string;
}

function buildShareUrl(origin: string, result: DailySubmitResponse): string {
  const params = new URLSearchParams({
    score: String(result.score),
    correct: String(result.correctCount),
    total: String(result.totalQuestions),
    streak: String(result.streakAfter),
    dateKey: result.dateKey,
  });
  return `${origin}/api/daily/share?${params.toString()}`;
}

function buildShareText(result: DailySubmitResponse): string {
  const squares = "🟩";
  const wrongs = "🟥";
  const rows = result.results.map((r) => (r.isCorrect ? squares : wrongs));
  return [
    `Arena of 100 — Daily ${result.dateKey}`,
    `Score ${result.score} (${result.correctCount}/${result.totalQuestions})`,
    `Streak ${result.streakAfter}`,
    rows.join(" "),
  ].join("\n");
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function isAbortLikeError(err: unknown): boolean {
  if (isAbortError(err)) return true;
  // Some platforms surface user-canceled share as a plain Error with
  // this exact name; cover it without depending on the DOMException class.
  // Note: do NOT match on `err.message` — strings like "network aborted"
  // indicate a real failure and must fall through to the clipboard
  // fallback, not be treated as a user cancellation.
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Client-side share helper. Uses the platform `navigator.share` when
 * available (mobile-first), falls back to clipboard otherwise. The URL
 * points at the OG route — no auth, no DB — so recipients see a static
 * card, not a live page.
 *
 * Error semantics:
 *   - User-canceled share (AbortError): silent return, no fallback,
 *     no copied state. Cancellation is not a failure.
 *   - Other share failure: try clipboard. If clipboard also fails,
 *     surface an error state so the caller can react.
 */
export function DailyShareButton({
  result,
  shareLabel,
  copyLabel,
  copiedLabel,
  errorLabel,
}: Readonly<DailyShareButtonProps>) {
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState(false);

  const supportsNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const timerRef = React.useRef<number | null>(null);

  // Clear any pending "copied" reset when the component unmounts or
  // when a new copy cycle starts — otherwise it could fire on a
  // disposed component and warn / leak.
  React.useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleShare = React.useCallback(async () => {
    setError(false);
    setCopied(false);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = buildShareUrl(origin, result);
    const text = buildShareText(result);

    if (supportsNativeShare) {
      try {
        await navigator.share({ title: "Arena of 100 — Daily", text, url });
        return;
      } catch (e) {
        // User cancellation is not a failure — leave quietly.
        if (isAbortLikeError(e)) return;
        // Any other share failure: try the clipboard fallback below.
      }
    }

    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof window !== "undefined" &&
      window.isSecureContext
    ) {
      try {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setCopied(true);
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, 2000);
        return;
      } catch {
        // Clipboard refused (permissions) — fall through to error.
      }
    }

    setError(true);
  }, [result, supportsNativeShare]);

  const label = copied
    ? copiedLabel
    : error
      ? errorLabel
      : supportsNativeShare
        ? shareLabel
        : copyLabel;

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      className="min-h-11 px-4 py-2 rounded-xl bg-candy-pink text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42]"
    >
      {label}
    </button>
  );
}
