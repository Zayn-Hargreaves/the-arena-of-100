"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AvatarOption } from "@/lib/avatars";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { MiniGlyph } from "@/components/ui/mini-glyph";

interface AvatarSelectorProps {
  avatar: AvatarOption;
  isAnimating: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function AvatarSelector({
  avatar,
  isAnimating,
  onPrevious,
  onNext,
}: Readonly<AvatarSelectorProps>) {
  const t = useTranslations("settings.avatar");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onPrevious();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onNext();
    }
  };

  return (
    <div className="text-center">
      <label className="font-display text-sm text-candy-ink block mb-3 uppercase tracking-wider leading-5">
        {t("selectAvatar")}
      </label>

      <div
        role="group"
        aria-label={t("selectAvatar")}
        className="flex justify-center items-center gap-6"
      >
        <button
          type="button"
          onClick={onPrevious}
          onKeyDown={handleKeyDown}
          className="w-12 h-12 bg-candy-yellow border-4 border-candy-ink rounded-2xl flex items-center justify-center shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42] hover:-translate-y-[2px] hover:shadow-[3px_5px_0_0_#2B2D42] transition-all"
          aria-label={t("previous")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5 text-candy-ink"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <div className="flex flex-col items-center">
          <div
            className={`transition-transform duration-300 ${
              isAnimating
                ? "scale-90 -rotate-6"
                : "scale-105 rotate-3 hover:scale-110"
            }`}
          >
            <SpriteFrame
              src={avatar.spritesheet}
              scale={0.45}
              width="86px"
              height="86px"
              frameClassName="w-28 h-28 rounded-[2.2rem] bg-candy-cloud border-[5px] border-candy-ink"
              skeletonSize="86px"
            />
          </div>
          <span
            aria-live="polite"
            className="mt-3 bg-candy-pink text-white font-hand text-2xl px-4 py-0.5 border-3 border-candy-ink rounded-full shadow-[2px_2px_0_0_#000] transform -rotate-1 inline-flex items-center gap-2 leading-none"
          >
            <MiniGlyph variant="avatar" className="w-4 h-4" />
            {avatar.name}
          </span>
        </div>

        <button
          type="button"
          onClick={onNext}
          onKeyDown={handleKeyDown}
          className="w-12 h-12 bg-candy-yellow border-4 border-candy-ink rounded-2xl flex items-center justify-center shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42] hover:-translate-y-[2px] hover:shadow-[3px_5px_0_0_#2B2D42] transition-all"
          aria-label={t("next")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5 text-candy-ink"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
