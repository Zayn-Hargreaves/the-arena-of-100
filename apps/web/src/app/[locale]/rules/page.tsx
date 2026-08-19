"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  ShieldCheckSvg,
  SparkleSmallSvg,
  ArrowRightSvg,
} from "@/components/home/home-icons";
import { LanguageToggle } from "@/components/ui/language-toggle";

export default function RulesPage() {
  const t = useTranslations("policies");
  const tHome = useTranslations("HomePage");

  return (
    <main className="text-candy-ink min-h-screen flex flex-col font-sans selection:bg-candy-pink selection:text-white relative overflow-x-hidden antialiased py-8 px-4 md:px-8">
      {/* Header Bar */}
      <div className="max-w-4xl mx-auto w-full flex justify-between items-center mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border-3 border-candy-ink rounded-2xl font-display font-black text-xs uppercase shadow-[3px_3px_0_0_#2B2D42] hover:bg-candy-yellow transition-all"
        >
          <span className="rotate-180 inline-block">
            <ArrowRightSvg size={16} />
          </span>
          <span>{tHome("brand")}</span>
        </Link>

        <LanguageToggle />
      </div>

      {/* Main Container */}
      <div className="max-w-4xl mx-auto w-full bg-white border-4 border-candy-ink rounded-3xl p-6 md:p-10 shadow-[8px_8px_0_0_#2B2D42]">
        <div className="border-b-4 border-dashed border-candy-ink/20 pb-6 mb-8">
          <div className="inline-flex items-center gap-2 bg-candy-mint text-white font-display text-xs px-3.5 py-1.5 border-3 border-candy-ink rounded-full shadow-[2px_2px_0_0_#2B2D42] mb-3">
            <ShieldCheckSvg size={18} />
            <span className="font-black uppercase tracking-wider">
              {t("antiCheatTitle")}
            </span>
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl text-candy-ink uppercase tracking-tight">
            {t("antiCheatTitle")}
          </h1>
          <p className="font-body text-sm md:text-base text-candy-ink/80 font-semibold mt-2">
            {t("antiCheatSubtitle")}
          </p>
        </div>

        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-[#E0F2FE] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
            <h2 className="font-display font-black text-base uppercase text-candy-ink flex items-center gap-2 mb-2">
              <SparkleSmallSvg size={18} />
              {t("antiCheat.section1Title")}
            </h2>
            <p className="font-body text-sm leading-relaxed text-candy-ink/85 font-medium">
              {t("antiCheat.section1Desc")}
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-white border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
            <h2 className="font-display font-black text-base uppercase text-candy-ink flex items-center gap-2 mb-2">
              <SparkleSmallSvg size={18} />
              {t("antiCheat.section2Title")}
            </h2>
            <p className="font-body text-sm leading-relaxed text-candy-ink/85 font-medium">
              {t("antiCheat.section2Desc")}
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-[#FFF8E7] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
            <h2 className="font-display font-black text-base uppercase text-candy-ink flex items-center gap-2 mb-2">
              <SparkleSmallSvg size={18} />
              {t("antiCheat.section3Title")}
            </h2>
            <p className="font-body text-sm leading-relaxed text-candy-ink/85 font-medium">
              {t("antiCheat.section3Desc")}
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-[#FFE5EC] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
            <h2 className="font-display font-black text-base uppercase text-candy-ink flex items-center gap-2 mb-2">
              <SparkleSmallSvg size={18} />
              {t("antiCheat.section4Title")}
            </h2>
            <p className="font-body text-sm leading-relaxed text-candy-ink/85 font-medium">
              {t("antiCheat.section4Desc")}
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t-3 border-candy-ink flex justify-between items-center">
          <Link
            href="/terms"
            className="font-display text-xs font-black uppercase text-candy-blue hover:underline"
          >
            ← {t("termsTitle")}
          </Link>

          <Link
            href="/"
            className="px-6 py-3 bg-candy-mint hover:bg-candy-mint/90 text-white border-3 border-candy-ink rounded-2xl font-display font-black text-xs uppercase shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] transition-all"
          >
            {t("close")}
          </Link>
        </div>
      </div>
    </main>
  );
}
