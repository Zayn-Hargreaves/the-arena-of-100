"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface SettingsToggleButtonProps {
  value: boolean;
  onToggle: () => void;
  activeClassName: string;
  onLabel: string;
  offLabel: string;
  className?: string;
  ariaLabel?: string;
}

export function SettingsToggleButton({
  value,
  onToggle,
  activeClassName,
  onLabel,
  offLabel,
  className,
  ariaLabel,
}: Readonly<SettingsToggleButtonProps>) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={value}
      aria-label={ariaLabel}
      className={cn(
        "px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] shrink-0 cursor-pointer",
        value ? activeClassName : "bg-white text-candy-ink/60",
        className,
      )}
    >
      {value ? onLabel : offLabel}
    </button>
  );
}
