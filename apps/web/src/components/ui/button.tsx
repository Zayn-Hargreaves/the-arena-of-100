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
  ],
  {
    variants: {
      variant: {
        action:
          "bg-secondary-container text-on-secondary-container hover:brightness-110 hover:animate-flicker hover:shadow-[0_0_25px_var(--secondary-container)] active:scale-95 active:brightness-90 border border-secondary-container focus-visible:ring-2 focus-visible:ring-secondary-fixed transition-all duration-200",
        primary:
          "bg-primary text-on-primary hover:brightness-110 active:scale-95 border border-primary focus-visible:ring-2 focus-visible:ring-secondary-fixed transition-all duration-200",
        secondary:
          "bg-surface-container-high text-secondary-fixed hover:bg-surface-container-highest active:scale-95 border border-surface-container-high focus-visible:ring-2 focus-visible:ring-secondary-fixed transition-all duration-200",
        danger:
          "bg-error text-on-error hover:brightness-110 active:scale-95 border border-error focus-visible:ring-2 focus-visible:ring-secondary-fixed transition-all duration-200",
        ghost:
          "bg-transparent text-on-background hover:bg-surface-container/50 active:bg-surface-container border border-transparent focus-visible:ring-2 focus-visible:ring-secondary-fixed transition-all duration-200",
        icon: "bg-transparent text-on-background hover:bg-surface-container/50 active:scale-90 border border-transparent focus-visible:ring-2 focus-visible:ring-secondary-fixed transition-all duration-200 p-2 rounded-md",
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
