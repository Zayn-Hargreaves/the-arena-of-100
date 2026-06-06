"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";

export default function LocalNotFound() {
  const t = useTranslations("NotFoundPage");
  const locale = useLocale();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-3 focus:rounded-2xl focus:bg-white focus:text-candy-ink focus:border-[3px] focus:border-candy-ink focus:shadow-[4px_4px_0_0_#2B2D42] focus:font-display focus:font-black focus:text-xs focus:uppercase"
      >
        Skip to main content
      </a>
      <main
        id="main-content"
        className="min-h-[80vh] flex flex-col items-center justify-center p-4 relative overflow-hidden select-none z-10"
      >
        {/* Sleek Vector Floating Geometric Shapes Background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0 opacity-15">
          {/* Floating Sparkle Star Left */}
          <div className="absolute top-[10%] left-[10%] animate-pulse">
            <svg
              className="w-16 h-16 text-candy-mint"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0L14.8 9.2L24 12L14.8 14.8L12 24L9.2 14.8L0 12L9.2 9.2Z" />
            </svg>
          </div>
          {/* Floating Sparkle Star Right */}
          <div className="absolute bottom-[15%] right-[10%] animate-pulse delay-500">
            <svg
              className="w-20 h-20 text-candy-pink"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0L14.8 9.2L24 12L14.8 14.8L12 24L9.2 14.8L0 12L9.2 9.2Z" />
            </svg>
          </div>
          {/* Retro Target Circle Right */}
          <div className="absolute top-[15%] right-[12%]">
            <svg
              className="w-16 h-16 text-candy-mint animate-spin"
              style={{ animationDuration: "12s" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="4 4"
            >
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>
        </div>

        <div className="w-full max-w-xl relative z-10 text-center space-y-6">
          {/* Logo & Bouncing Crown SVG */}
          <div className="relative mb-2 flex flex-col items-center">
            <svg
              className="w-16 h-16 select-none block animate-bounce text-candy-yellow"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2.5 18.5l1.5-10 5.5 4 2.5-6 2.5 6 5.5-4 1.5 10z" />
              <path d="M2.5 18.5h19v2h-19z" />
            </svg>
            <h1 className="text-4xl font-extrabold text-candy-ink drop-shadow-[3px_3px_0_#FFE5EC] uppercase tracking-tight transform -rotate-2 mt-4">
              ARENA OF 100
            </h1>
          </div>

          {/* Quiz Battle Neobrutalist Card */}
          <div className="bg-white border-3 border-candy-ink rounded-[2rem] p-6 sm:p-8 shadow-[8px_8px_0_0_#2B2D42] text-left space-y-6 transform rotate-1">
            {/* Header / Round Status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-4 border-candy-ink pb-4">
              <div className="bg-candy-red text-white font-black text-sm px-4 py-2 border-4 border-candy-ink rounded-full inline-block uppercase tracking-wide transform -rotate-2">
                <svg
                  className="w-4 h-4 inline-block"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M12 2L2 20h20L12 2z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <circle cx="12" cy="16" r="0.5" fill="currentColor" />
                </svg>{" "}
                {t("title")}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500 uppercase">
                  {t("timeRemaining")}
                </span>
                {/* SVG Timer */}
                <div className="bg-candy-yellow text-candy-ink font-black px-3 py-1 border-3 border-candy-ink rounded-lg flex items-center gap-1.5 animate-pulse">
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>15s</span>
                </div>
              </div>
            </div>

            {/* Simulated Round Timer Progress Bar */}
            <div className="w-full h-5 bg-gray-100 border-4 border-candy-ink rounded-full overflow-hidden relative">
              <div
                className="h-full bg-candy-pink border-r-4 border-candy-ink animate-[pulse_1s_infinite]"
                style={{
                  width: "70%",
                  backgroundImage:
                    "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(43,45,66,0.15) 10px, rgba(43,45,66,0.15) 20px)",
                }}
              />
            </div>

            {/* The Question Area */}
            <div className="bg-[#FFF0F5] border-4 border-candy-ink rounded-2xl p-5 shadow-[4px_4px_0_0_#2B2D42] space-y-2">
              <span className="text-xs font-black text-candy-pink uppercase tracking-widest block">
                {t("questionLabel")}
              </span>
              <p className="text-lg sm:text-xl font-bold text-candy-ink leading-relaxed">
                {t("question")}
              </p>
            </div>

            {/* The Answers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Option A - Bait */}
              <div className="w-full bg-[#FFF] text-left p-4 border-4 border-candy-ink rounded-2xl shadow-[4px_4px_0_0_#2B2D42] opacity-75 cursor-not-allowed hover:bg-red-50 transition-all select-none group relative overflow-hidden text-sm sm:text-base">
                {t("optionA")}
                <div className="absolute right-3 top-3.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg
                    className="w-6 h-6 text-candy-red"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </div>
              </div>

              {/* Option B - Bait */}
              <div className="w-full bg-[#FFF] text-left p-4 border-4 border-candy-ink rounded-2xl shadow-[4px_4px_0_0_#2B2D42] opacity-75 cursor-not-allowed hover:bg-red-50 transition-all select-none group relative overflow-hidden text-sm sm:text-base">
                {t("optionB")}
                <div className="absolute right-3 top-3.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg
                    className="w-6 h-6 text-candy-red"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </div>
              </div>

              {/* Option C - Bait */}
              <div className="w-full bg-[#FFF] text-left p-4 border-4 border-candy-ink rounded-2xl shadow-[4px_4px_0_0_#2B2D42] opacity-75 cursor-not-allowed hover:bg-red-50 transition-all select-none group relative overflow-hidden text-sm sm:text-base">
                {t("optionC")}
                <div className="absolute right-3 top-3.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg
                    className="w-6 h-6 text-candy-red"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </div>
              </div>

              {/* Option D - CORRECT LINK */}
              <Link
                href={`/${locale}`}
                className="w-full bg-candy-mint text-white text-left p-4 border-4 border-candy-ink rounded-2xl shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-1 active:translate-y-1 active:shadow-[0px_0px_0_0_#2B2D42] transition-all block relative overflow-hidden group font-bold text-sm sm:text-base"
              >
                {t("optionD")}
                <div className="absolute right-4 top-3.5 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1">
                  <svg
                    className="w-6 h-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
