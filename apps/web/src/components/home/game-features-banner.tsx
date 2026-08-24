"use client";

import React from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { GAME_CONFIG, CLASS_IDS } from "@arena/shared";
import {
  FlameSvg,
  GamepadSvg,
  ShieldCheckSvg,
  CrownSvg,
  ArrowRightSvg,
} from "./home-icons";

export function GameFeaturesBanner() {
  const t = useTranslations("HomePage");

  return (
    <div className="space-y-4">
      {/* Quick Mechanics Card */}
      <div className="bg-white border-4 border-candy-ink rounded-3xl p-6 shadow-[6px_6px_0_0_#2B2D42]">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="inline-flex items-center gap-1.5 bg-candy-mint text-white font-display text-[11px] font-black px-3 py-1 border-2 border-candy-ink rounded-full shadow-[2px_2px_0_0_#2B2D42] uppercase tracking-wider">
            <GamepadSvg size={14} />
            <span>{t("rulesTitle")}</span>
          </div>

          <Link
            href="/rules"
            className="text-xs font-mono font-bold text-candy-ink hover:text-candy-blue flex items-center gap-1 group"
          >
            <span>{t("howToPlay")}</span>
            <span className="group-hover:translate-x-0.5 transition-transform">
              <ArrowRightSvg size={12} />
            </span>
          </Link>
        </div>

        <p className="font-body text-xs text-candy-ink/80 font-semibold mb-4 leading-relaxed">
          {t("rulesDesc")}
        </p>

        {/* 3 mini feature blocks */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-candy-cloud/60 border-2 border-candy-ink/20 rounded-2xl p-3 text-center flex flex-col items-center">
            <div className="w-9 h-9 mb-1 bg-white border-2 border-candy-ink rounded-xl flex items-center justify-center shadow-[1px_1px_0_0_#2B2D42]">
              <FlameSvg size={20} />
            </div>
            <h4 className="font-display font-black text-xs text-candy-ink uppercase">
              {t("feature100Players", { count: GAME_CONFIG.MAX_PLAYERS })}
            </h4>
            <p className="font-body text-[10px] text-candy-ink/70 font-semibold mt-0.5">
              {t("featureOneWrong")}
            </p>
          </div>

          <div className="bg-candy-cloud/60 border-2 border-candy-ink/20 rounded-2xl p-3 text-center flex flex-col items-center">
            <div className="w-9 h-9 mb-1 bg-white border-2 border-candy-ink rounded-xl flex items-center justify-center shadow-[1px_1px_0_0_#2B2D42]">
              <ShieldCheckSvg size={20} />
            </div>
            <h4 className="font-display font-black text-xs text-candy-ink uppercase">
              {t("feature5Classes", { count: CLASS_IDS.length })}
            </h4>
            <p className="font-body text-[10px] text-candy-ink/70 font-semibold mt-0.5">
              {t("featureUniquePassives")}
            </p>
          </div>

          <div className="bg-candy-cloud/60 border-2 border-candy-ink/20 rounded-2xl p-3 text-center flex flex-col items-center">
            <div className="w-9 h-9 mb-1 bg-white border-2 border-candy-ink rounded-xl flex items-center justify-center shadow-[1px_1px_0_0_#2B2D42]">
              <GamepadSvg size={20} />
            </div>
            <h4 className="font-display font-black text-xs text-candy-ink uppercase">
              {t("featureCards")}
            </h4>
            <p className="font-body text-[10px] text-candy-ink/70 font-semibold mt-0.5">
              {t("featureShieldSabotage")}
            </p>
          </div>
        </div>
      </div>

      {/* Rankings / Leaderboard Quick Card */}
      <Link
        href="/rankings"
        className="block bg-gradient-to-r from-candy-yellow to-[#FFEAA7] border-4 border-candy-ink rounded-3xl p-5 shadow-[6px_6px_0_0_#2B2D42] hover:-translate-y-1 hover:shadow-[8px_8px_0_0_#2B2D42] transition-all group"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white border-3 border-candy-ink flex items-center justify-center shadow-[2px_2px_0_0_#2B2D42] text-candy-ink">
              <CrownSvg size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-black text-base text-candy-ink uppercase">
                  {t("rankings")}
                </span>
                <span className="bg-candy-ink text-white font-mono text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                  {t("top100Badge", { count: 100 })}
                </span>
              </div>
              <p className="font-body text-xs text-candy-ink/80 font-semibold mt-0.5">
                {t("viewRankingsDesc")}
              </p>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white border-2 border-candy-ink flex items-center justify-center shadow-[2px_2px_0_0_#2B2D42] group-hover:translate-x-1 transition-transform">
            <ArrowRightSvg size={18} />
          </div>
        </div>
      </Link>
    </div>
  );
}
