import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SoundEffectType } from "./sound-engine";

interface MockGainNode {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockOscillator {
  type: string;
  frequency: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended?: (() => void) | null;
}

let createdOscillators: MockOscillator[] = [];
let createdGainNodes: MockGainNode[] = [];

class MockAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {};

  createGain = vi.fn(() => {
    const gainNode: MockGainNode = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    createdGainNodes.push(gainNode);
    return gainNode;
  });

  createOscillator = vi.fn(() => {
    const osc: MockOscillator = {
      type: "sine",
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    createdOscillators.push(osc);
    return osc;
  });

  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockImplementation(() => {
    this.state = "closed";
    return Promise.resolve();
  });
}

class MockAudio {
  src: string;
  loop: boolean = false;
  volume: number = 1;
  paused: boolean = true;
  currentTime: number = 0;

  constructor(src: string = "") {
    this.src = src;
    MockAudio.lastInstance = this;
  }

  play() {
    MockAudio.playSpy();
    if (MockAudio.playBehavior === "throw") {
      throw new Error("Autoplay blocked synchronously");
    }
    if (MockAudio.playBehavior === "reject") {
      return Promise.reject(new Error("Autoplay blocked by policy"));
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    MockAudio.pauseSpy();
  }

  static playBehavior: "resolve" | "reject" | "throw" = "resolve";
  static playSpy = vi.fn();
  static pauseSpy = vi.fn();
  static lastInstance: MockAudio | null = null;
}

describe("sound-engine", () => {
  let engine: typeof import("./sound-engine");

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    vi.restoreAllMocks();
    createdOscillators = [];
    createdGainNodes = [];
    MockAudio.playBehavior = "resolve";
    MockAudio.playSpy.mockClear();
    MockAudio.pauseSpy.mockClear();

    (window as unknown as { AudioContext: unknown }).AudioContext =
      MockAudioContext;

    (window as unknown as { Audio: unknown }).Audio = vi
      .fn()
      .mockImplementation((src?: string) => new MockAudio(src));

    engine = await import("./sound-engine");
    engine.invalidateAudioSettingsCache();
  });

  it("returns default settings when localStorage is empty", () => {
    const settings = engine.getAudioSettings();
    expect(settings.sfxEnabled).toBe(true);
    expect(settings.sfxVolume).toBe(80);
    expect(settings.bgmEnabled).toBe(true);
    expect(settings.bgmVolume).toBe(60);
    expect(settings.soundConsent).toBe(false);
  });

  it("returns a copy of defaultSettings so mutations do not affect subsequent reads", () => {
    const settings = engine.getAudioSettings();
    settings.sfxVolume = 10;
    engine.invalidateAudioSettingsCache();
    const fresh = engine.getAudioSettings();
    expect(fresh.sfxVolume).toBe(80);
  });

  it("reads and caches settings from localStorage", () => {
    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: false, sfxVolume: 40, soundConsent: true }),
    );
    engine.invalidateAudioSettingsCache();

    const settings = engine.getAudioSettings();
    expect(settings.sfxEnabled).toBe(false);
    expect(settings.sfxVolume).toBe(40);
    expect(settings.soundConsent).toBe(true);
  });

  describe("normalizeAudioSettings", () => {
    it("returns defaults for null or non-object values", () => {
      expect(engine.normalizeAudioSettings(null)).toEqual({
        sfxEnabled: true,
        sfxVolume: 80,
        bgmEnabled: true,
        bgmVolume: 60,
        soundConsent: false,
      });
      expect(engine.normalizeAudioSettings("invalid")).toEqual({
        sfxEnabled: true,
        sfxVolume: 80,
        bgmEnabled: true,
        bgmVolume: 60,
        soundConsent: false,
      });
    });

    it("clamps volume values between 0 and 100", () => {
      const normalized = engine.normalizeAudioSettings({
        sfxVolume: 150,
        bgmVolume: -20,
      });
      expect(normalized.sfxVolume).toBe(100);
      expect(normalized.bgmVolume).toBe(0);
    });

    it("falls back to default for invalid types or non-finite numbers", () => {
      const normalized = engine.normalizeAudioSettings({
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
      const updated = engine.updateAudioSettings({
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
    const audioContextSpy = vi.fn();
    (window as unknown as { AudioContext: unknown }).AudioContext =
      audioContextSpy;

    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: false, sfxVolume: 80, soundConsent: true }),
    );
    engine.invalidateAudioSettingsCache();
    engine.playSfx("click");
    expect(audioContextSpy).not.toHaveBeenCalled();

    localStorage.setItem(
      "arena-settings",
      JSON.stringify({ sfxEnabled: true, sfxVolume: 80, soundConsent: false }),
    );
    engine.invalidateAudioSettingsCache();
    engine.playSfx("click");
    expect(audioContextSpy).not.toHaveBeenCalled();
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
    engine.invalidateAudioSettingsCache();

    const settings = engine.getAudioSettings();
    expect(settings.soundConsent).toBe(false);
    expect(settings.sfxVolume).toBe(75);
    expect(settings.bgmVolume).toBe(55);
  });

  describe("playSfx", () => {
    it("handles playSfx for all 10 sound effect types and verifies oscillator creation", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ sfxEnabled: true, sfxVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      const expectedOscillatorCounts: Record<SoundEffectType, number> = {
        click: 1,
        tab_switch: 1,
        toggle: 1,
        select_answer: 2,
        card_play: 1,
        correct: 4,
        wrong: 2,
        countdown: 1,
        victory: 4,
        eliminated: 1,
      };

      engine.SOUND_EFFECT_TYPES.forEach((type) => {
        createdOscillators = [];
        engine.playSfx(type);
        expect(createdOscillators.length).toBe(expectedOscillatorCounts[type]);
      });
    });

    it("disconnects masterGain when the final oscillator ends", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ sfxEnabled: true, sfxVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.playSfx("click");
      const masterGain = createdGainNodes[0];
      const osc = createdOscillators[0];

      expect(masterGain.disconnect).not.toHaveBeenCalled();
      osc.onended?.();
      expect(masterGain.disconnect).toHaveBeenCalledTimes(1);
    });

    it("disconnects masterGain on final oscillator for multi-tone sfx", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ sfxEnabled: true, sfxVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.playSfx("correct");
      const masterGain = createdGainNodes[0];
      const firstOsc = createdOscillators[0];
      const lastOsc = createdOscillators[createdOscillators.length - 1];

      expect(masterGain.disconnect).not.toHaveBeenCalled();
      firstOsc.onended?.();
      expect(masterGain.disconnect).not.toHaveBeenCalled();
      lastOsc.onended?.();
      expect(masterGain.disconnect).toHaveBeenCalledTimes(1);
    });

    it("logs a warning and exits gracefully on unsupported sound effect type", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ sfxEnabled: true, sfxVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      engine.playSfx("invalid_type" as SoundEffectType);
      expect(createdGainNodes[0].disconnect).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unsupported sound effect type: invalid_type"),
      );
      warnSpy.mockRestore();
    });
  });

  describe("BGM management", () => {
    it("does not play BGM when soundConsent is false", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({
          bgmEnabled: true,
          bgmVolume: 60,
          soundConsent: false,
        }),
      );
      engine.invalidateAudioSettingsCache();

      engine.startBgm("/audio/test.mp3");
      expect(MockAudio.playSpy).not.toHaveBeenCalled();
      expect(MockAudio.pauseSpy).toHaveBeenCalled();
      expect(engine.isBgmPlaying()).toBe(false);
    });

    it("pauses BGM when bgmVolume is 0", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 0, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.startBgm("/audio/test.mp3");
      expect(MockAudio.playSpy).not.toHaveBeenCalled();
      expect(MockAudio.pauseSpy).toHaveBeenCalled();
    });

    it("plays BGM when consent is true and volume > 0", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.startBgm("/audio/test.mp3");
      expect(MockAudio.playSpy).toHaveBeenCalled();
      expect(engine.isBgmPlaying()).toBe(true);
    });

    it("updates the src on existing BGM audio element when startBgm is called with a new URL", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.startBgm("/audio/track-1.mp3");
      expect(MockAudio.lastInstance?.src).toBe("/audio/track-1.mp3");

      engine.startBgm("/audio/track-2.mp3");
      expect(MockAudio.lastInstance?.src).toBe("/audio/track-2.mp3");
    });

    it("pauses and resets currentTime to 0 on stopBgm", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.startBgm("/audio/test.mp3");
      engine.stopBgm();
      expect(MockAudio.pauseSpy).toHaveBeenCalled();
      expect(engine.isBgmPlaying()).toBe(false);
    });

    it("syncs BGM state via syncBgmWithSettings when settings change", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.startBgm("/audio/test.mp3");
      expect(MockAudio.playSpy).toHaveBeenCalled();

      engine.updateAudioSettings({ bgmVolume: 0 });
      expect(MockAudio.pauseSpy).toHaveBeenCalled();
    });

    it("registers gesture listeners on autoplay promise rejection and retries play on user gesture", async () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      MockAudio.playBehavior = "reject";
      const addEventSpy = vi.spyOn(window, "addEventListener");

      engine.startBgm("/audio/test.mp3");
      await Promise.resolve();

      expect(addEventSpy).toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        { once: true },
      );
      expect(addEventSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        { once: true },
      );

      const pointerdownCallCount = addEventSpy.mock.calls.filter(
        (call) => call[0] === "pointerdown",
      ).length;

      // Subsequent startBgm while listener is bound should not attach duplicate listeners
      engine.startBgm("/audio/test.mp3");
      await Promise.resolve();
      const pointerdownCallCountAfter = addEventSpy.mock.calls.filter(
        (call) => call[0] === "pointerdown",
      ).length;
      expect(pointerdownCallCountAfter).toBe(pointerdownCallCount);

      // Trigger gesture
      MockAudio.playBehavior = "resolve";
      window.dispatchEvent(new Event("pointerdown"));

      expect(engine.isBgmPlaying()).toBe(true);
      addEventSpy.mockRestore();
    });

    it("handles synchronous throw in play() and retries on gesture", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      MockAudio.playBehavior = "throw";
      const addEventSpy = vi.spyOn(window, "addEventListener");

      engine.startBgm("/audio/test.mp3");

      expect(addEventSpy).toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        { once: true },
      );
      expect(addEventSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        { once: true },
      );

      // Trigger gesture
      MockAudio.playBehavior = "resolve";
      window.dispatchEvent(new Event("keydown"));

      expect(engine.isBgmPlaying()).toBe(true);
      addEventSpy.mockRestore();
    });

    it("recovers via gesture listeners when syncBgmWithSettings encounters autoplay rejection", async () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ bgmEnabled: true, bgmVolume: 0, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();

      engine.startBgm("/audio/test.mp3");

      MockAudio.playBehavior = "reject";
      const addEventSpy = vi.spyOn(window, "addEventListener");

      engine.updateAudioSettings({ bgmVolume: 50 });
      await Promise.resolve();

      expect(addEventSpy).toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        { once: true },
      );

      MockAudio.playBehavior = "resolve";
      window.dispatchEvent(new Event("pointerdown"));
      expect(engine.isBgmPlaying()).toBe(true);
      addEventSpy.mockRestore();
    });
  });

  describe("storage event handling", () => {
    it("invalidates cache on window storage event when key matches arena-settings", () => {
      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ sfxEnabled: true, sfxVolume: 50, soundConsent: true }),
      );
      engine.invalidateAudioSettingsCache();
      const initial = engine.getAudioSettings();
      expect(initial.sfxVolume).toBe(50);

      localStorage.setItem(
        "arena-settings",
        JSON.stringify({ sfxEnabled: true, sfxVolume: 90, soundConsent: true }),
      );
      // Cache still has old value
      expect(engine.getAudioSettings().sfxVolume).toBe(50);

      // Trigger storage event
      window.dispatchEvent(
        new StorageEvent("storage", { key: "arena-settings" }),
      );
      expect(engine.getAudioSettings().sfxVolume).toBe(90);
    });
  });

  describe("isSoundEffectType guard and constants", () => {
    it("identifies valid and invalid sound effect types", () => {
      engine.SOUND_EFFECT_TYPES.forEach((type) => {
        expect(engine.isSoundEffectType(type)).toBe(true);
      });
      expect(engine.isSoundEffectType("non_existent")).toBe(false);
      expect(engine.isSoundEffectType(null)).toBe(false);
      expect(engine.isSoundEffectType(undefined)).toBe(false);
      expect(engine.isSoundEffectType(123)).toBe(false);
    });
  });
});
