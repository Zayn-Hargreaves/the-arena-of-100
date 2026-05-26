import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "terminal" | "default";
  inputSize?: "sm" | "md" | "lg";
  error?: boolean;
  success?: boolean;
  errorMessage?: string;
  label?: string;
  fullWidth?: boolean;
}

const variantClasses = {
  terminal: {
    base: "bg-surface-dim border border-secondary-container text-secondary-fixed placeholder-secondary-container/70 focus:border-secondary-fixed focus:ring-2 focus:ring-secondary-fixed/30 focus:outline-none transition-all duration-200 font-mono",
    error: "border-error text-error focus:ring-error/30 focus:border-error",
    success:
      "border-secondary-fixed text-secondary-fixed focus:ring-secondary-fixed/30",
  },
  default: {
    base: "bg-surface-container border border-surface-container-high text-on-background placeholder-on-background/50 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none transition-all duration-200",
    error: "border-error text-error focus:ring-error/30 focus:border-error",
    success: "border-primary text-primary focus:ring-primary/30",
  },
};

const sizeClasses = {
  sm: "text-sm px-2 py-1",
  md: "text-base px-3 py-2",
  lg: "text-lg px-4 py-3",
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = "default",
      inputSize = "md",
      error = false,
      success = false,
      errorMessage,
      label,
      fullWidth = false,
      className = "",
      id,
      ...props
    },
    ref,
  ) => {
    const baseClass = variantClasses[variant].base;
    const errorClass = error ? variantClasses[variant].error : "";
    const successClass = success ? variantClasses[variant].success : "";
    const sizeClass = sizeClasses[inputSize];
    const widthClass = fullWidth ? "w-full" : "";

    const combinedClassName = cn(
      baseClass,
      errorClass,
      successClass,
      sizeClass,
      widthClass,
      "rounded-md transition-all duration-200",
      className,
    );

    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className={`flex flex-col ${fullWidth ? "w-full" : ""}`}>
        {label && (
          <label
            htmlFor={inputId}
            className={`mb-1 text-sm font-medium ${error ? "text-error" : "text-on-background"}`}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={combinedClassName}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={
            error && errorMessage ? `${inputId}-error` : undefined
          }
          {...props}
        />
        {errorMessage && error && (
          <span
            id={`${inputId}-error`}
            className="mt-1 text-xs text-error flex items-center gap-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            {errorMessage}
          </span>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
