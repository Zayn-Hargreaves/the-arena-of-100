import React from "react";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-10 h-10",
};

// Note: sm and md intentionally share `border-2` so the smaller spinners
// keep a proportionally thicker border for visual balance. lg drops to
// `border-4` only because its larger size would otherwise feel heavy.
const borderWidthClasses = {
  sm: "border-2",
  md: "border-2",
  lg: "border-4",
};

export const Spinner = React.forwardRef<HTMLOutputElement, SpinnerProps>(
  ({ size = "md", className = "", label = "Đang tải" }, ref) => {
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
      <output ref={ref} className={baseClasses}>
        <span className="sr-only">{label}</span>
      </output>
    );
  },
);

Spinner.displayName = "Spinner";
