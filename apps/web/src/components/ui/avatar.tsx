"use client";

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

const statusIndicatorClasses = {
  online: "bg-secondary-fixed",
  eliminated: "bg-error",
  offline: "bg-surface-container-high",
};

const glowClasses = {
  primary: "glow-primary",
  secondary: "glow-secondary",
  tertiary: "glow-tertiary",
  error: "glow-error",
  none: "",
};

const statusIndicatorSizes = {
  xs: "0.5rem",
  sm: "0.625rem",
  md: "0.75rem",
  lg: "0.875rem",
  xl: "1rem",
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
    },
    ref,
  ) => {
    const sizeClass = sizeClasses[size];
    const glowClass = glowClasses[glow];
    const [imageError, setImageError] = useState(false);
    const combinedClassName = cn(
      "relative inline-flex items-center justify-center rounded-full overflow-hidden",
      sizeClass,
      glowClass,
      className,
    );

    // Generate initials from fallback name
    const getInitials = (name?: string) => {
      if (!name) return "?";
      const names = name.split(" ");
      let initials = names[0].substring(0, 1).toUpperCase();

      if (names.length > 1) {
        initials += names[names.length - 1].substring(0, 1).toUpperCase();
      }

      return initials;
    };

    // Generate background color based on fallback
    const getBackgroundColor = () => {
      if (!fallback) return "hsl(var(--surface-container))";

      let hash = 0;
      for (let i = 0; i < fallback.length; i++) {
        hash = fallback.charCodeAt(i) + ((hash << 5) - hash);
      }

      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 70%, 40%)`;
    };

    return (
      <div ref={ref} className={combinedClassName}>
        {src && !imageError && (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => {
              setImageError(true);
            }}
          />
        )}

        {!src && fallback && (
          <div
            className="w-full h-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: getBackgroundColor() }}
            aria-label={fallback}
          >
            {getInitials(fallback)}
          </div>
        )}

        {(!src || imageError) && !fallback && (
          <Skeleton variant="circle" className={sizeClass} />
        )}

        {status && (
          <span
            className={`absolute bottom-0 right-0 block rounded-full border-2 border-background ${
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
