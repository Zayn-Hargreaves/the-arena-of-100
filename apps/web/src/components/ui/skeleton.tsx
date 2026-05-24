import React from "react";

export interface SkeletonProps {
  variant?: "text" | "circle" | "rect";
  width?: string;
  height?: string;
  className?: string;
}

const variantClasses = {
  text: "rounded-full",
  circle: "rounded-full",
  rect: "rounded-lg",
};

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ variant = "text", width, height, className = "" }, ref) => {
    const shapeClass = variantClasses[variant];
    const sizeStyles = {
      width: width || (variant === "circle" ? "2rem" : undefined),
      height: height || (variant === "circle" ? "2rem" : "1rem"),
    };

    const combinedClassName =
      `bg-surface-container-high animate-shimmer ${shapeClass} ${className}`.trim();

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
