import React from "react";

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
    <div className={`flex flex-col ${className}`}>
      <label
        htmlFor={id}
        className={`mb-1 text-sm font-medium ${
          error ? "text-error" : "text-on-background"
        }`}
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </span>
      )}
    </div>
  );
};

FormField.displayName = "FormField";
