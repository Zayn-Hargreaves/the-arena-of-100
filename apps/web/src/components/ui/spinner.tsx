import React from "react";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-4 h-4", // 16px
  md: "w-5 h-5", // 20px
  lg: "w-10 h-10", // 40px
};

const borderWidthClasses = {
  sm: "border-2",
  md: "border-2",
  lg: "border-4",
};

export const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ size = "md", className = "" }, ref) => {
    const sizeClass = sizeClasses[size];
    const borderClass = borderWidthClasses[size];
    const baseClasses = [
      "inline-block",
      sizeClass,
      borderClass,
      "border-solid",
      "border-current",
      "border-r-transparent",
      "rounded-full",
      "animate-spin",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        ref={ref}
        className={baseClasses}
        role="status"
        aria-label="Đang tải"
      />
    );
  },
);

Spinner.displayName = "Spinner";
