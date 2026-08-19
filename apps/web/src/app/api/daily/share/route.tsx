// ============================================================
// Daily Challenge — shareable OG card route.
//
// Public endpoint (no auth, no DB). The URL is built by the
// results panel from a verified submission; this route only
// validates and clamps the params it receives, then renders an
// `ImageResponse` PNG. Treating the params as untrusted input
// keeps a hostile caller from drawing arbitrary cards.
//
// Endpoint: GET /api/daily/share?score=&correct=&total=&streak=&dateKey=
// ============================================================

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The rendered PNG is cached for a day and served to every viewer, so
 * its number formatting must not depend on the Edge isolate's ambient
 * locale — otherwise the cached card could show "1,000" or "1.000"
 * depending on which region rendered it first.
 */
const OG_NUMBER_LOCALE = "en-US";

function clampInt(
  value: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isValidDateKey(value: string | null): value is string {
  if (!value || !DATE_KEY_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const score = clampInt(sp.get("score"), 0, 100_000, 0);
  const total = clampInt(sp.get("total"), 1, 5, 5);
  // `correct` must never exceed the parsed total — otherwise the
  // displayed ratio could go above 100% if the caller tampered with
  // the query string. Clamp against `total` (already parsed above) to
  // keep the percentage and the counts consistent.
  const correct = Math.min(clampInt(sp.get("correct"), 0, 5, 0), total);
  const streak = clampInt(sp.get("streak"), 0, 9_999, 0);
  const dateKey = isValidDateKey(sp.get("dateKey"))
    ? sp.get("dateKey")!
    : "today";

  const correctPct = total > 0 ? Math.round((correct / total) * 100) : 0;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#FFE45E",
        padding: "48px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#2B2D42",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 28,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        Arena of 100 — Daily
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 32,
          marginTop: 8,
          fontWeight: 700,
        }}
      >
        {dateKey}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          marginTop: 48,
          gap: 32,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            backgroundColor: "#FFFFFF",
            border: "4px solid #2B2D42",
            borderRadius: 24,
            padding: 32,
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", fontSize: 24, opacity: 0.7 }}>
            Score
          </div>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 900 }}>
            {score.toLocaleString(OG_NUMBER_LOCALE)}
          </div>
          <div style={{ display: "flex", fontSize: 22, opacity: 0.7 }}>
            {correct}/{total} correct · {correctPct}%
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#FFC6D9",
            border: "4px solid #2B2D42",
            borderRadius: 24,
            padding: 32,
            justifyContent: "center",
            alignItems: "center",
            minWidth: 240,
          }}
        >
          <svg
            viewBox="0 0 32 32"
            width={84}
            height={84}
            fill="none"
            style={{ display: "flex" }}
          >
            <path
              d="M16 2C19 6 26 10 26 18C26 24 21.5 28 16 28C10.5 28 6 24 6 18C6 13 10 9 12 7C12 9 13.5 11 15 11C13.5 8.5 14 5.5 16 2Z"
              fill="#FF4370"
              stroke="#2B2D42"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d="M16 14C18 16 20 18 20 21C20 23.5 18 25 16 25C14 25 12 23.5 12 21C12 19 14 17 16 14Z"
              fill="#FFD000"
            />
          </svg>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 900,
              marginTop: 8,
            }}
          >
            {streak}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              marginTop: 8,
              opacity: 0.8,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            streak
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          marginTop: "auto",
          fontSize: 22,
          opacity: 0.7,
        }}
      >
        Play at arena-of-100 — 5 questions every day.
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      // The image depends only on the query string — no auth, no DB,
      // no per-user state — so social crawlers can cache it for a day.
      // next/og merges any headers we pass here with its own defaults.
      headers: {
        "Cache-Control": "public, max-age=86400, immutable",
      },
    },
  );
}
