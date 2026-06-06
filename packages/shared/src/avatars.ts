// ============================================================
// Avatar Seeds - Single source of truth for valid avatar keys
// Shared by backend (validation) and frontend (catalog metadata)
// ============================================================

/**
 * All valid avatar seed values. Keep in sync with spritesheet assets
 * under /apps/web/public/arena_of_100/<seed>_spritesheet.webp.
 */
export const AVATAR_SEEDS = [
  "jellyfrog",
  "dario",
  "dentist",
  "nyakoshigure",
  "slavik",
  "tux",
  "yellingdario",
  "yorhasit2b",
  "airring",
  "ask-jeeves",
  "azure",
  "broom-belle",
  "capy-2",
  "cinder",
  "clawd",
  "clippy",
  "da-zhuang",
  "dev",
  "dewdrop",
  "doodlebob",
  "dude",
  "duo",
  "einstein",
  "esheep64",
  "finderguy",
  "fine-pup",
  "goblin-goods",
  "goblin",
  "goose",
  "kwehlet",
  "mini-sama",
  "miss-minute",
  "pc-guy",
  "pope-amodei",
  "rubick",
  "sumi",
  "super-piglet",
  "theo",
  "thragg",
  "tibo",
  "tom",
  "totoro",
] as const;

export type AvatarSeed = (typeof AVATAR_SEEDS)[number];

export function isValidAvatarSeed(seed: string): seed is AvatarSeed {
  return (AVATAR_SEEDS as readonly string[]).includes(seed);
}
