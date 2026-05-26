import type { Config } from "tailwindcss";
import { ANIMATION_VARIABLES } from "./src/styles/tokens/animations";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary - Purple (Player identity, CTA chính, streak, level-up)
        primary: "#ecb2ff",
        "on-primary": "#2f0049",
        "primary-container": "#4a1d6a",
        "on-primary-container": "#f3d9ff",

        // Secondary - Cyan (Tech, data, active indicator)
        "secondary-fixed": "#7df4ff",
        "on-secondary-fixed": "#00363a",
        "secondary-container": "#00eefc",
        "on-secondary-container": "#002022",

        // Tertiary - Yellow (Timer <25%, warning, sudden death)
        tertiary: "#e9c400",
        "on-tertiary": "#3a3000",

        // Error - Red (Eliminate, kick, kill switch)
        error: "#ffb4ab",
        "on-error": "#690005",

        // Arena custom colors
        arena: {
          primary: "#ff6b35",
          secondary: "#4ecdc4",
          danger: "#ff4757",
        },

        // Background and surfaces
        background: "#05060B",
        "on-background": "#e4e1e6",
        "surface-dim": "#12131c",
        "surface-container": "#1a1b26",
        "surface-container-high": "#252640",
        "surface-container-highest": "#30314b",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      spacing: {
        unit: "4px",
        gutter: "16px",
        "margin-mobile": "20px",
        "margin-desktop": "40px",
        section: "32px",
        "section-lg": "48px",
        "card-padding": "24px",
        "card-padding-sm": "16px",
        "icon-gap": "12px",
        "icon-gap-sm": "8px",
        "nav-height": "64px",
      },
      fontSize: {
        // Space Grotesk - Display fonts
        "5xl": ["48px", { lineHeight: "1.1" }], // display-lg
        "4xl": ["36px", { lineHeight: "1.1" }], // display-sm
        "3xl": ["30px", { lineHeight: "1.2" }], // display-mobile
        "2xl": ["24px", { lineHeight: "1.3" }], // headline-md
        xl: ["20px", { lineHeight: "1.4" }], // headline-sm

        // Inter - Body fonts
        lg: ["18px", { lineHeight: "1.5" }], // body-lg
        base: ["16px", { lineHeight: "1.5" }], // body-md
        sm: ["14px", { lineHeight: "1.5" }], // body-sm
        xs: ["12px", { lineHeight: "1.5" }], // label-caps

        // JetBrains Mono - Mono font
        micro: ["10px", { lineHeight: "1.5" }],
      },
      animation: {
        flicker: "flicker 150ms infinite steps(2)",
        "pulse-warning": "pulse-warning 1s infinite ease-in-out",
        shake: "shake 400ms ease-in-out",
        "slide-up": "slide-up 300ms ease-out",
        "fade-in": "fade-in 200ms ease-out",
        shimmer: "shimmer 2s infinite linear",
        "pulse-fast": "pulse 0.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "bounce-in": "bounceIn 0.5s ease-out",
      },
      transitionDuration: {
        normal: ANIMATION_VARIABLES.duration.normal,
        slow: ANIMATION_VARIABLES.duration.slow,
        dramatic: ANIMATION_VARIABLES.duration.dramatic,
      },
      transitionTimingFunction: {
        standard: ANIMATION_VARIABLES.easing.default,
        decelerate: ANIMATION_VARIABLES.easing.out,
        accelerate: ANIMATION_VARIABLES.easing.accelerate,
        bounce: ANIMATION_VARIABLES.easing.bounce,
      },
      keyframes: {
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "pulse-warning": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-5px)" },
          "75%": { transform: "translateX(5px)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        // Keep existing keyframes for backward compatibility
        bounceIn: {
          "0%": { transform: "scale(0.3)", opacity: "0" },
          "50%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
