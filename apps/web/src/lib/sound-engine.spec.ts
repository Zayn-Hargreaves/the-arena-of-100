import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getAudioSettings,
  updateAudioSettings,
  invalidateAudioSettingsCache,
  normalizeAudioSettings,
  playSfx,
} from "./sound-engine";

describe("sound-engine", () => {
  const originalAudioContext =
    typeof window !== "undefined"
      ? (window as unknown as { AudioContext?: unknown }).AudioContext
      : undefined;

  beforeEach(() => {
    localStorage.clear();
    invalidateAudioSettingsCache();
    vi.restoreAllMocks();
    if (typeof window !== "undefined") {
      if (originalAudioContext) {
        (window as unknown as { AudioContext?: unknown }).AudioContext =
          originalAudioContext;
      } else {
        delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      }
    }
  });

  it("returns default settings when localStorage is empty", () => {
    const settings = getAudioSettings();
    expect(settings.sfxEnabled).toBe(true);
    expect(settings.sfxVolume).toBe(80);
    expect(settings.bgmEnabled).toBe(true);
    expect(settings.bgmVolume).toBe(60);
    expect(settings.soundConsent).toBe(false);
  });

  it("reads and caches settings from localStorage", () => {
    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: false, sfxVolume: 40, soundConsent: true }),
    );
    invalidateAudioSettingsCache();

    const settings = getAudioSettings();
    expect(settings.sfxEnabled).toBe(false);
    expect(settings.sfxVolume).toBe(40);
    expect(settings.soundConsent).toBe(true);
  });

  describe("normalizeAudioSettings", () => {
    it("returns defaults for null or non-object values", () => {
      expect(normalizeAudioSettings(null)).toEqual({
        sfxEnabled: true,
        sfxVolume: 80,
        bgmEnabled: true,
        bgmVolume: 60,
        soundConsent: false,
      });
      expect(normalizeAudioSettings("invalid")).toEqual({
        sfxEnabled: true,
        sfxVolume: 80,
        bgmEnabled: true,
        bgmVolume: 60,
        soundConsent: false,
      });
    });

    it("clamps volume values between 0 and 100", () => {
      const normalized = normalizeAudioSettings({
        sfxVolume: 150,
        bgmVolume: -20,
      });
      expect(normalized.sfxVolume).toBe(100);
      expect(normalized.bgmVolume).toBe(0);
    });

    it("falls back to default for invalid types or non-finite numbers", () => {
      const normalized = normalizeAudioSettings({
        sfxEnabled: "true",
        bgmEnabled: 123,
        soundConsent: "yes",
        sfxVolume: NaN,
        bgmVolume: Infinity,
      });
      expect(normalized.sfxEnabled).toBe(true);
      expect(normalized.bgmEnabled).toBe(true);
      expect(normalized.soundConsent).toBe(false);
      expect(normalized.sfxVolume).toBe(80);
      expect(normalized.bgmVolume).toBe(60);
    });
  });

  describe("updateAudioSettings", () => {
    it("normalizes and persists updated settings to localStorage", () => {
      const updated = updateAudioSettings({
        sfxVolume: 120,
        soundConsent: true,
      });
      expect(updated.sfxVolume).toBe(100);
      expect(updated.soundConsent).toBe(true);

      const stored = JSON.parse(localStorage.getItem("arena-settings")!);
      expect(stored.sfxVolume).toBe(100);
      expect(stored.soundConsent).toBe(true);
    });
  });

  it("does not instantiate AudioContext when sfxEnabled is false or soundConsent is false", () => {
    const audioContextMock = vi.fn();
    (window as unknown as { AudioContext: unknown }).AudioContext =
      audioContextMock;

    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: false, sfxVolume: 80, soundConsent: true }),
    );
    invalidateAudioSettingsCache();
    playSfx("click");
    expect(audioContextMock).not.toHaveBeenCalled();

    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: true, sfxVolume: 80, soundConsent: false }),
    );
    invalidateAudioSettingsCache();
    playSfx("click");
    expect(audioContextMock).not.toHaveBeenCalled();
  });

  it("handles legacy configuration without soundConsent by defaulting soundConsent to false", () => {
    localStorage.setItem(
      "arena-settings",
      JSON.stringify({
        sfxEnabled: true,
        sfxVolume: 75,
        bgmEnabled: true,
        bgmVolume: 55,
      }),
    );
    invalidateAudioSettingsCache();

    const settings = getAudioSettings();
    expect(settings.soundConsent).toBe(false);
    expect(settings.sfxVolume).toBe(75);
    expect(settings.bgmVolume).toBe(55);
  });

  it("handles playSfx for all sound effect types gracefully when consented", () => {
    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: true, sfxVolume: 50, soundConsent: true }),
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
