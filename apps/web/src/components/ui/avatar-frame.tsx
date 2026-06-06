"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface AvatarFrameProps {
  children: React.ReactNode;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export const AvatarFrame: React.FC<AvatarFrameProps> = ({
  children,
  size = "md",
  className,
}) => {
  const sizeClasses = {
    xs: "w-8 h-8 rounded-lg border-[1.5px] shadow-[1px_1px_0_0_#2B2D42]",
    sm: "w-10 h-10 rounded-lg border-[2.5px] shadow-[2px_2px_0_0_#2B2D42]",
    md: "w-12 h-12 rounded-xl border-[2.5px] shadow-[2px_2px_0_0_#2B2D42]",
    lg: "w-16 h-16 rounded-2xl border-[3px] shadow-[3px_3px_0_0_#2B2D42]",
  };

  return (
    <div
      className={cn(
        "shrink-0 border-candy-ink bg-candy-cloud overflow-hidden flex items-center justify-center relative",
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </div>
  );
};
