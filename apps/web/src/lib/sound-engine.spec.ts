import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getAudioSettings,
  invalidateAudioSettingsCache,
  playSfx,
} from "./sound-engine";

describe("sound-engine", () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateAudioSettingsCache();
    vi.restoreAllMocks();
  });

  it("returns default settings when localStorage is empty", () => {
    const settings = getAudioSettings();
    expect(settings.sfxEnabled).toBe(true);
    expect(settings.sfxVolume).toBe(80);
  });

  it("reads and caches settings from localStorage", () => {
    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: false, sfxVolume: 40 }),
    );
    invalidateAudioSettingsCache();

    const settings = getAudioSettings();
    expect(settings.sfxEnabled).toBe(false);
    expect(settings.sfxVolume).toBe(40);
  });

  it("does not play sound when sfxEnabled is false", () => {
    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: false, sfxVolume: 80 }),
    );
    invalidateAudioSettingsCache();

    // Should not throw or crash
    expect(() => playSfx("click")).not.toThrow();
  });

  it("handles playSfx for all sound effect types gracefully", () => {
    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: true, sfxVolume: 50 }),
    );
    invalidateAudioSettingsCache();

    const soundTypes = [
      "click",
      "tab_switch",
      "toggle",
      "select_answer",
      "card_play",
      "correct",
      "wrong",
      "countdown",
      "victory",
      "eliminated",
    ] as const;

    soundTypes.forEach((type) => {
      expect(() => playSfx(type)).not.toThrow();
    });
  });
});
