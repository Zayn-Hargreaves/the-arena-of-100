import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = ({
  children,
  content,
  side = "top",
  align = "center",
  sideOffset = 4,
  avoidCollisions = true,
  className,
  ...props
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  avoidCollisions?: boolean;
  className?: string;
} & Omit<TooltipPrimitive.TooltipContentProps, "content">) => {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          avoidCollisions={avoidCollisions}
          className={cn(
            "z-50 overflow-hidden rounded-md border border-surface-container-high bg-surface-container px-3 py-1.5 text-sm text-on-background shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            "select-none radix-disabled:opacity-50 radix-disabled:pointer-events-none",
            className,
          )}
          {...props}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-container-high" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
};

Tooltip.displayName = "Tooltip";

// Export individual components for more granular control
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = TooltipPrimitive.Content;
const TooltipArrow = TooltipPrimitive.Arrow;

// Export the primitive components for advanced usage
export {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  TooltipArrow,
  TooltipPrimitive,
};
