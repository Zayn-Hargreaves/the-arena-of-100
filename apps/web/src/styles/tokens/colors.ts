// Design System Color Tokens
// Candy color palette

export const COLORS = {
  candyInk: "#2B2D42", // Boundaries, outlines, solid ink text
  candyPink: "#FF85A2", // Accents, brand, streaks
  candyYellow: "#FFD000", // Gold stars, primary CTA, rank 1
  candyMint: "#2EC4B6", // Correct feedback, green lights
  candyBlue: "#3A86C8", // Info overlays, lobby headers
  candyRed: "#EF476F", // Eliminates, errors, sudden death danger
  candyPurple: "#A29BFE", // Matchmaking, mystery cards
  candyOrange: "#FF7A00", // Timer warning, queue states
  candyCloud: "#FDF0ED", // Soft contrast, active selections
  background: "#FFFFFF",
  white: "#FFFFFF",
} as const;

export type ColorToken = keyof typeof COLORS;
