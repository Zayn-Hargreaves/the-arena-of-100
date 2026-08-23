import React from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { FlameSvg, SmileySvg, SwordsSvg } from "@/components/home/home-icons";

export function HomeFooter() {
  const t = useTranslations("HomePage");

  return (
    <footer className="bg-candy-ink text-white w-full py-8 sm:py-10 border-t-4 border-candy-ink relative z-10 shadow-[0_-4px_0_0_#2B2D42]">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center px-6 md:px-12 lg:px-16 gap-6">
        <div className="flex flex-col items-center md:items-start gap-1.5 text-center md:text-left">
          <div className="font-display font-black text-xl text-candy-yellow flex items-center gap-2.5 tracking-wide">
            <span className="w-8 h-8 rounded-xl bg-candy-yellow/20 border border-candy-yellow/40 flex items-center justify-center text-candy-yellow shadow-[1px_1px_0_0_#2B2D42]">
              <SwordsSvg size={18} />
            </span>
            <span>{t("brandFull")}</span>
          </div>
          <p className="font-mono text-xs font-semibold text-slate-300 flex items-center gap-2 flex-wrap justify-center md:justify-start">
            <span>{t("footerCopyright")}</span>
            <span className="inline-flex items-center gap-1.5 bg-white/10 px-2 py-0.5 rounded-md border border-white/15">
              <SmileySvg size={14} className="inline-block" />
              <FlameSvg size={14} className="inline-block text-candy-yellow" />
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-center">
          <Link
            href="/terms"
            className="font-mono text-xs font-bold text-slate-200 bg-white/10 hover:bg-candy-yellow hover:text-candy-ink hover:border-candy-ink border border-white/20 rounded-xl px-4 py-2 shadow-[2px_2px_0_0_rgba(0,0,0,0.3)] transition-all cursor-pointer"
          >
            {t("terms")}
          </Link>
          <Link
            href="/rules"
            className="font-mono text-xs font-bold text-slate-200 bg-white/10 hover:bg-candy-pink hover:text-white hover:border-candy-ink border border-white/20 rounded-xl px-4 py-2 shadow-[2px_2px_0_0_rgba(0,0,0,0.3)] transition-all cursor-pointer"
          >
            {t("antiCheat")}
          </Link>
        </div>
      </div>
    </footer>
  );
}
