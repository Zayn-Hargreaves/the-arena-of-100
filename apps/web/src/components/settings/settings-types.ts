export type TabId = "profile" | "sound" | "graphics" | "controls" | "system";

export type SupportedLocale = "vi" | "en";

export type SettingsState = {
  sfxEnabled: boolean;
  sfxVolume: number;
  bgmEnabled: boolean;
  bgmVolume: number;
  confettiEnabled: boolean;
  reduceMotion: boolean;
  hapticsEnabled: boolean;
  quickAnswers: boolean;
  autoFocus: boolean;
};

export const defaultSettings: SettingsState = {
  sfxEnabled: true,
  sfxVolume: 80,
  bgmEnabled: true,
  bgmVolume: 60,
  confettiEnabled: true,
  reduceMotion: false,
  hapticsEnabled: true,
  quickAnswers: true,
  autoFocus: true,
};

export const STORAGE_KEY = "arena-settings";
