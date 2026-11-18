"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  type CardEffectEvent,
  type CardId,
  getCardDefinition,
} from "@arena/shared";
import { CardGlyph, getGlyphForCardId } from "./card-glyphs";

export interface CardAnimationProps {
  event: CardEffectEvent | null;
  userId?: string | null;
  players?: Array<{ id: string; name: string }>;
  onComplete?: () => void;
  className?: string;
}

/**
 * Duration in milliseconds for displaying MUTATION card effect animations.
 * Also determines when onComplete is called and clears cardState.lastResolvedEffect
 * via clearResolvedCardEffect.
 */
export const MUTATION_ANIMATION_DURATION_MS = 2500;

function getCardDefinitionSafe(cardId: CardId | undefined) {
  if (!cardId) return null;
  try {
    return getCardDefinition(cardId);
  } catch {
    return null;
  }
}

function useCardAnimationTimer(
  event: CardEffectEvent | null,
  onComplete?: () => void,
) {
  const [now, setNow] = React.useState(() => Date.now());
  const mountedAtRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!event) return;
    mountedAtRef.current = Date.now();
    if (event.resolution === "MUTATION") {
      const timer = setTimeout(
        () => onComplete?.(),
        MUTATION_ANIMATION_DURATION_MS,
      );
      return () => clearTimeout(timer);
    }
    // TEMPORARY: run a 1Hz tick so the countdown updates and
    // arm a completion timer so onComplete fires when the
    // effect's authoritative `remainingMs` elapses.
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const complete = setTimeout(
      () => onComplete?.(),
      Math.max(0, event.remainingMs ?? 0),
    );
    return () => {
      clearInterval(interval);
      clearTimeout(complete);
    };
  }, [event, onComplete]);

  const elapsed =
    mountedAtRef.current > 0 ? Math.max(0, now - mountedAtRef.current) : 0;

  return event?.resolution === "TEMPORARY"
    ? Math.max(0, (event.remainingMs ?? 0) - elapsed)
    : 0;
}

function resolveTargetNames(
  targetPlayerIds: readonly string[],
  userId: string | null | undefined,
  players: Array<{ id: string; name: string }>,
  fallbackYou: string,
  fallbackOpponent: string,
): string {
  return targetPlayerIds
    .map((tid) => {
      if (tid === userId) return fallbackYou;
      return players.find((p) => p.id === tid)?.name ?? fallbackOpponent;
    })
    .join(", ");
}

interface ActionContextMessageProps {
  isPlayedByMe: boolean;
  isTargetingMe: boolean;
  targetNames: string;
  playedByName: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function ActionContextMessage({
  isPlayedByMe,
  isTargetingMe,
  targetNames,
  playedByName,
  t,
}: Readonly<ActionContextMessageProps>) {
  if (isPlayedByMe) {
    if (targetNames) {
      return (
        <span>{t("animation.youActivatedOn", { targets: targetNames })}</span>
      );
    }
    return <span>{t("animation.youActivated")}</span>;
  }

  if (isTargetingMe) {
    return (
      <span className="font-black text-candy-yellow">
        {t("animation.opponentTargetedYou", { name: playedByName })}
      </span>
    );
  }

  if (targetNames) {
    return (
      <span>
        {t("animation.opponentActivatedOn", {
          name: playedByName,
          targets: targetNames,
        })}
      </span>
    );
  }

  return (
    <span>{t("animation.opponentActivated", { name: playedByName })}</span>
  );
}

function getCardAnimationTheme(isAttack: boolean, isTargetingMe: boolean) {
  const containerTone = isAttack
    ? "bg-candy-yellow/95 border-candy-ink text-candy-ink"
    : "bg-candy-mint/95 border-candy-ink text-candy-ink";
  const glyphTone = isAttack
    ? "bg-candy-orange text-white"
    : "bg-white text-candy-blue";
  const badgeTone = isAttack
    ? "bg-candy-red text-white"
    : "bg-candy-blue text-white";
  const targetingOverride =
    isTargetingMe && isAttack ? "bg-candy-red text-white" : "";

  return {
    containerClass: cn(containerTone, targetingOverride),
    glyphClass: glyphTone,
    badgeClass: badgeTone,
  };
}

// `CardAnimation` — fires a rich, localized Pop-Art notification banner when a
// `CARD_RESOLVED` event lands. TEMPORARY effects linger for the
// effect duration (driven by `remainingMs`). MUTATION effects
// fade after a single 2.5s window.
export function CardAnimation({
  event,
  userId,
  players = [],
  onComplete,
  className,
}: Readonly<CardAnimationProps>) {
  const t = useTranslations("Cards");
  const remainingMs = useCardAnimationTimer(event, onComplete);

  if (!event) return null;

  const def = getCardDefinitionSafe(event.cardId);
  if (!def) return null;

  const isPlayedByMe = Boolean(userId && event.playedByPlayerId === userId);
  const isTargetingMe = Boolean(
    userId && event.targetPlayerIds?.includes(userId),
  );

  // Only show the card banner/dialog if the local user is the caster or the targeted victim
  if (userId && !isPlayedByMe && !isTargetingMe) {
    return null;
  }

  const glyph = getGlyphForCardId(event.cardId);
  const localizedName = t.has(`byId.${event.cardId}.name`)
    ? t(`byId.${event.cardId}.name`)
    : def.name;
  const localizedDescription = t.has(`byId.${event.cardId}.description`)
    ? t(`byId.${event.cardId}.description`)
    : def.description;

  const fallbackOpponent = t("animation.opponent");
  const fallbackYou = t("animation.you");

  const playedByName =
    players.find((p) => p.id === event.playedByPlayerId)?.name ??
    fallbackOpponent;
  const targetNames = resolveTargetNames(
    event.targetPlayerIds,
    userId,
    players,
    fallbackYou,
    fallbackOpponent,
  );

  const isAttack = def.classId === "ATTACK";
  const theme = getCardAnimationTheme(isAttack, isTargetingMe);

  return (
    <div
      data-effect-kind={event.effect.kind}
      data-resolution={event.resolution}
      data-card-id={event.cardId}
      className={cn(
        "pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center max-w-md w-full px-4 animate-slide-up",
        className,
      )}
    >
      <div
        className={cn(
          "w-full rounded-2xl border-[3.5px] border-candy-ink p-4 text-candy-ink shadow-[5px_5px_0_0_#2B2D42] backdrop-blur-md transition-all flex items-start gap-3.5",
          theme.containerClass,
        )}
      >
        {/* Card Glyph Box */}
        <div
          className={cn(
            "w-12 h-12 rounded-xl border-[2.5px] border-candy-ink flex items-center justify-center shrink-0 shadow-[2px_2px_0_0_#2B2D42]",
            theme.glyphClass,
          )}
        >
          <CardGlyph variant={glyph} size={26} />
        </div>

        {/* Content Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-display font-black text-sm uppercase tracking-wide truncate">
                {localizedName}
              </span>
              <span
                className={cn(
                  "text-[10px] font-black uppercase px-1.5 py-0.5 rounded border border-candy-ink/40 shadow-xs",
                  theme.badgeClass,
                )}
              >
                {t(`classes.${def.classId}`)}
              </span>
              {event.targetRoundNo && (
                <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-candy-yellow text-candy-ink border border-candy-ink/40 shadow-xs">
                  {t("animation.round", { round: event.targetRoundNo })}
                </span>
              )}
            </div>

            {event.resolution === "TEMPORARY" && (
              <span className="text-[11px] font-black font-mono bg-white/90 text-candy-ink border-[1.5px] border-candy-ink px-2 py-0.5 rounded-md shrink-0 shadow-[1px_1px_0_0_#2B2D42] animate-pulse">
                {(remainingMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {/* Action Context Message */}
          <div className="text-xs font-bold mt-1 opacity-90">
            <ActionContextMessage
              isPlayedByMe={isPlayedByMe}
              isTargetingMe={isTargetingMe}
              targetNames={targetNames}
              playedByName={playedByName}
              t={t}
            />
          </div>

          <p className="text-[11px] mt-0.5 opacity-80 line-clamp-1">
            {localizedDescription}
          </p>
        </div>
      </div>
      <span className="sr-only">{t("play")}</span>
    </div>
  );
}
