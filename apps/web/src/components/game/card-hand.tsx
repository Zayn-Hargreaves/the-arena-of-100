"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { type CardId, getCardDefinition, type ClassId } from "@arena/shared";
import { CardTile } from "./card-tile";

export interface CardHandProps {
  hand: readonly CardId[];
  playedCardIds: readonly CardId[];
  classId: ClassId | null;
  onPickCard: (cardId: CardId) => void;
  disabled?: boolean;
  burningCardId?: CardId | null;
  className?: string;
}

// `CardHand` — the player's current hand. Spent cards are
// shown-but-greyed. Used in the match UI beside the question
// card so the player can pick a card at any moment during the
// answer window.
export function CardHand({
  hand,
  playedCardIds,
  classId,
  onPickCard,
  disabled,
  burningCardId = null,
  className,
}: CardHandProps) {
  const t = useTranslations("Cards");
  const playedSet = React.useMemo(
    () => new Set(playedCardIds),
    [playedCardIds],
  );
  const classFiltered = React.useMemo(() => {
    if (!classId) return hand;
    return hand.filter((c) => getCardDefinition(c).classId === classId);
  }, [hand, classId]);
  if (classFiltered.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border-2 border-dashed border-candy-ink/20 p-4 text-center text-sm text-candy-ink/60",
          className,
        )}
      >
        {t("noCards")}
      </div>
    );
  }
  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      data-testid="card-hand"
      aria-label={t("hand")}
    >
      {classFiltered.map((cardId) => {
        const spent = playedSet.has(cardId);
        const isBurning = burningCardId === cardId;
        return (
          <CardTile
            key={cardId}
            cardId={cardId}
            variant={spent ? "spent" : "default"}
            onClick={spent || isBurning ? undefined : () => onPickCard(cardId)}
            disabled={disabled || spent || isBurning}
            isBurning={isBurning}
            className="w-44"
          />
        );
      })}
    </div>
  );
}
