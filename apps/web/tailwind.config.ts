import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { ANIMATION_VARIABLES } from "./src/styles/tokens/animations";
import { COLORS } from "./src/styles/tokens/colors";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Candy 3D Jelly UI color palette
        background: COLORS.background,
        "candy-ink": COLORS.candyInk,
        "candy-pink": COLORS.candyPink,
        "candy-yellow": COLORS.candyYellow,
        "candy-mint": COLORS.candyMint,
        "candy-blue": COLORS.candyBlue,
        "candy-red": COLORS.candyRed,
        "candy-purple": COLORS.candyPurple,
        "candy-orange": COLORS.candyOrange,
        "candy-cloud": COLORS.candyCloud,
        white: COLORS.background,
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-sans)", "sans-serif"],
        hand: ["var(--font-hand)", "cursive"],
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
        "pulse-fast": "pulse 0.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "bounce-in": "bounceIn 0.5s ease-out",
        "jelly-wobble": "wobble 0.6s ease-in-out",
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
        bounceIn: {
          "0%": { transform: "scale(0.3)", opacity: "0" },
          "50%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        wobble: {
          "0%, 100%": { transform: "scale3d(1, 1, 1)" },
          "30%": { transform: "scale3d(1.15, 0.85, 1)" },
          "40%": { transform: "scale3d(0.85, 1.15, 1)" },
          "50%": { transform: "scale3d(1.10, 0.90, 1)" },
          "65%": { transform: "scale3d(0.95, 1.05, 1)" },
          "75%": { transform: "scale3d(1.02, 0.98, 1)" },
        },
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    plugin(({ addUtilities }) => {
      addUtilities({
        // Candy 3D Jelly UI utilities are in globals.css
      });
    }),
  ],
};

export default config;
