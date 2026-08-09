import React from "react";
import { COLORS } from "@/styles/tokens/colors";

/**
 * Tiny SVG icons for the Daily Challenge surface.
 *
 * Style notes — these deliberately diverge from `<MiniGlyph>` (which
 * uses 1.8-stroke Lucide-style outlines for inline utility icons).
 * The Daily Challenge surface is the project's most expressive piece
 * — it carries the candy/neobrutalist identity (heavy ink borders,
 * hard offset shadows, candy fills). The icons here are sized and
 * shaped to match that vocabulary:
 *
 *   - `strokeWidth={2.4}` (vs MiniGlyph's 1.8) — sits in the same
 *     visual weight as the `border-[2px]` boxes they live inside.
 *   - Closed single-path silhouettes (no separate inner detail
 *     strokes) — reads as a "stamp" / "sticker", not a thin outline.
 *   - Filled accents use a fixed `candy-yellow` for the inner
 *     highlight, matching the design system's accent pattern
 *     (e.g. `bg-candy-yellow/30` rings around chips).
 *   - `currentColor` for primary color so callers tint with
 *     `text-candy-pink`, `text-candy-ink`, etc.
 */

const STROKE = 2.4;

interface GlyphProps {
  className?: string;
  /** Used by callers that need a fixed pixel size (e.g. badge rows). */
  size?: number;
}

function svgBase(
  size: number,
  className: string | undefined,
  children: React.ReactNode,
): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Flame "stamp" — a single closed silhouette inspired by sticker
 * outlines, with a small inner yellow "wick" cutout that picks up
 * the candy-yellow accent used elsewhere on the daily surface.
 */
export function StreakGlyph({ className, size = 14 }: Readonly<GlyphProps>) {
  // Outer flame is the currentColor stroke; the inner cutout is a
  // filled candy-yellow dot so the glyph reads as "lit".
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {/* Outer flame silhouette */}
      <path
        d="M12 2.5c2 2.8 5 5.5 5 9.5a5 5 0 1 1-10 0c0-1.8 1-3.2 2-4.2-.2 1.1.6 2.2 1.8 2.2-1.2-1.4-.6-4 .2-7.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      {/* Inner "wick" — candy-yellow from the design token. */}
      <ellipse
        cx="12"
        cy="13"
        rx="1.6"
        ry="2.4"
        fill={COLORS.candyYellow}
        stroke="none"
      />
    </svg>
  );
}

/**
 * Hourglass "stamp" — geometric bowtie silhouette with two thick
 * horizontal caps. Drawn as a single closed path so the outline
 * reads as one shape rather than a stack of strokes.
 */
export function CountdownGlyph({ className, size = 14 }: Readonly<GlyphProps>) {
  return svgBase(
    size,
    className,
    // Closed hourglass silhouette: top cap -> bowtie waist -> bottom cap.
    <path d="M5 3h14M5 21h14M6 3c0 5 6 6 6 9 0 3-6 4-6 9M18 3c0 5-6 6-6 9 0 3 6 4 6 9" />,
  );
}

/**
 * Bold check — single confident stroke at the project's accent
 * weight. No extra decoration so it doesn't compete with the
 * candy-mint parent chip.
 */
export function CheckGlyph({ className, size = 16 }: Readonly<GlyphProps>) {
  return svgBase(size, className, <path d="M5 12.5l4.2 4.2L19 7" />);
}

/**
 * Bold cross — two strokes at the same accent weight as CheckGlyph
 * so the correct / wrong pair visually balance.
 */
export function CrossGlyph({ className, size = 16 }: Readonly<GlyphProps>) {
  return svgBase(
    size,
    className,
    <>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </>,
  );
}
