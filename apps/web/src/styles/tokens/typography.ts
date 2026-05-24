// Design System Typography Tokens

export const TYPOGRAPHY = {
  // Space Grotesk - Display fonts
  display: {
    lg: { fontSize: "48px", lineHeight: "1.1" }, // Hero heading
    sm: { fontSize: "36px", lineHeight: "1.1" }, // Page title
    mobile: { fontSize: "30px", lineHeight: "1.2" }, // Section heading mobile
  },
  headline: {
    md: { fontSize: "24px", lineHeight: "1.3" }, // Card heading
    sm: { fontSize: "20px", lineHeight: "1.4" }, // Sub-heading
  },

  // Inter - Body fonts
  body: {
    lg: { fontSize: "18px", lineHeight: "1.5" }, // Body large
    md: { fontSize: "16px", lineHeight: "1.5" }, // Body default
    sm: { fontSize: "14px", lineHeight: "1.5" }, // Body small, label
  },

  // Label and micro text
  label: {
    caps: { fontSize: "12px", lineHeight: "1.5" }, // Label uppercase
  },
  micro: {
    base: { fontSize: "10px", lineHeight: "1.5" }, // Stream data, micro labels
  },
} as const;

export type TypographyToken = keyof typeof TYPOGRAPHY;
