import React from "react";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  glow?: boolean;
  className?: string;
}

export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ orientation = "horizontal", glow = false, className = "" }, ref) => {
    const isHorizontal = orientation === "horizontal";
    const baseClasses = isHorizontal
      ? "w-full h-px bg-primary/30"
      : "h-full w-px bg-primary/30";

    const glowClass = glow ? "glow-primary" : "";
    const combinedClassName = `${baseClasses} ${glowClass} ${className}`.trim();

    return (
      <div
        ref={ref}
        className={combinedClassName}
        role="separator"
        aria-orientation={orientation}
      />
    );
  },
);

Divider.displayName = "Divider";
