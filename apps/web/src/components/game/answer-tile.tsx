"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface AnswerTileProps {
  option: string; // E.g., "A", "B", "C", "D"
  content: string; // The answer text
  variant?: "default" | "selected" | "correct" | "incorrect" | "disabled";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const assertNever = (_value: never): never => {
  throw new Error("Unhandled answer tile variant");
};

const getVariantStyles = (variant: AnswerTileProps["variant"] = "default") => {
  switch (variant) {
    case "default":
      return "bg-white border-candy-ink text-candy-ink hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_#2B2D42] shadow-[4px_4px_0_0_#2B2D42]";
    case "selected":
      return "bg-candy-pink text-candy-ink border-candy-ink translate-y-[2px] shadow-[2px_2px_0_0_#2B2D42]";
    case "correct":
      return "bg-candy-mint text-candy-ink border-candy-ink animate-jelly-wobble shadow-[4px_4px_0_0_#2B2D42]";
    case "incorrect":
      return "bg-candy-red text-white border-candy-ink animate-shake shadow-[4px_4px_0_0_#2B2D42]";
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
  className = "",
}) => {
  const isInteractive = variant !== "disabled" && !disabled && Boolean(onClick);
  const currentVariant = disabled ? "disabled" : variant;

  return (
    <button
      type="button"
      onClick={isInteractive ? onClick : undefined}
      disabled={!isInteractive}
      className={cn(
        "w-full select-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow transition-all duration-150 active:translate-y-[2px]",
        !isInteractive && "active:translate-y-0",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center gap-4 p-4 min-h-[72px] transition-all duration-300 rounded-2xl border-[3.5px]",
          getVariantStyles(currentVariant),
        )}
      >
        {/* Dynamic Option Badge */}
        <span
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-xl font-display font-black text-lg border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] transition-all duration-300 shrink-0",
            getBadgeStyles(currentVariant),
          )}
        >
          {option}
        </span>

        {/* Answer Text Content */}
        <span className="flex-1 font-sans font-bold text-base text-left tracking-wide leading-relaxed">
          {content}
        </span>
      </span>
    </button>
  );
};

AnswerTile.displayName = "AnswerTile";
