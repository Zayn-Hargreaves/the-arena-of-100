import React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * FormField Component
 *
 * A wrapper component that combines a label with an input field and handles
 * error messaging according to the design system.
 *
 * Usage:
 * ```tsx
 * <FormField label="Username" id="username" error={errorMessage}>
 *   <Input id="username" value={value} onChange={handleChange} />
 * </FormField>
 * ```
 */
interface FormFieldProps {
  label: string; // REQUIRED — renders <label htmlFor={id}>
  id: string;
  error?: string;
  children: React.ReactNode; // Input component
  className?: string;
}

export const FormField = ({
  label,
  id,
  error,
  children,
  className = "",
}: FormFieldProps) => {
  return (
    <div className={cn("flex flex-col", className)}>
      <label
        htmlFor={id}
        className={cn(
          "mb-1 text-sm font-medium",
          error ? "text-error" : "text-on-background",
        )}
      >
        {label}
      </label>
      {children}
      {error && (
        <span
          className="mt-1 text-xs text-error flex items-center gap-1"
          role="alert"
          aria-live="polite"
        >
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
};

FormField.displayName = "FormField";
