"use client";

import React, { useEffect } from "react";
import {
  playSfx,
  startBgm,
  isBgmPlaying,
  getAudioSettings,
  type SoundEffectType,
} from "@/lib/sound-engine";
import { AudioOnboardingPrompt } from "@/components/ui/audio-onboarding-prompt";

export function SfxProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    function handleGlobalInteraction() {
      const settings = getAudioSettings();
      if (
        settings.soundConsent &&
        settings.bgmEnabled &&
        settings.bgmVolume > 0 &&
        !isBgmPlaying()
      ) {
        startBgm();
      }
    }

    function handleGlobalClick(e: MouseEvent) {
      handleGlobalInteraction();

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Find closest interactive element
      const interactiveEl = target.closest<HTMLElement>(
        'button, [role="button"], a, [role="tab"], input[type="radio"], input[type="checkbox"]',
      );

      if (!interactiveEl) return;

      // Check if disabled
      if (
        interactiveEl.hasAttribute("disabled") ||
        interactiveEl.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }

      // Check custom data-sfx override
      const customSfx = interactiveEl.getAttribute("data-sfx");
      if (customSfx === "none" || customSfx === "custom") {
        return;
      }

      if (customSfx) {
        playSfx(customSfx as SoundEffectType);
        return;
      }

      // Determine default sound based on element role/type
      const role = interactiveEl.getAttribute("role");
      const tagName = interactiveEl.tagName.toLowerCase();
      const inputType = interactiveEl.getAttribute("type");

      if (role === "tab") {
        playSfx("tab_switch");
      } else if (inputType === "checkbox" || inputType === "radio") {
        playSfx("toggle");
      } else if (tagName === "button" || tagName === "a" || role === "button") {
        playSfx("click");
      }
    }

    document.addEventListener("click", handleGlobalClick, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pointerdown", handleGlobalInteraction, {
      once: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("click", handleGlobalClick, {
        capture: true,
      });
      window.removeEventListener("pointerdown", handleGlobalInteraction);
    };
  }, []);

  return (
    <>
      {children}
      <AudioOnboardingPrompt />
    </>
  );
}
