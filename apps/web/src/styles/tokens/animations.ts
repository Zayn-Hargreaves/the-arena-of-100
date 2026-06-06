// Design System Animation Tokens

export const ANIMATIONS = {
  flicker: {
    duration: "150ms",
    timing: "infinite steps(2)",
    usage: "Button hover, text glitch",
  },
  pulseWarning: {
    duration: "1s",
    timing: "infinite ease-in-out",
    usage: "Timer <25%, sudden death ring",
  },
  shake: {
    duration: "400ms",
    timing: "ease-in-out",
    usage: "Wrong answer feedback",
  },
  slideUp: {
    duration: "300ms",
    timing: "ease-out",
    usage: "Component enter",
  },
  fadeIn: {
    duration: "200ms",
    timing: "ease-out",
    usage: "Opacity transition",
  },
  shimmer: {
    duration: "2s",
    timing: "infinite linear",
    usage: "Skeleton loading",
  },
} as const;

export const ANIMATION_VARIABLES = {
  duration: {
    fast: "150ms",
    normal: "300ms",
    slow: "500ms",
    dramatic: "500ms",
  },
  easing: {
    default: "cubic-bezier(0.4, 0, 0.2, 1)",
    out: "cubic-bezier(0, 0, 0.2, 1)",
    accelerate: "cubic-bezier(0.4, 0, 1, 1)",
    bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
} as const;

export type AnimationToken = keyof typeof ANIMATIONS;
