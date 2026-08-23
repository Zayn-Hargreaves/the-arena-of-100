import React from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import {
  CrownSvg,
  SettingsGearSvg,
  SmileySvg,
} from "@/components/home/home-icons";
import { LanguageToggle } from "@/components/ui/language-toggle";

export interface HomeHeaderProps {
  onlineCount?: number;
}

export function HomeHeader({
  onlineCount = 12408,
}: Readonly<HomeHeaderProps> = {}) {
  const t = useTranslations("HomePage");

  return (
    <header className="bg-[#FFF8E7] border-b-5 border-candy-ink py-2.5 sm:py-3.5 sticky top-0 z-40 shadow-[0_5px_0_0_#2B2D42]">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 flex justify-between items-center gap-2">
        {/* Brand Logo & Fun Tag */}
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4 shrink-0">
          <Link
            href="/"
            className="hover:scale-105 transition-transform bg-candy-pink text-white font-display text-sm sm:text-xl md:text-2xl px-2.5 sm:px-4 md:px-5 py-1.5 sm:py-2 border-3 sm:border-4 border-candy-ink rounded-2xl transform -rotate-2 shadow-[2.5px_2.5px_0_0_#2B2D42] sm:shadow-[4px_4px_0_0_#2B2D42] flex items-center gap-1.5 sm:gap-2 whitespace-nowrap"
          >
            <CrownSvg
              size={20}
              className="sm:w-6 sm:h-6 drop-shadow-none shrink-0"
            />
            <span>{t("brand")}</span>
          </Link>
          <span className="hidden lg:inline-flex bg-candy-mint text-white font-display text-xs px-3.5 py-1.5 border-3 border-candy-ink rounded-full transform rotate-2 items-center gap-1.5 shadow-[2px_2px_0_0_#2B2D42]">
            <span>{t("taglineBadge")}</span>
            <SmileySvg size={16} />
          </span>
        </div>

        {/* Right Controls: Online Pill + Settings Gear + Language Switcher */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 md:gap-3 shrink-0">
          {/* Online Count Styled as Subway Surfers Coin/Trophy Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2 bg-candy-yellow border-2.5 sm:border-3 md:border-4 border-candy-ink px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] sm:shadow-[3px_3px_0_0_#2B2D42] transform rotate-1 whitespace-nowrap shrink-0">
            <span className="relative flex h-2 w-2 sm:h-2.5 sm:w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-candy-red opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 bg-candy-red"></span>
            </span>
            <span className="font-display text-[10px] sm:text-xs md:text-sm tracking-tight text-candy-ink uppercase font-black">
              <span className="hidden md:inline">
                {t("onlineCount", { count: onlineCount })}
              </span>
              <span className="md:hidden">
                {t("onlineCountShort", { count: onlineCount })}
              </span>
            </span>
          </div>

          {/* Settings Arcade Button */}
          <Link
            href="/settings"
            className="w-8 h-8 sm:w-10 sm:h-10 md:w-11 md:h-11 rounded-2xl bg-white hover:bg-candy-yellow border-2 sm:border-3 md:border-4 border-candy-ink text-candy-ink shadow-[2px_2px_0_0_#2B2D42] sm:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-none hover:scale-105 transition-all flex items-center justify-center shrink-0"
            aria-label={t("settings")}
          >
            <SettingsGearSvg
              size={16}
              className="sm:w-5 sm:h-5 md:w-[22px] md:h-[22px]"
            />
          </Link>

          {/* Language Switcher Toggle */}
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
