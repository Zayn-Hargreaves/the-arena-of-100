import React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "online" | "eliminated" | "admin" | "warning" | "default";
  size?: "sm" | "md" | "lg";
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}

const variantClasses = {
  online: "bg-candy-mint text-candy-ink",
  eliminated: "bg-candy-red text-white",
  admin: "bg-candy-pink text-white",
  warning: "bg-candy-orange text-white",
  default: "bg-candy-cloud text-candy-ink",
};

const sizeClasses = {
  sm: "text-xs px-2 py-1 leading-4",
  md: "text-sm px-3 py-1.5 leading-5",
  lg: "text-base px-4 py-2 leading-5",
};

const iconSizeClasses = {
  sm: "w-3 h-3",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = "default",
      size = "md",
      icon: Icon,
      children,
      className = "",
      ...props
    },
    ref,
  ) => {
    const baseClass = variantClasses[variant];
    const sizeClass = sizeClasses[size];
    const iconClass = iconSizeClasses[size] || iconSizeClasses.md;

    const combinedClassName = cn(
      baseClass,
      sizeClass,
      "inline-flex items-center justify-center rounded-full font-display font-bold tracking-wide border-3 border-candy-ink whitespace-nowrap",
      className,
    );

    return (
      <span ref={ref} className={combinedClassName} {...props}>
        {Icon && <Icon className={`mr-1 ${iconClass}`} />}
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";
