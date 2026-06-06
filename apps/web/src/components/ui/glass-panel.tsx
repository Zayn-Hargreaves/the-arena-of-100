import React from "react";
import { cn } from "@/lib/utils";

export interface GlassPanelProps {
  variant?: "default" | "secondary" | "elevated";
  children: React.ReactNode;
  className?: string;
}

const variantClasses = {
  default:
    "jelly-card rounded-2xl bg-white border-[3px] border-candy-ink/80 shadow-[4px_4px_0_0_#2B2D42]",
  secondary:
    "jelly-card rounded-2xl bg-candy-cloud border-[3px] border-candy-ink/70 shadow-[4px_4px_0_0_#2B2D42]",
  elevated:
    "jelly-card rounded-2xl bg-white border-[3px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42]",
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
