import React from "react";

export interface BadgeProps {
  variant?: "online" | "eliminated" | "admin" | "warning" | "default";
  size?: "sm" | "md" | "lg";
  glow?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}

const variantClasses = {
  online: "bg-secondary-container text-on-secondary-container",
  eliminated: "bg-error text-on-error",
  admin: "bg-primary text-on-primary",
  warning: "bg-tertiary text-on-tertiary",
  default: "bg-surface-container text-on-background",
};

const glowClasses = {
  online: "glow-secondary",
  eliminated: "glow-error",
  admin: "glow-primary",
  warning: "glow-tertiary",
  default: "",
};

const sizeClasses = {
  sm: "text-xs px-2 py-0.5",
  md: "text-sm px-3 py-1",
  lg: "text-base px-4 py-1.5",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = "default",
      size = "md",
      glow = false,
      icon: Icon,
      children,
      className = "",
    },
    ref,
  ) => {
    const baseClass = variantClasses[variant];
    const glowClass = glow ? glowClasses[variant] : "";
    const sizeClass = sizeClasses[size];

    const combinedClassName =
      `${baseClass} ${glowClass} ${sizeClass} inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap ${className}`.trim();

    return (
      <span ref={ref} className={combinedClassName}>
        {Icon && (
          <Icon
            className={`mr-1 ${size === "sm" ? "w-3 h-3" : size === "md" ? "w-4 h-4" : "w-5 h-5"}`}
          />
        )}
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";
