// Design System Color Tokens
// Cyberpunk neon palette

export const COLORS = {
  // Primary - Purple (Player identity, CTA chính, streak, level-up)
  primary: "#ecb2ff",
  onPrimary: "#2f0049",
  primaryContainer: "#4a1d6a",
  onPrimaryContainer: "#f3d9ff",

  // Secondary - Cyan (Tech, data, active indicator)
  secondaryFixed: "#7df4ff",
  onSecondaryFixed: "#00363a",
  secondaryContainer: "#00eefc",
  onSecondaryContainer: "#002022",

  // Tertiary - Yellow (Timer <25%, warning, sudden death)
  tertiary: "#e9c400",
  onTertiary: "#3a3000",

  // Error - Red (Eliminate, kick, kill switch)
  error: "#ffb4ab",
  onError: "#690005",

  // Background and surfaces
  background: "#05060B",
  onBackground: "#e4e1e6",
  surfaceDim: "#12131c",
  surfaceContainer: "#1a1b26",
  surfaceContainerHigh: "#252640",
  surfaceContainerHighest: "#30314b",
} as const;

export type ColorToken = keyof typeof COLORS;
