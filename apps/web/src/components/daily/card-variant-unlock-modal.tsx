"use client";

import React from "react";
import type { DailySubmitResponse } from "@/types/daily";
import { type CardId, getCardDefinition } from "@arena/shared";
import { useTranslations } from "next-intl";

interface CardVariantUnlockModalProps {
  result: DailySubmitResponse;
  onClose: () => void;
  // Localized strings — passed in so the modal stays presentation-only.
  title: string;
  subtitle: string;
  shareLabel: string;
  copyLabel: string;
  copiedLabel: string;
  closeLabel: string;
  unlockHeadlineTemplate: string;
  // Pre-formatted share text fragments, kept client-side because
  // they embed the unlocked card name + variant label.
  shareHeadline: string;
  shareScoreLine: (score: number, correct: number, total: number) => string;
  shareStreakLine: (streak: number) => string;
}

/**
 * Phase 3 — fires when `unlockedVariant` is present in the submit
 * response (i.e. the streak crossed a threshold of 7 / 14 / …).
 *
 * Static rendering only — the viral hook is the share text + URL,
 * not any in-page animation. We deliberately keep the markup simple
 * so it is testable from JSDOM without canvas / Web Share API
 * polyfills.
 */
export function CardVariantUnlockModal({
  result,
  onClose,
  title,
  subtitle,
  shareLabel,
  copyLabel,
  copiedLabel,
  closeLabel,
  unlockHeadlineTemplate,
  shareHeadline,
  shareScoreLine,
  shareStreakLine,
}: Readonly<CardVariantUnlockModalProps>) {
  const [copied, setCopied] = React.useState(false);
  const t = useTranslations("Cards");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  // Focus management — move focus into the modal when it opens,
  // trap Tab/Shift+Tab within its interactive controls while open,
  // and restore focus to the previously focused element on unmount.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusables = (): HTMLElement[] => {
      const root = containerRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    // Move focus into the modal after mount.
    const focusables = getFocusables();
    focusables[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = getFocusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, []);

  const unlocked = result.unlockedVariant;
  // Defensive: when the parent fires this modal without an unlock,
  // render a minimal "nothing unlocked" state rather than throw.
  const cardId = unlocked?.cardId as CardId | undefined;
  const variantKey = unlocked?.variantKey ?? "DEFAULT";
  const cardDef = cardId ? getCardDefinition(cardId) : null;
  // Phase 3 — localize card name with the i18n catalog, falling back
  // to the canonical English name when the translation is missing.
  const cardName =
    cardId && t.has(`byId.${cardId}.name`)
      ? t(`byId.${cardId}.name`)
      : (cardDef?.name ?? "");

  const headline = unlockHeadlineTemplate
    .replace("{variant}", variantKey)
    .replace("{cardName}", cardName);

  const shareText = [
    shareHeadline,
    `${cardName} (${variantKey}) ${title}`,
    shareScoreLine(result.score, result.correctCount, result.totalQuestions),
    shareStreakLine(result.streakAfter),
  ].join("\n");

  const handleShare = React.useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.share !== "function"
    ) {
      return;
    }
    try {
      await navigator.share({
        title: `${cardName} ${variantKey}`,
        text: shareText,
        url: typeof window !== "undefined" ? window.location.origin : "",
      });
    } catch {
      // User cancellation is not a failure — leave quietly.
    }
  }, [cardName, variantKey, shareText]);

  const handleCopy = React.useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      (typeof window !== "undefined" && !window.isSecureContext)
    ) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fall through silently — share modal stays open.
    }
  }, [shareText]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-candy-ink/50 p-4"
      data-testid="card-variant-unlock-modal"
    >
      <div className="bg-candy-yellow border-[3px] border-candy-ink rounded-2xl p-6 max-w-sm w-full shadow-[6px_6px_0_0_#2B2D42] space-y-4">
        <h2 className="font-display font-black text-xl text-candy-ink uppercase text-center">
          {title}
        </h2>
        <p className="text-xs font-mono text-center text-candy-ink/70">
          {subtitle}
        </p>

        <div
          className="bg-white border-[3px] border-candy-ink rounded-xl p-4 text-center space-y-2"
          data-variant-key={variantKey}
        >
          <div className="font-display font-black text-2xl text-candy-ink uppercase">
            {cardName}
          </div>
          <div
            className={`inline-block px-3 py-1 rounded-full font-mono font-black text-xs uppercase ${
              variantKey === "GOLD"
                ? "bg-amber-100 text-amber-700"
                : variantKey === "NEON"
                  ? "bg-cyan-100 text-cyan-700"
                  : "bg-slate-100 text-slate-700"
            }`}
          >
            {variantKey}
          </div>
        </div>

        <p className="text-sm font-body text-center text-candy-ink">
          {headline}
        </p>

        <div className="flex gap-2 justify-center flex-wrap">
          <button
            type="button"
            onClick={() => void handleShare()}
            className="px-4 py-2 rounded-xl bg-candy-pink text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42]"
          >
            {shareLabel}
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="px-4 py-2 rounded-xl bg-candy-blue text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42]"
          >
            {copied ? copiedLabel : copyLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-candy-cloud text-candy-ink border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42]"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
