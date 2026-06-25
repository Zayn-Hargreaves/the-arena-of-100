"use client";

import Image from "next/image";
import React, { useState } from "react";
import { Skeleton } from "./skeleton";
import { cn } from "@/lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  status?: "online" | "eliminated" | "offline";
  glow?: "primary" | "secondary" | "tertiary" | "error" | "none";
}

const sizeClasses = {
  xs: "w-6 h-6 text-xs",
  sm: "w-8 h-8 text-sm",
  md: "w-10 h-10 text-base",
  lg: "w-12 h-12 text-lg",
  xl: "w-16 h-16 text-xl",
};

const avatarSizePx = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
} as const;

const statusIndicatorClasses = {
  online: "bg-candy-mint border-2 border-candy-ink",
  eliminated: "bg-candy-red border-2 border-candy-ink",
  offline: "bg-candy-cloud border-2 border-candy-ink",
};

const glowClasses = {
  primary: "border-3 border-candy-pink",
  secondary: "border-3 border-candy-blue",
  tertiary: "border-3 border-candy-yellow",
  error: "border-3 border-candy-red",
  none: "border-3 border-candy-ink",
};

const statusIndicatorSizes = {
  xs: "0.5rem",
  sm: "0.625rem",
  md: "0.75rem",
  lg: "0.875rem",
  xl: "1rem",
};

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

const getInitials = (name?: string): string => {
  if (!name) return "?";
  const names = name.trim().split(" ");
  let initials = names[0].substring(0, 1).toUpperCase();

  if (names.length > 1) {
    initials += names[names.length - 1].substring(0, 1).toUpperCase();
  }

  return initials.substring(0, 2);
};

const getDeterministicSVG = (name: string): React.ReactElement => {
  const hash = hashString(name);

  // Candy 3D Jelly UI colors
  const colors = [
    "#FF85A2",
    "#FFD000",
    "#2EC4B6",
    "#3A86C8",
    "#EF476F",
    "#A29BFE",
  ];
  const mainColor = colors[hash % colors.length];
  const secondaryColor = colors[(hash + 1) % colors.length];
  const backgroundColor = "#FFFFFF";
  const patternType = hash % 4;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      className="absolute inset-0 w-full h-full select-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background */}
      <rect width="100" height="100" fill={backgroundColor} />

      {/* Playful Patterns */}
      {patternType === 0 && (
        // Pattern 0: Candy Stripes
        <g stroke={mainColor} strokeWidth="2" opacity="0.7" fill="none">
          <line x1="10" y1="20" x2="90" y2="20" />
          <line x1="10" y1="40" x2="90" y2="40" />
          <line x1="10" y1="60" x2="90" y2="60" />
          <line x1="10" y1="80" x2="90" y2="80" />
        </g>
      )}
      {patternType === 1 && (
        // Pattern 1: Circles and Dots
        <g fill={mainColor} opacity="0.6">
          <circle cx="30" cy="30" r="15" />
          <circle cx="70" cy="70" r="15" fill={secondaryColor} />
          <circle cx="50" cy="50" r="8" />
        </g>
      )}
      {patternType === 2 && (
        // Pattern 2: Triangles
        <g fill={mainColor} opacity="0.5">
          <polygon points="50,15 85,85 15,85" />
          <polygon points="50,35 70,75 30,75" fill={secondaryColor} />
        </g>
      )}
      {patternType === 3 && (
        // Pattern 3: Hearts
        <g fill={mainColor} opacity="0.6">
          <path d="M50,30 C50,20 30,10 30,30 C30,50 50,60 50,60 C50,60 70,50 70,30 C70,10 50,20 50,30" />
        </g>
      )}
    </svg>
  );
};

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      src,
      alt = "",
      fallback,
      size = "md",
      status,
      glow = "none",
      className = "",
      ...rest
    },
    ref,
  ) => {
    const sizeClass = sizeClasses[size];
    const glowClass = glowClasses[glow];
    const sizePx = avatarSizePx[size];
    const [imageError, setImageError] = useState(false);
    const combinedClassName = cn(
      "relative inline-flex items-center justify-center rounded-full overflow-hidden select-none bg-background",
      sizeClass,
      glowClass,
      className,
    );

    return (
      <div ref={ref} className={combinedClassName} {...rest}>
        {src && !imageError && (
          <Image
            src={src}
            alt={alt}
            width={sizePx}
            height={sizePx}
            className="w-full h-full object-cover"
            onError={() => {
              setImageError(true);
            }}
          />
        )}

        {(imageError || !src) && fallback && (
          <div
            className="w-full h-full flex items-center justify-center text-white relative"
            aria-label={fallback}
          >
            {getDeterministicSVG(fallback)}
            <span className="relative font-display font-bold select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] tracking-tight">
              {getInitials(fallback)}
            </span>
          </div>
        )}

        {(!src || imageError) && !fallback && (
          <Skeleton
            variant="circle"
            width={`${sizePx}px`}
            height={`${sizePx}px`}
            className={sizeClass}
          />
        )}

        {status && (
          <span
            className={`absolute bottom-0 right-0 block rounded-full border border-background z-10 ${
              statusIndicatorClasses[status]
            }`}
            style={{
              width: statusIndicatorSizes[size],
              height: statusIndicatorSizes[size],
            }}
          />
        )}
      </div>
    );
  },
);

Avatar.displayName = "Avatar";
