import React from "react";
import { useTranslations } from "next-intl";
import {
  BalloonSvg,
  BombSvg,
  CandySvg,
  CrownSvg,
  DonutSvg,
  FlameSvg,
  SparkleSvg,
  StarSvg,
} from "@/components/home/home-icons";

export function HomeHero() {
  const t = useTranslations("HomePage");

  return (
    <>
      {/* Playful Floating SVG Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0">
        <div className="absolute top-[15%] left-[8%] floating-candy opacity-35">
          <CandySvg size={72} />
        </div>
        <div className="absolute top-[20%] right-[10%] floating-donut opacity-35">
          <DonutSvg size={68} />
        </div>
        <div className="absolute bottom-[25%] left-[5%] floating-star opacity-30">
          <StarSvg size={64} />
        </div>
        <div className="absolute bottom-[15%] right-[8%] floating-candy opacity-35">
          <BalloonSvg size={76} />
        </div>
        <div className="absolute top-[50%] left-[85%] floating-star opacity-25">
          <SparkleSvg size={52} />
        </div>
      </div>

      {/* Goofy Hero Title Area */}
      <div className="text-center mb-8 md:mb-10 relative">
        <div className="inline-block select-none animate-bounce mb-1">
          <CrownSvg size={64} />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl text-candy-ink drop-shadow-[4px_4px_0_#FFE5EC] uppercase tracking-tight transform -rotate-1">
          {t("heroTitle")}
        </h1>
        <div className="mt-3 inline-flex items-center gap-2.5 bg-white border-3 border-candy-ink px-4 sm:px-5 py-1.5 rounded-full shadow-[3px_3px_0_0_#2B2D42] transform rotate-1 hover:rotate-0 transition-transform">
          <FlameSvg size={18} className="shrink-0" />
          <span className="font-display text-xs sm:text-sm md:text-base text-candy-ink uppercase font-black tracking-wide">
            {t("heroSubtitle")}
          </span>
          <BombSvg size={20} className="shrink-0" />
        </div>
      </div>
    </>
  );
}
