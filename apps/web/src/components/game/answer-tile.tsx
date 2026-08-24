"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

import { CardGlyph } from "./card-glyphs";

export interface AnswerTileProps {
  option: string; // E.g., "A", "B", "C", "D"
  content: string; // The answer text
  variant?: "default" | "selected" | "correct" | "incorrect" | "disabled";
  onClick?: () => void;
  disabled?: boolean;
  isLocked?: boolean;
  isFiftyFiftyDisabled?: boolean;
  isFakeFlagged?: boolean;
  className?: string;
}

const assertNever = (_value: never): never => {
  throw new Error("Unhandled answer tile variant");
};

const getVariantStyles = (
  variant: AnswerTileProps["variant"] = "default",
  isLocked?: boolean,
  isFiftyFiftyDisabled?: boolean,
) => {
  if (isFiftyFiftyDisabled) {
    return "opacity-35 cursor-not-allowed bg-candy-cloud/60 border-candy-ink/30 text-candy-ink/40 shadow-none line-through";
  }
  if (variant === "correct") {
    return "bg-candy-mint text-candy-ink border-candy-ink animate-jelly-wobble shadow-[4px_4px_0_0_#2B2D42]";
  }
  if (variant === "incorrect") {
    return "bg-candy-red text-white border-candy-ink animate-shake shadow-[4px_4px_0_0_#2B2D42]";
  }
  if (isLocked) {
    return "opacity-60 cursor-not-allowed bg-candy-yellow/20 border-candy-orange text-candy-ink/70 shadow-[2px_2px_0_0_#2B2D42]";
  }
  switch (variant) {
    case "default":
      return "bg-white border-candy-ink text-candy-ink hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_#2B2D42] shadow-[4px_4px_0_0_#2B2D42]";
    case "selected":
      return "bg-candy-pink text-candy-ink border-candy-ink translate-y-[2px] shadow-[2px_2px_0_0_#2B2D42]";
    case "disabled":
      return "opacity-45 cursor-not-allowed bg-candy-cloud border-candy-ink/40 text-candy-ink/50 shadow-none";
    default:
      return assertNever(variant);
  }
};

const getBadgeStyles = (variant: AnswerTileProps["variant"] = "default") => {
  switch (variant) {
    case "correct":
      return "bg-white text-candy-mint";
    case "incorrect":
      return "bg-white text-candy-red";
    case "selected":
      return "bg-white text-candy-pink";
    default:
      return "bg-candy-cloud text-candy-ink";
  }
};

export const AnswerTile: React.FC<AnswerTileProps> = ({
  option,
  content,
  variant = "default",
  onClick,
  disabled = false,
  isLocked = false,
  isFiftyFiftyDisabled = false,
  isFakeFlagged = false,
  className = "",
}) => {
  const t = useTranslations("Game");
  const isInteractive =
    variant !== "disabled" &&
    !disabled &&
    !isLocked &&
    !isFiftyFiftyDisabled &&
    Boolean(onClick);
  const currentVariant = variant;

  return (
    <button
      type="button"
      data-sfx="select_answer"
      onClick={isInteractive ? onClick : undefined}
      disabled={!isInteractive}
      className={cn(
        "w-full select-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow transition-all duration-150 active:translate-y-[2px]",
        !isInteractive && "active:translate-y-0 cursor-not-allowed",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center gap-4 p-4 min-h-[72px] transition-all duration-300 rounded-2xl border-[3.5px] relative overflow-hidden",
          getVariantStyles(currentVariant, isLocked, isFiftyFiftyDisabled),
          isFakeFlagged &&
            "ring-2 ring-candy-pink ring-offset-2 border-candy-pink",
        )}
      >
        {/* Dynamic Option Badge */}
        <span
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-xl font-display font-black text-lg border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] transition-all duration-300 shrink-0",
            getBadgeStyles(currentVariant),
          )}
        >
          {isLocked ? (
            <>
              <CardGlyph
                variant="lock"
                size={16}
                className="text-candy-orange animate-pulse"
              />
              <span className="sr-only">{option}</span>
            </>
          ) : isFiftyFiftyDisabled ? (
            <>
              <CardGlyph
                variant="fiftyFifty"
                size={16}
                className="text-candy-red opacity-60"
              />
              <span className="sr-only">{option}</span>
            </>
          ) : (
            option
          )}
        </span>

        {/* Answer Text Content */}
        <span className="flex-1 font-sans font-bold text-base text-left tracking-wide leading-relaxed">
          {content}
        </span>

        {/* Locked Banner Pill */}
        {isLocked && (
          <span className="absolute right-3 top-2 text-[9px] font-black uppercase text-candy-orange bg-candy-yellow/30 border border-candy-orange/40 px-1.5 py-0.5 rounded shadow-sm">
            {t("lockedBadge")}
          </span>
        )}

        {/* Fake Flag Marker (CB-6) */}
        {isFakeFlagged && (
          <span
            className={cn(
              "absolute flex items-center gap-1 text-[9px] font-black uppercase text-candy-pink bg-candy-pink/15 border border-candy-pink/40 px-1.5 py-0.5 rounded shadow-xs animate-bounce",
              isLocked ? "right-3 bottom-2" : "right-3 top-2",
            )}
          >
            <CardGlyph variant="flag" size={12} className="text-candy-pink" />
            <span>{t("fakeFlagBadge")}</span>
          </span>
        )}
      </span>
    </button>
  );
};

AnswerTile.displayName = "AnswerTile";
