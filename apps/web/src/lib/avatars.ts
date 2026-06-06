import { AVATAR_SEEDS, type AvatarSeed } from "@arena/shared";

export interface AvatarOption {
  seed: AvatarSeed;
  name: string;
  isAnimated?: boolean;
  spritesheet?: string;
}

const SPRITESHEET_PATH = "/arena_of_100";

const AVATAR_METADATA: Record<AvatarSeed, { name: string }> = {
  jellyfrog: { name: "Ếch Thạch (Jelly)" },
  dario: { name: "CEO Dario" },
  dentist: { name: "Nha Sĩ Chibi" },
  nyakoshigure: { name: "Mèo Nyako" },
  slavik: { name: "Slavik Tracksuit" },
  tux: { name: "Chim Cánh Cụt Tux" },
  yellingdario: { name: "Dario Gào Thét" },
  yorhasit2b: { name: "Hiệp Sĩ 2B Ngơ" },
  airring: { name: "AirRing (Community)" },
  "ask-jeeves": { name: "Ask Jeeves (Community)" },
  azure: { name: "Azure (Community)" },
  "broom-belle": { name: "Kiki (Community)" },
  "capy-2": { name: "Capy (Community)" },
  cinder: { name: "Cinder (Community)" },
  clawd: { name: "Clawd (Community)" },
  clippy: { name: "Clippy (Community)" },
  "da-zhuang": { name: "Đại Tráng (Community)" },
  dev: { name: "Dev (Community)" },
  dewdrop: { name: "Dewdrop (Community)" },
  doodlebob: { name: "Doodle Bob (Community)" },
  dude: { name: "Dude (Community)" },
  duo: { name: "Duo (Community)" },
  einstein: { name: "Einstein (Community)" },
  esheep64: { name: "eSheep64 (Community)" },
  finderguy: { name: "Finder Guy (Community)" },
  "fine-pup": { name: "Fine Pup (Community)" },
  "goblin-goods": { name: "Goblin Goods (Community)" },
  goblin: { name: "Goblin (Community)" },
  goose: { name: "Goose (Community)" },
  kwehlet: { name: "Kwehlet (Community)" },
  "mini-sama": { name: "Mini Sama (Community)" },
  "miss-minute": { name: "Miss Minute (Community)" },
  "pc-guy": { name: "PC Guy (Community)" },
  "pope-amodei": { name: "Pope Amodei (Community)" },
  rubick: { name: "Rubick (Community)" },
  sumi: { name: "Sumi (Community)" },
  "super-piglet": { name: "Super Piglet (Community)" },
  theo: { name: "Theo (Community)" },
  thragg: { name: "Thragg (Community)" },
  tibo: { name: "Tibo (Community)" },
  tom: { name: "Tom (Community)" },
  totoro: { name: "Totoro (Community)" },
};

// Derived from AVATAR_SEEDS (const from @arena/shared) and therefore
// guaranteed to be non-empty at runtime; no empty-list guard needed.
export const avatars: AvatarOption[] = AVATAR_SEEDS.map((seed) => ({
  seed,
  name: AVATAR_METADATA[seed].name,
  isAnimated: true,
  spritesheet: `${SPRITESHEET_PATH}/${seed}_spritesheet.webp`,
}));

export function findAvatarBySeed(seed: AvatarSeed): AvatarOption {
  return avatars.find((a) => a.seed === seed) ?? (avatars[0] as AvatarOption);
}
