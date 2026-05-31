import React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps {
  variant?: "text" | "circle" | "rect";
  width?: string;
  height?: string;
  className?: string;
}

const variantClasses = {
  text: "rounded",
  circle: "rounded-full",
  rect: "rounded-lg",
};

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ variant = "text", width, height, className = "" }, ref) => {
    const shapeClass = variantClasses[variant];
    const sizeStyles = {
      width,
      height: height ?? (variant === "text" ? "1rem" : undefined),
    };

    const combinedClassName = cn(
      "bg-surface-container-high animate-shimmer",
      shapeClass,
      className,
    );

    return (
      <div
        ref={ref}
        className={combinedClassName}
        style={sizeStyles}
        aria-hidden="true"
      />
    );
  },
);

Skeleton.displayName = "Skeleton";
