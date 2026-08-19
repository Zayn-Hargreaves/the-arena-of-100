"use client";

import React, { useEffect, useState } from "react";
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
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [selectedCardId, setSelectedCardId] = useState<CardId | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Auto-pick first card if player hasn't picked yet
          if (!selectedCardId && offeredCardIds[0]) {
            onPickCard(offeredCardIds[0], offerSeqNo);
          } else if (onDismiss) {
            onDismiss();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [offeredCardIds, offerSeqNo, onPickCard, onDismiss, selectedCardId]);

  const handleSelect = (cardId: CardId) => {
    setSelectedCardId(cardId);
    onPickCard(cardId, offerSeqNo);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-candy-ink/60 backdrop-blur-sm p-4 animate-fade-in"
    >
      <div className="w-full max-w-2xl rounded-2xl border-4 border-candy-ink bg-white p-6 shadow-[8px_8px_0_0_#2B2D42] space-y-6 animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-candy-ink/10 pb-4">
          <div>
            <span className="inline-block rounded-full bg-candy-pink/20 px-3 py-1 text-xs font-bold text-candy-pink">
              MILESTONE ROUND {roundNo}
            </span>
            <h2 className="text-xl md:text-2xl font-black text-candy-ink mt-1">
              CHỌN 1 THẺ BÀI VIỆN TRỢ
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
                onClick={() => handleSelect(cardId)}
                className={cn(
                  "cursor-pointer transition-all duration-200",
                  isSelected && "scale-105",
                )}
              >
                <CardTile
                  cardId={cardId}
                  variant={isSelected ? "selected" : "default"}
                  className="w-full h-full min-h-[160px] p-4 flex flex-col justify-between"
                />
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <p className="text-center text-xs font-medium text-candy-ink/60">
          Thẻ bài sẽ được lưu vào túi đồ để bạn sử dụng trong lượt thi đấu.
        </p>
      </div>
    </div>
  );
}
