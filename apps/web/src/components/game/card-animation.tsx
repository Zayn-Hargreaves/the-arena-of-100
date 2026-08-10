"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { type CardEffectEvent } from "@arena/shared";

export interface CardAnimationProps {
  event: CardEffectEvent | null;
  onComplete?: () => void;
  className?: string;
}

// `CardAnimation` — fires a brief overlay animation when a
// `CARD_RESOLVED` event lands. TEMPORARY effects linger for the
// effect duration (driven by `remainingMs`). MUTATION effects
// fade after a single 1.5s frame.
//
// We never read `Date.now()` against `event.serverTimestamp` for
// the countdown — the spec's clock-drift rule means the server
// `remainingMs` is the only trusted source. The component reads
// `event.remainingMs` directly and decrements via a `requestAnimationFrame`
// loop that computes elapsed from a snapshot of the render
// timestamp (= Date.now() at mount, then diffed), so the visible
// countdown is `event.remainingMs - elapsed` and is identical
// for every client regardless of their local clock.
export function CardAnimation({
  event,
  onComplete,
  className,
}: CardAnimationProps) {
  const t = useTranslations("Cards");
  const [tick, setTick] = React.useState(0);
  const mountedAtRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!event) return;
    mountedAtRef.current = Date.now();
    if (event.resolution === "MUTATION") {
      const timer = setTimeout(() => onComplete?.(), 1500);
      return () => clearTimeout(timer);
    }
    // TEMPORARY: run a 1Hz tick so the countdown updates and
    // arm a completion timer so onComplete fires when the
    // effect's authoritative `remainingMs` elapses.
    const interval = setInterval(() => setTick((x) => x + 1), 1000);
    const complete = setTimeout(
      () => onComplete?.(),
      Math.max(0, event.remainingMs ?? 0),
    );
    return () => {
      clearInterval(interval);
      clearTimeout(complete);
    };
  }, [event, onComplete]);

  if (!event) return null;
  const elapsed = Math.max(0, Date.now() - mountedAtRef.current);
  const remainingMs =
    event.resolution === "TEMPORARY"
      ? Math.max(0, (event.remainingMs ?? 0) - elapsed)
      : 0;
  void tick;

  return (
    <div
      data-effect-kind={event.effect.kind}
      data-resolution={event.resolution}
      className={cn(
        "pointer-events-none fixed inset-0 z-40 flex items-center justify-center",
        className,
      )}
    >
      <div className="rounded-lg border-2 border-candy-ink bg-candy-pink/80 px-6 py-3 text-white shadow-[4px_4px_0_0_#2B2D42] animate-jelly-wobble">
        <span className="text-sm font-bold">{event.cardId}</span>
        {event.resolution === "TEMPORARY" && (
          <span className="ml-2 text-xs">
            {(remainingMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      <span className="sr-only">{t("play")}</span>
    </div>
  );
}
