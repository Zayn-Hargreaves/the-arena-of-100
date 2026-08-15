// ============================================================
// @arena/shared - ELO & Ranking System
// Game Đấu Trường 100 - Battle Royale ELO Ratings & Rank Tiers
// ============================================================

import { z } from "zod";

export const DEFAULT_ELO = 1200;
export const DEFAULT_K_FACTOR = 32;

export const RankTier = {
  BRONZE: "BRONZE",
  SILVER: "SILVER",
  GOLD: "GOLD",
  PLATINUM: "PLATINUM",
  DIAMOND: "DIAMOND",
  MASTER: "MASTER",
  GRANDMASTER: "GRANDMASTER",
} as const;

export type RankTier = (typeof RankTier)[keyof typeof RankTier];

export const rankTierSchema = z.enum([
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
]);

export interface RankTierInfo {
  tier: RankTier;
  minElo: number;
  maxElo: number;
  i18nKey: string;
  badgeGlyph: string;
  accentColor: string;
}

export const RANK_TIERS: readonly RankTierInfo[] = [
  {
    tier: RankTier.BRONZE,
    minElo: 0,
    maxElo: 1199,
    i18nKey: "rank.tiers.bronze",
    badgeGlyph: "🥉",
    accentColor: "#CD7F32",
  },
  {
    tier: RankTier.SILVER,
    minElo: 1200,
    maxElo: 1399,
    i18nKey: "rank.tiers.silver",
    badgeGlyph: "🥈",
    accentColor: "#C0C0C0",
  },
  {
    tier: RankTier.GOLD,
    minElo: 1400,
    maxElo: 1599,
    i18nKey: "rank.tiers.gold",
    badgeGlyph: "🥇",
    accentColor: "#FFD700",
  },
  {
    tier: RankTier.PLATINUM,
    minElo: 1600,
    maxElo: 1799,
    i18nKey: "rank.tiers.platinum",
    badgeGlyph: "💎",
    accentColor: "#00E5FF",
  },
  {
    tier: RankTier.DIAMOND,
    minElo: 1800,
    maxElo: 1999,
    i18nKey: "rank.tiers.diamond",
    badgeGlyph: "💠",
    accentColor: "#B388FF",
  },
  {
    tier: RankTier.MASTER,
    minElo: 2000,
    maxElo: 2199,
    i18nKey: "rank.tiers.master",
    badgeGlyph: "👑",
    accentColor: "#FF4081",
  },
  {
    tier: RankTier.GRANDMASTER,
    minElo: 2200,
    maxElo: Infinity,
    i18nKey: "rank.tiers.grandmaster",
    badgeGlyph: "🌟",
    accentColor: "#FFD54F",
  },
] as const;

/**
 * Determine the RankTier corresponding to a given numeric ELO rating.
 */
export function getRankTier(elo: number): RankTier {
  const safeElo = Math.max(0, Math.floor(elo));
  if (safeElo >= 2200) return RankTier.GRANDMASTER;
  if (safeElo >= 2000) return RankTier.MASTER;
  if (safeElo >= 1800) return RankTier.DIAMOND;
  if (safeElo >= 1600) return RankTier.PLATINUM;
  if (safeElo >= 1400) return RankTier.GOLD;
  if (safeElo >= 1200) return RankTier.SILVER;
  return RankTier.BRONZE;
}

const DEFAULT_RANK_TIER_INFO: RankTierInfo = {
  tier: RankTier.SILVER,
  minElo: 1200,
  maxElo: 1399,
  i18nKey: "rank.tiers.silver",
  badgeGlyph: "🥈",
  accentColor: "#C0C0C0",
};

const RANK_TIER_MAP = new Map<RankTier, RankTierInfo>(
  RANK_TIERS.map((t) => [t.tier, t]),
);

/**
 * Retrieve metadata details for a given RankTier.
 */
export function getRankTierInfo(tier: RankTier): RankTierInfo {
  return RANK_TIER_MAP.get(tier) ?? DEFAULT_RANK_TIER_INFO;
}
