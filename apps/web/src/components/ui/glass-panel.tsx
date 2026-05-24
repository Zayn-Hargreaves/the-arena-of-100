import React from "react";

export interface GlassPanelProps {
  variant?: "default" | "secondary" | "elevated";
  glow?: "none" | "primary" | "secondary" | "tertiary" | "error";
  children: React.ReactNode;
  className?: string;
}

const variantClasses = {
  default: "glass-panel",
  secondary: "glass-panel-secondary",
  elevated: "bg-surface-container-high",
};

const glowClasses = {
  none: "",
  primary: "glow-primary",
  secondary: "glow-secondary",
  tertiary: "glow-tertiary",
  error: "glow-error",
};

export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ variant = "default", glow = "none", children, className = "" }, ref) => {
    const baseClass = variantClasses[variant];
    const glowClass = glowClasses[glow];
    const combinedClassName = `${baseClass} ${glowClass} ${className}`.trim();

    return (
      <div ref={ref} className={combinedClassName}>
        {children}
      </div>
    );
  },
);

GlassPanel.displayName = "GlassPanel";
