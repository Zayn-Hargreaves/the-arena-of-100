import React from "react";
import { cn } from "@/lib/utils";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ orientation = "horizontal", className = "" }, ref) => {
    const isHorizontal = orientation === "horizontal";
    const baseClasses = isHorizontal
      ? "w-full h-1 bg-candy-ink/30"
      : "h-full w-1 bg-candy-ink/30";

    const combinedClassName = cn(baseClasses, className);

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
