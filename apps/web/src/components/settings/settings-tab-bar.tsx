"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TabId } from "./settings-types";
import {
  UserBadgeSvg,
  VolumeHighSvg,
  SparklesCandySvg,
  GamepadSvg,
  SlidersConfigSvg,
} from "./settings-icons";

interface SettingsTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function SettingsTabBar({
  activeTab,
  onTabChange,
}: Readonly<SettingsTabBarProps>) {
  const t = useTranslations("settings");
  const tabButtonRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const tabsConfig = [
    {
      id: "profile" as TabId,
      label: t("tabs.profile"),
      icon: UserBadgeSvg,
    },
    {
      id: "sound" as TabId,
      label: t("tabs.sound"),
      icon: VolumeHighSvg,
    },
    {
      id: "graphics" as TabId,
      label: t("tabs.graphics"),
      icon: SparklesCandySvg,
    },
    {
      id: "controls" as TabId,
      label: t("tabs.controls"),
      icon: GamepadSvg,
    },
    {
      id: "system" as TabId,
      label: t("tabs.system"),
      icon: SlidersConfigSvg,
    },
  ];

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") {
      nextIndex = (index + 1) % tabsConfig.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabsConfig.length) % tabsConfig.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabsConfig.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const nextTab = tabsConfig[nextIndex];
      if (nextTab) {
        onTabChange(nextTab.id);
        tabButtonRefs.current[nextIndex]?.focus();
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={t("title")}
      className="flex items-center gap-2 overflow-x-auto pt-2.5 pb-2 px-1 scrollbar-none snap-x"
    >
      {tabsConfig.map((tab, index) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabButtonRefs.current[index] = el;
            }}
            id={`settings-tab-${tab.id}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`settings-tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            type="button"
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "px-4 py-3 rounded-2xl font-display font-black text-xs uppercase tracking-wide border-[2.5px] border-candy-ink transition-all flex items-center gap-2 shrink-0 cursor-pointer snap-start",
              isActive
                ? "bg-candy-yellow text-candy-ink -translate-y-1 shadow-[4px_4px_0_0_#2B2D42]"
                : "bg-white hover:bg-candy-cloud/80 text-candy-ink/75 hover:text-candy-ink shadow-[2px_2px_0_0_#2B2D42]",
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
