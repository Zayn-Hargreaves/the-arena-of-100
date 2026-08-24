"use client";

import React from "react";
import type { DailySubmitResponse } from "@/types/daily";

interface DailyShareButtonProps {
  result: DailySubmitResponse;
  shareLabel: string;
  copyLabel: string;
  copiedLabel: string;
  errorLabel: string;
  /** Localized strings baked into the shared text itself. */
  shareTextTitle: string;
  shareTextScoreLabel: string;
  shareTextStreakLabel: string;
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

interface ShareTextLabels {
  title: string;
  score: string;
  streak: string;
}

function buildShareText(
  result: DailySubmitResponse,
  labels: ShareTextLabels,
): string {
  const squares = "🟩";
  const wrongs = "🟥";
  const rows = result.results.map((r) => (r.isCorrect ? squares : wrongs));
  return [
    `${labels.title} ${result.dateKey}`,
    `${labels.score} ${result.score} (${result.correctCount}/${result.totalQuestions})`,
    `${labels.streak} ${result.streakAfter}`,
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
  shareTextTitle,
  shareTextScoreLabel,
  shareTextStreakLabel,
}: Readonly<DailyShareButtonProps>) {
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState(false);

  // Detected after mount, never during render: `navigator` does not
  // exist on the server, and branching on it inline would make the
  // server HTML and the first client render disagree. Starting at
  // `false` means both render `copyLabel`; the effect then upgrades to
  // the native-share label on capable clients.
  const [supportsNativeShare, setSupportsNativeShare] = React.useState(false);

  React.useEffect(() => {
    setSupportsNativeShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

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
    const text = buildShareText(result, {
      title: shareTextTitle,
      score: shareTextScoreLabel,
      streak: shareTextStreakLabel,
    });

    if (supportsNativeShare) {
      try {
        await navigator.share({ title: shareTextTitle, text, url });
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
  }, [
    result,
    supportsNativeShare,
    shareTextTitle,
    shareTextScoreLabel,
    shareTextStreakLabel,
  ]);

  const label = copied
    ? copiedLabel
    : error
      ? errorLabel
      : supportsNativeShare
        ? shareLabel
        : copyLabel;

  return (
    <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h4 className="font-display font-black text-sm text-candy-ink uppercase tracking-wide">
            {shareTextTitle}
          </h4>
          <div className="flex items-center gap-1.5 flex-wrap">
            {result.results.map((r, i) => (
              <span
                key={i}
                className={`w-6 h-6 rounded-lg border-[2px] border-candy-ink flex items-center justify-center font-mono font-black text-xs shadow-[1px_1px_0_0_#2B2D42] ${
                  r.isCorrect
                    ? "bg-candy-mint text-candy-ink"
                    : "bg-candy-pink text-white"
                }`}
              >
                {r.isCorrect ? "✓" : "✕"}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleShare()}
          className="min-h-11 px-5 py-2.5 rounded-xl bg-candy-pink text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] hover:bg-candy-pink/90 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all shrink-0 cursor-pointer"
        >
          {label}
        </button>
      </div>
    </div>
  );
}
