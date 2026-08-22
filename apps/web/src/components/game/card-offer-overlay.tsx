"use client";

import React, { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { type CardId } from "@arena/shared";
import { CardTile } from "./card-tile";
import { cn } from "@/lib/utils";

export interface CardOfferOverlayProps {
  roundNo: number;
  offeredCardIds: readonly [CardId, CardId, CardId];
  offerSeqNo: number;
  onPickCard: (cardId: CardId, offerSeqNo: number) => void;
  onDismiss?: () => void;
  durationSeconds?: number;
}

export function CardOfferOverlay({
  roundNo,
  offeredCardIds,
  offerSeqNo,
  onPickCard,
  onDismiss,
  durationSeconds = 8,
}: CardOfferOverlayProps) {
  const t = useTranslations("Cards");
  const deadlineRef = useRef<number>(Date.now() + durationSeconds * 1000);
  const selectedRef = useRef<CardId | null>(null);
  const offeredCardIdsRef = useRef(offeredCardIds);
  offeredCardIdsRef.current = offeredCardIds;
  const offerSeqNoRef = useRef(offerSeqNo);
  offerSeqNoRef.current = offerSeqNo;
  const onPickCardRef = useRef(onPickCard);
  onPickCardRef.current = onPickCard;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const expiredRef = useRef(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [selectedCardId, setSelectedCardId] = useState<CardId | null>(null);

  const handleSelect = (cardId: CardId) => {
    if (selectedRef.current !== null) return;
    selectedRef.current = cardId;
    setSelectedCardId(cardId);
    onPickCardRef.current(cardId, offerSeqNoRef.current);
  };

  useEffect(() => {
    deadlineRef.current = Date.now() + durationSeconds * 1000;
    expiredRef.current = false;
    selectedRef.current = null;
    setSelectedCardId(null);
    setTimeLeft(durationSeconds);

    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000),
      );
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        if (!expiredRef.current) {
          expiredRef.current = true;
          if (!selectedRef.current && offeredCardIdsRef.current[0]) {
            onPickCardRef.current(
              offeredCardIdsRef.current[0],
              offerSeqNoRef.current,
            );
          } else if (onDismissRef.current) {
            onDismissRef.current();
          }
        }
      }
    }, 250);

    return () => clearInterval(timer);
  }, [offerSeqNo, durationSeconds]);

  useEffect(() => {
    previousActiveElement.current =
      document.activeElement as HTMLElement | null;
    if (dialogRef.current) {
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length > 0) {
        focusable[0]?.focus();
      } else {
        dialogRef.current.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismissRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (
          document.activeElement === lastElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (
        previousActiveElement.current &&
        typeof previousActiveElement.current.focus === "function"
      ) {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-offer-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-candy-ink/60 backdrop-blur-sm p-4 animate-fade-in outline-none"
    >
      <div className="w-full max-w-2xl rounded-2xl border-4 border-candy-ink bg-white p-6 shadow-[8px_8px_0_0_#2B2D42] space-y-6 animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-candy-ink/10 pb-4">
          <div>
            <span className="inline-block rounded-full bg-candy-pink/20 px-3 py-1 text-xs font-bold text-candy-pink">
              {t("milestoneRound", { round: roundNo })}
            </span>
            <h2
              id="card-offer-title"
              className="text-xl md:text-2xl font-black text-candy-ink mt-1"
            >
              {t("offerTitle")}
            </h2>
          </div>
          <div className="flex items-center gap-2 rounded-full border-2 border-candy-ink bg-candy-yellow px-4 py-1 font-black text-candy-ink shadow-[2px_2px_0_0_#2B2D42]">
            <span>⏱️</span>
            <span>{timeLeft}s</span>
          </div>
        </div>

        {/* Card Options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {offeredCardIds.map((cardId) => {
            const isSelected = selectedCardId === cardId;
            return (
              <div
                key={cardId}
                className={cn(
                  "transition-all duration-200",
                  isSelected && "scale-105",
                )}
              >
                <CardTile
                  cardId={cardId}
                  variant={isSelected ? "selected" : "default"}
                  onClick={() => handleSelect(cardId)}
                  disabled={selectedCardId !== null}
                  className="w-full h-full min-h-[160px] p-4 flex flex-col justify-between"
                />
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <p className="text-center text-xs font-medium text-candy-ink/60">
          {t("offerFooter")}
        </p>
      </div>
    </div>
  );
}
