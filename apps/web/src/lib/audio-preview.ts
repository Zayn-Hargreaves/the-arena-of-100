import { playSfx } from "./sound-engine";

/**
 * Native Web Audio API Chime Synth for in-browser sound testing
 */
export function playCandyChime(volumePercent: number = 80) {
  playSfx("correct", volumePercent);
}
