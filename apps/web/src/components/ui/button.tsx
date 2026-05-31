import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ComponentType<{ className?: string }>;
  rightIcon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}

const buttonVariants = cva(
  [
    "jelly-btn",
    "font-display",
    "font-bold",
    "uppercase",
    "tracking-wider",
    "focus:outline-none",
    "transition-all",
    "duration-200",
    "flex",
    "items-center",
    "justify-center",
    "gap-2",
    "disabled:opacity-50",
    "disabled:cursor-not-allowed",
  ],
  {
    variants: {
      variant: {
        action:
          "bg-candy-mint text-candy-ink hover:bg-candy-mint/90 border-3 border-candy-ink focus-visible:ring-2 focus-visible:ring-candy-mint transition-all duration-200",
        primary:
          "bg-candy-yellow text-candy-ink hover:bg-candy-yellow/90 border-3 border-candy-ink focus-visible:ring-2 focus-visible:ring-candy-yellow transition-all duration-200",
        secondary:
          "bg-candy-blue text-white hover:bg-candy-blue/90 border-3 border-candy-ink focus-visible:ring-2 focus-visible:ring-candy-blue transition-all duration-200",
        danger:
          "bg-candy-red text-white hover:bg-candy-red/90 border-3 border-candy-ink focus-visible:ring-2 focus-visible:ring-candy-red transition-all duration-200",
        ghost:
          "bg-transparent text-candy-ink hover:bg-candy-cloud active:bg-candy-cloud border-3 border-candy-ink focus-visible:ring-2 focus-visible:ring-candy-ink transition-all duration-200",
        icon: "bg-transparent text-candy-ink hover:bg-candy-cloud border-3 border-candy-ink focus-visible:ring-2 focus-visible:ring-candy-ink transition-all duration-200 p-2 rounded-xl",
      },
      size: {
        sm: "text-sm px-3 py-1.5",
        md: "text-base px-4 py-2",
        lg: "text-lg px-6 py-3",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

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
      fullWidth,
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

    const combinedClassName = cn(
      buttonVariants({ variant, size, fullWidth }),
      className,
    );

    return (
      <button
        ref={ref}
        className={combinedClassName}
        disabled={isDisabled}
        {...props}
      >
        {isLoading && (
          <Spinner
            size={size === "lg" ? "md" : "sm"}
            className="text-current"
          />
        )}
        {!isLoading && LeftIcon && (
          <LeftIcon className={iconSizeClasses[size ?? "md"]} />
        )}
        <span className={isLoading ? "opacity-0" : "opacity-100"}>
          {children}
        </span>
        {!isLoading && RightIcon && (
          <RightIcon className={iconSizeClasses[size ?? "md"]} />
        )}
      </button>
    );
  },
);

Button.displayName = "Button";
