import React from "react";
import { cn } from "@/lib/utils";

export interface GlassPanelProps {
  variant?: "default" | "secondary" | "elevated";
  children: React.ReactNode;
  className?: string;
}

const variantClasses = {
  default: "jelly-card rounded-2xl bg-white",
  secondary: "jelly-card rounded-2xl bg-candy-cloud",
  elevated: "jelly-card rounded-2xl bg-white shadow-xl",
};

export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ variant = "default", children, className = "" }, ref) => {
    const baseClass = variantClasses[variant];
    const combinedClassName = cn(baseClass, className);

    return (
      <div ref={ref} className={combinedClassName}>
        {children}
      </div>
    );
  },
);

GlassPanel.displayName = "GlassPanel";
