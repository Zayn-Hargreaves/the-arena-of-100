import React from "react";
import { cn } from "@/lib/utils";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export const Divider = React.forwardRef<HTMLHRElement, DividerProps>(
  ({ orientation = "horizontal", className = "" }, ref) => {
    const isHorizontal = orientation === "horizontal";
    const baseClasses = isHorizontal
      ? "w-full h-1 m-0 rounded-full bg-candy-ink/20 border-0"
      : "h-full w-1 m-0 rounded-full bg-candy-ink/20 border-0";

    const combinedClassName = cn(baseClasses, className);

    return (
      <hr
        ref={ref}
        className={combinedClassName}
        aria-orientation={orientation}
      />
    );
  },
);

Divider.displayName = "Divider";
