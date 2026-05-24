// Design System Spacing Tokens

export const SPACING = {
  unit: "4px", // Base unit
  gutter: "16px", // Standard gutter
  margin: {
    mobile: "20px", // Mobile horizontal margin
    desktop: "40px", // Desktop horizontal margin
  },
  section: {
    DEFAULT: "32px", // Standard section spacing
    lg: "48px", // Large section spacing
  },
  card: {
    padding: "24px", // Standard card padding
    sm: "16px", // Small card padding
  },
  icon: {
    gap: "12px", // Standard icon gap
    sm: "8px", // Small icon gap
  },
  nav: {
    height: "64px", // Navigation bar height
  },
} as const;

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}` | K
          : K
        : never;
    }[keyof T]
  : never;

export type SpacingToken = NestedKeyOf<typeof SPACING>;
