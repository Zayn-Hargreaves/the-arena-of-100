"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface ProfessorDialogueBoxProps extends React.HTMLAttributes<HTMLDivElement> {
  text: string;
  tailPosition?: "left" | "right" | "bottom" | "top";
  variant?: "chalkboard" | "paper" | "warning";
  onDismiss?: () => void;
}

const variantStyles: Record<
  NonNullable<ProfessorDialogueBoxProps["variant"]>,
  string
> = {
  paper:
    "bg-white text-candy-ink border-candy-ink shadow-[4px_4px_0_0_#2B2D42]",
  chalkboard:
    "bg-[#1E293B] text-white border-[#334155] shadow-[4px_4px_0_0_#0F172A]",
  warning:
    "bg-[#FEF2F2] text-[#991B1B] border-[#DC2626] shadow-[4px_4px_0_0_#991B1B]",
};

const variantTailColors: Record<
  NonNullable<ProfessorDialogueBoxProps["variant"]>,
  { left: string; right: string; bottom: string; top: string }
> = {
  paper: {
    left: "border-r-candy-ink",
    right: "border-l-candy-ink",
    bottom: "border-t-candy-ink",
    top: "border-b-candy-ink",
  },
  chalkboard: {
    left: "border-r-[#334155]",
    right: "border-l-[#334155]",
    bottom: "border-t-[#334155]",
    top: "border-b-[#334155]",
  },
  warning: {
    left: "border-r-[#DC2626]",
    right: "border-l-[#DC2626]",
    bottom: "border-t-[#DC2626]",
    top: "border-b-[#DC2626]",
  },
};

export const ProfessorDialogueBox: React.FC<ProfessorDialogueBoxProps> = ({
  text,
  tailPosition = "left",
  variant = "paper",
  onDismiss,
  className,
  ...props
}) => {
  const t = useTranslations("Professor");

  return (
    <div
      className={cn(
        "relative rounded-2xl border-[3px] p-3 md:p-4 text-xs md:text-sm font-sans font-black tracking-wide leading-relaxed animate-bounce-in max-w-sm select-none",
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {/* Speech Bubble Arrow Tail */}
      {tailPosition === "left" && (
        <div
          className={cn(
            "absolute top-1/2 -left-2 -translate-y-1/2 w-0 h-0 border-y-[6px] border-y-transparent border-r-[8px]",
            variantTailColors[variant].left,
          )}
        />
      )}
      {tailPosition === "right" && (
        <div
          className={cn(
            "absolute top-1/2 -right-2 -translate-y-1/2 w-0 h-0 border-y-[6px] border-y-transparent border-l-[8px]",
            variantTailColors[variant].right,
          )}
        />
      )}
      {tailPosition === "bottom" && (
        <div
          className={cn(
            "absolute -bottom-2.5 left-6 w-0 h-0 border-x-[6px] border-x-transparent border-t-[8px]",
            variantTailColors[variant].bottom,
          )}
        />
      )}
      {tailPosition === "top" && (
        <div
          className={cn(
            "absolute -top-2.5 left-6 w-0 h-0 border-x-[6px] border-x-transparent border-b-[8px]",
            variantTailColors[variant].top,
          )}
        />
      )}

      <div className="flex items-start gap-2">
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 shrink-0 mt-0.5"
          fill="none"
        >
          <path
            d="M21 11.5C21.003 12.8199 20.6951 14.1219 20.1033 15.3025C19.5115 16.4831 18.6521 17.5097 17.593 18.3005C16.5339 19.0913 15.3029 19.6247 13.9983 19.8587C12.6937 20.0927 11.3501 20.0211 10.073 17.65L3 21L4.35 15.927C3.47353 14.3916 3.01019 12.6565 3.007 10.89C3.00381 9.12354 3.46088 7.38555 4.33235 5.8492C5.20382 4.31285 6.46387 3.02381 7.98606 2.11075C9.50825 1.19769 11.246 0.687483 13.025 0.631525C14.804 0.575567 16.5683 0.975549 18.1408 1.79155C19.7133 2.60755 21.0441 3.81504 22 5.29L21 11.5Z"
            fill="#3B82F6"
            stroke="#2B2D42"
            strokeWidth="2"
          />
        </svg>
        <p className="flex-1 font-sans font-bold text-xs md:text-sm leading-relaxed tracking-normal">
          &ldquo;{text}&rdquo;
        </p>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-candy-ink text-white text-[10px] font-mono flex items-center justify-center hover:bg-candy-red transition-colors"
          aria-label={t("closeDialogue")}
        >
          ✕
        </button>
      )}
    </div>
  );
};

ProfessorDialogueBox.displayName = "ProfessorDialogueBox";
