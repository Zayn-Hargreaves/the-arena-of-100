// ============================================================
// Classes - Arena of 100
// Source of truth: memory-bank/spec/class-cards-phase.md §2
// Locked 2026-07-30 as part of Phase 2 (Class + Card Hybrid).
// ============================================================

// Two classes for v1. Added to the platform Dec 2026 to keep the
// "Offensive/Defensive" attack vs defense fantasy universal without forcing
// players to learn a class before they play. Random per-match server
// assignment removes draft-phase selection bias and keeps noob
// onboarding frictionless (Decision 2).
//
// NO EXCEPTIONS — codifying this union keeps the card pool and
// bridge APIs from accidentally proliferating ("NEUTRAL", "HYBRID",
// ...) and forces the per-class card filter to be a closed compile
// time check.
export type ClassId = "CONG" | "THU";

// Display labels and tier description live in the i18n layer (the
// web client maps `ClassId` -> translation key). This file only
// owns the discriminator + the per-class card-pool filter that
// the sampling engine consumes.
//
// `compareCardId` (the canonical CardId ordering) lives in
// `cards.ts` because all consumers import the card catalog from
// there; keeping a class->cards mapping here avoids a circular
// dependency between classes.ts and cards.ts.
export const CLASS_IDS: readonly ClassId[] = Object.freeze([
  "CONG",
  "THU",
] as const);
