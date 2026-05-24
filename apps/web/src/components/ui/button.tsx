import React from "react";
import { Spinner } from "./spinner";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "action" | "primary" | "secondary" | "danger" | "ghost" | "icon";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ComponentType<{ className?: string }>;
  rightIcon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}

const variantClasses = {
  action:
    "bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container border border-primary focus:ring-2 focus:ring-primary focus:ring-opacity-50 transition-all duration-200 shadow-lg hover:shadow-primary/30",
  primary:
    "bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed hover:text-on-secondary-fixed border border-secondary-container focus:ring-2 focus:ring-secondary-fixed focus:ring-opacity-50 transition-all duration-200",
  secondary:
    "bg-surface-container text-on-background hover:bg-surface-container-high border border-surface-container-high focus:ring-2 focus:ring-secondary-fixed focus:ring-opacity-50 transition-all duration-200",
  danger:
    "bg-error text-on-error hover:bg-error/80 border border-error focus:ring-2 focus:ring-error focus:ring-opacity-50 transition-all duration-200",
  ghost:
    "bg-transparent text-on-background hover:bg-surface-container border border-transparent focus:ring-2 focus:ring-secondary-fixed focus:ring-opacity-50 transition-all duration-200",
  icon: "bg-transparent text-on-background hover:bg-surface-container focus:ring-2 focus:ring-secondary-fixed focus:ring-opacity-50 transition-all duration-200 p-2 rounded-md",
};

const sizeClasses = {
  sm: "text-sm px-3 py-1.5",
  md: "text-base px-4 py-2",
  lg: "text-lg px-6 py-3",
};

const iconSizeClasses = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      fullWidth = false,
      leftIcon: LeftIcon,
      rightIcon: RightIcon,
      children,
      className = "",
      disabled,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;
    const baseClass = variantClasses[variant];
    const sizeClass = sizeClasses[size];
    const iconSizeClass = iconSizeClasses[size];
    const widthClass = fullWidth ? "w-full" : "";

    const baseClasses = [
      baseClass,
      sizeClass,
      widthClass,
      "font-medium",
      "rounded-md",
      "focus:outline-none",
      "transition-all",
      "duration-200",
      "flex",
      "items-center",
      "justify-center",
      "gap-2",
      "disabled:opacity-50",
      "disabled:cursor-not-allowed",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        className={baseClasses}
        disabled={isDisabled}
        {...props}
      >
        {isLoading && (
          <Spinner
            size={size === "lg" ? "md" : "sm"}
            className="text-current"
          />
        )}
        {!isLoading && LeftIcon && <LeftIcon className={iconSizeClass} />}
        <span className={isLoading ? "opacity-0" : "opacity-100"}>
          {children}
        </span>
        {!isLoading && RightIcon && <RightIcon className={iconSizeClass} />}
      </button>
    );
  },
);

Button.displayName = "Button";
