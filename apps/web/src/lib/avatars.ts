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
  airring: { name: "AirRing" },
  "ask-jeeves": { name: "Ask Jeeves" },
  azure: { name: "Azure" },
  "broom-belle": { name: "Kiki" },
  "capy-2": { name: "Capy" },
  cinder: { name: "Cinder" },
  clawd: { name: "Clawd" },
  clippy: { name: "Clippy" },
  "da-zhuang": { name: "Đại Tráng" },
  dev: { name: "Dev" },
  dewdrop: { name: "Dewdrop" },
  doodlebob: { name: "Doodle Bob" },
  dude: { name: "Dude" },
  duo: { name: "Duo" },
  einstein: { name: "Einstein" },
  esheep64: { name: "eSheep64" },
  finderguy: { name: "Finder Guy" },
  "fine-pup": { name: "Fine Pup" },
  "goblin-goods": { name: "Goblin Goods" },
  goblin: { name: "Goblin" },
  goose: { name: "Goose" },
  kwehlet: { name: "Kwehlet" },
  "mini-sama": { name: "Mini Sama" },
  "miss-minute": { name: "Miss Minute" },
  "pc-guy": { name: "PC Guy" },
  "pope-amodei": { name: "Pope Amodei" },
  rubick: { name: "Rubick" },
  sumi: { name: "Sumi" },
  "super-piglet": { name: "Super Piglet" },
  theo: { name: "Theo" },
  thragg: { name: "Thragg" },
  tibo: { name: "Tibo" },
  tom: { name: "Tom" },
  totoro: { name: "Totoro" },
};

export const avatars: AvatarOption[] = AVATAR_SEEDS.map((seed) => ({
  seed,
  name: AVATAR_METADATA[seed].name,
  isAnimated: true,
  spritesheet: `${SPRITESHEET_PATH}/${seed}_spritesheet.webp`,
}));

const AVATARS_BY_SEED: ReadonlyMap<AvatarSeed, AvatarOption> = new Map(
  avatars.map((a) => [a.seed, a]),
);

export function findAvatarBySeed(seed: AvatarSeed): AvatarOption {
  if (avatars.length === 0) {
    throw new Error(
      "findAvatarBySeed: AVATAR_SEEDS yielded no entries; avatar catalog is empty.",
    );
  }
  return AVATARS_BY_SEED.get(seed) ?? (avatars[0] as AvatarOption);
}
