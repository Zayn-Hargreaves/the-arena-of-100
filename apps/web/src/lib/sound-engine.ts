/**
 * Web Audio API Sound Engine
 * Provides zero-latency, asset-free synthesized sound effects for all user actions.
 * Automatically synchronizes with user preferences stored in localStorage ('arena-settings').
 */

export type SoundEffectType =
  | "click"
  | "tab_switch"
  | "toggle"
  | "select_answer"
  | "card_play"
  | "correct"
  | "wrong"
  | "countdown"
  | "victory"
  | "eliminated";

export interface AudioSettings {
  sfxEnabled: boolean;
  sfxVolume: number; // 0..100
  bgmEnabled: boolean;
  bgmVolume: number; // 0..100
}

const STORAGE_KEY = "arena-settings";
const DEFAULT_BGM_TRACK = "/audio/bgm-battle.mp3";

const defaultSettings: AudioSettings = {
  sfxEnabled: true,
  sfxVolume: 80,
  bgmEnabled: true,
  bgmVolume: 60,
};

let cachedSettings: AudioSettings | null = null;
let sharedAudioCtx: AudioContext | null = null;
let bgmAudioElement: HTMLAudioElement | null = null;

/**
 * Returns audio context instance, reusing existing or creating a new one on user interaction
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtxClass) return null;
      sharedAudioCtx = new AudioCtxClass();
    }

    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }

    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Reads settings from localStorage, caching for maximum performance
 */
export function getAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return defaultSettings;
  if (cachedSettings) return cachedSettings;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      cachedSettings = {
        sfxEnabled: parsed.sfxEnabled ?? defaultSettings.sfxEnabled,
        sfxVolume:
          typeof parsed.sfxVolume === "number"
            ? parsed.sfxVolume
            : defaultSettings.sfxVolume,
        bgmEnabled: parsed.bgmEnabled ?? defaultSettings.bgmEnabled,
        bgmVolume:
          typeof parsed.bgmVolume === "number"
            ? parsed.bgmVolume
            : defaultSettings.bgmVolume,
      };
      return cachedSettings;
    }
  } catch {
    // fallback to defaults
  }

  cachedSettings = defaultSettings;
  return cachedSettings;
}

/**
 * Update and persist audio settings
 */
export function updateAudioSettings(
  partial: Partial<AudioSettings>,
): AudioSettings {
  const current = getAudioSettings();
  const updated: AudioSettings = {
    ...current,
    ...partial,
  };

  if (typeof window !== "undefined") {
    try {
      const existingRaw = window.localStorage.getItem(STORAGE_KEY);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const merged = { ...existing, ...updated };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.warn("Failed to persist audio settings:", err);
    }
  }

  cachedSettings = updated;
  syncBgmWithSettings();
  return updated;
}

/**
 * Invalidate cached settings (called when settings change)
 */
export function invalidateAudioSettingsCache(): void {
  cachedSettings = null;
  syncBgmWithSettings();
}

/**
 * BGM Manager
 */
export function startBgm(trackUrl: string = DEFAULT_BGM_TRACK): void {
  if (typeof window === "undefined") return;

  const settings = getAudioSettings();

  if (!bgmAudioElement) {
    bgmAudioElement = new Audio(trackUrl);
    bgmAudioElement.loop = true;
  } else if (
    bgmAudioElement.src !== trackUrl &&
    !bgmAudioElement.src.endsWith(trackUrl)
  ) {
    bgmAudioElement.src = trackUrl;
  }

  const normalizedVol =
    (Math.max(0, Math.min(100, settings.bgmVolume)) / 100) * 0.4;
  bgmAudioElement.volume = settings.bgmEnabled ? normalizedVol : 0;

  if (settings.bgmEnabled) {
    bgmAudioElement.play().catch(() => {
      // Browsers may block autoplay before first user interaction
      const resumeOnGesture = () => {
        if (bgmAudioElement && getAudioSettings().bgmEnabled) {
          bgmAudioElement.play().catch(() => {});
        }
        window.removeEventListener("pointerdown", resumeOnGesture);
        window.removeEventListener("keydown", resumeOnGesture);
      };
      window.addEventListener("pointerdown", resumeOnGesture, { once: true });
      window.addEventListener("keydown", resumeOnGesture, { once: true });
    });
  }
}

export function stopBgm(): void {
  if (bgmAudioElement) {
    bgmAudioElement.pause();
    bgmAudioElement.currentTime = 0;
  }
}

export function syncBgmWithSettings(): void {
  if (!bgmAudioElement) return;
  const settings = getAudioSettings();
  const normalizedVol =
    (Math.max(0, Math.min(100, settings.bgmVolume)) / 100) * 0.4;

  if (settings.bgmEnabled && settings.bgmVolume > 0) {
    bgmAudioElement.volume = normalizedVol;
    if (bgmAudioElement.paused) {
      bgmAudioElement.play().catch(() => {});
    }
  } else {
    bgmAudioElement.pause();
  }
}

export function isBgmPlaying(): boolean {
  return Boolean(bgmAudioElement && !bgmAudioElement.paused);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key === STORAGE_KEY) {
      invalidateAudioSettingsCache();
    }
  });
}

/**
 * Master SFX playback function
 */
export function playSfx(
  type: SoundEffectType = "click",
  customVolumePercent?: number,
): void {
  const settings = getAudioSettings();
  if (!settings.sfxEnabled) return;

  const volume =
    customVolumePercent !== undefined
      ? customVolumePercent
      : settings.sfxVolume;
  if (volume <= 0) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const masterGain = ctx.createGain();
  const normalizedVol = (Math.max(0, Math.min(100, volume)) / 100) * 0.2;
  masterGain.gain.setValueAtTime(normalizedVol, ctx.currentTime);
  masterGain.connect(ctx.destination);

  const now = ctx.currentTime;

  try {
    switch (type) {
      case "click": {
        // Crisp arcade click pop
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.04);

        gain.gain.setValueAtTime(0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 0.04);
        break;
      }

      case "toggle": {
        // Two-tone quick switch tick
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(880, now + 0.03);

        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 0.07);
        break;
      }

      case "tab_switch": {
        // Soft airy chirp
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.06);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 0.06);
        break;
      }

      case "select_answer": {
        // Satisfying arcade lock-in chime
        const notes = [
          { freq: 440, time: 0, duration: 0.06 },
          { freq: 659.25, time: 0.05, duration: 0.12 },
        ];

        notes.forEach(({ freq, time, duration }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + time);

          gain.gain.setValueAtTime(0.6, now + time);
          gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now + time);
          osc.stop(now + time + duration);
        });
        break;
      }

      case "card_play": {
        // Magical upward frequency slide
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.18);

        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }

      case "correct": {
        // Sparkling 4-tone victory arpeggio
        const notes = [
          { freq: 523.25, time: 0, duration: 0.08 }, // C5
          { freq: 659.25, time: 0.07, duration: 0.08 }, // E5
          { freq: 783.99, time: 0.14, duration: 0.1 }, // G5
          { freq: 1046.5, time: 0.22, duration: 0.25 }, // C6
        ];

        notes.forEach(({ freq, time, duration }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + time);

          gain.gain.setValueAtTime(0.8, now + time);
          gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now + time);
          osc.stop(now + time + duration);
        });
        break;
      }

      case "wrong": {
        // Descending comic thud / buzzer
        const notes = [
          { freq: 280, time: 0, duration: 0.12 },
          { freq: 180, time: 0.1, duration: 0.2 },
        ];

        notes.forEach(({ freq, time, duration }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(freq, now + time);

          gain.gain.setValueAtTime(0.35, now + time);
          gain.gain.exponentialRampToValueAtTime(0.01, now + time + duration);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now + time);
          osc.stop(now + time + duration);
        });
        break;
      }

      case "countdown": {
        // Metronome clock tick
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, now);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.03);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 0.03);
        break;
      }

      case "victory": {
        // Fanfare motif
        const notes = [
          { freq: 523.25, time: 0, duration: 0.1 },
          { freq: 659.25, time: 0.1, duration: 0.1 },
          { freq: 783.99, time: 0.2, duration: 0.1 },
          { freq: 1046.5, time: 0.3, duration: 0.4 },
        ];

        notes.forEach(({ freq, time, duration }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, now + time);

          gain.gain.setValueAtTime(0.7, now + time);
          gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now + time);
          osc.stop(now + time + duration);
        });
        break;
      }

      case "eliminated": {
        // Dramatic low falling note
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.4);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 0.45);
        break;
      }
    }
  } catch (err) {
    console.warn("SFX playback error:", err);
  }
}
