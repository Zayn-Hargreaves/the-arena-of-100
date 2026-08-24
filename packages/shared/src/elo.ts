// ============================================================
// @arena/shared - ELO & Ranking System
// Game Đấu Trường 100 - Battle Royale ELO Ratings & Rank Tiers
// ============================================================

import { z } from "zod";

export const DEFAULT_ELO = 1200;
export const DEFAULT_K_FACTOR = 32;

export const RANK_TIERS = [
  {
    tier: "BRONZE",
    minElo: 0,
    maxElo: 1199,
    i18nKey: "rank.tiers.bronze",
    badgeGlyph: "🥉",
    accentColor: "#CD7F32",
  },
  {
    tier: "SILVER",
    minElo: 1200,
    maxElo: 1399,
    i18nKey: "rank.tiers.silver",
    badgeGlyph: "🥈",
    accentColor: "#C0C0C0",
  },
  {
    tier: "GOLD",
    minElo: 1400,
    maxElo: 1599,
    i18nKey: "rank.tiers.gold",
    badgeGlyph: "🥇",
    accentColor: "#FFD700",
  },
  {
    tier: "PLATINUM",
    minElo: 1600,
    maxElo: 1799,
    i18nKey: "rank.tiers.platinum",
    badgeGlyph: "💎",
    accentColor: "#00E5FF",
  },
  {
    tier: "DIAMOND",
    minElo: 1800,
    maxElo: 1999,
    i18nKey: "rank.tiers.diamond",
    badgeGlyph: "💠",
    accentColor: "#B388FF",
  },
  {
    tier: "MASTER",
    minElo: 2000,
    maxElo: 2199,
    i18nKey: "rank.tiers.master",
    badgeGlyph: "👑",
    accentColor: "#FF4081",
  },
  {
    tier: "GRANDMASTER",
    minElo: 2200,
    maxElo: Number.POSITIVE_INFINITY,
    i18nKey: "rank.tiers.grandmaster",
    badgeGlyph: "🌟",
    accentColor: "#FFD54F",
  },
] as const;

export type RankTier = (typeof RANK_TIERS)[number]["tier"];

export const RankTier = Object.fromEntries(
  RANK_TIERS.map((t) => [t.tier, t.tier]),
) as { readonly [K in RankTier]: K };

export const DEFAULT_RANK_TIER: RankTier = "SILVER";

export const rankTierNames = RANK_TIERS.map((t) => t.tier) as unknown as [
  RankTier,
  ...RankTier[],
];

export const rankTierSchema = z.enum(rankTierNames);

export interface RankTierInfo {
  tier: RankTier;
  minElo: number;
  maxElo: number;
  i18nKey: string;
  badgeGlyph: string;
  accentColor: string;
}

/**
 * Determine the RankTier corresponding to a given numeric ELO rating.
 */
export function getRankTier(elo: number): RankTier {
  const safeElo = Math.max(0, Number.isFinite(elo) ? Math.floor(elo) : 0);
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (safeElo >= RANK_TIERS[i].minElo) {
      return RANK_TIERS[i].tier;
    }
  }
  return RANK_TIERS[0].tier;
}

const DEFAULT_RANK_TIER_INFO: RankTierInfo =
  RANK_TIERS.find((t) => t.tier === DEFAULT_RANK_TIER) ?? RANK_TIERS[0];

const RANK_TIER_MAP = new Map<RankTier, RankTierInfo>(
  RANK_TIERS.map((t) => [t.tier, t]),
);

/**
 * Retrieve metadata details for a given RankTier.
 */
export function getRankTierInfo(tier: RankTier): RankTierInfo {
  return RANK_TIER_MAP.get(tier) ?? DEFAULT_RANK_TIER_INFO;
}
