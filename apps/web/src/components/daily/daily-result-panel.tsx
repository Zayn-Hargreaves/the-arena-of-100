"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { DailySubmitResponse } from "@/types/daily";
import { StreakGlyph, CheckGlyph, CrossGlyph } from "./daily-glyph";

interface DailyResultPanelProps {
  result: DailySubmitResponse;
  speedBonusLabel: string;
}

export function DailyResultPanel({
  result,
  speedBonusLabel,
}: Readonly<DailyResultPanelProps>) {
  const t = useTranslations("daily");
  const format = useFormatter();
  const allCorrect = result.correctCount === result.totalQuestions;

  // Locale-aware score format (e.g. "1,234" in en, "1.234" in vi).
  const formattedScore = format.number(result.score);

  return (
    <div className="space-y-5">
      <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] rounded-2xl p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display font-black text-xs uppercase tracking-wider text-candy-ink/70">
            {t("result.score")}
          </span>
          <span className="font-display font-black text-3xl text-candy-ink tracking-wider">
            {formattedScore}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border-[2px] border-candy-ink/30 rounded-xl px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase text-candy-ink/60">
              {t("result.correct")}
            </div>
            <div className="font-display font-black text-base text-candy-ink">
              {result.correctCount}/{result.totalQuestions}
            </div>
          </div>
          <div className="bg-white border-[2px] border-candy-ink/30 rounded-xl px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase text-candy-ink/60">
              {t("result.streak")}
            </div>
            <div className="font-display font-black text-base text-candy-ink inline-flex items-center justify-center gap-1">
              {result.streakAfter}
              <StreakGlyph className="text-candy-pink" size={14} />
            </div>
          </div>
          <div className="bg-white border-[2px] border-candy-ink/30 rounded-xl px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase text-candy-ink/60">
              {t("result.speed")}
            </div>
            <div className="font-display font-black text-base text-candy-ink">
              {speedBonusLabel}
            </div>
          </div>
        </div>
        {allCorrect ? (
          <p className="font-body text-sm font-semibold text-candy-mint">
            {t("result.perfectRun")}
          </p>
        ) : null}
      </div>

      <ul className="space-y-2">
        {result.results.map((r, i) => (
          <li
            key={i}
            className={`flex items-center gap-3 border-[2px] rounded-xl px-3 py-2 ${
              r.isCorrect
                ? "border-candy-mint bg-candy-mint/20"
                : "border-candy-pink/40 bg-candy-pink/10"
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full border-[2px] border-candy-ink ${
                r.isCorrect
                  ? "bg-candy-mint text-candy-ink"
                  : "bg-candy-pink text-white"
              }`}
              aria-hidden="true"
            >
              {r.isCorrect ? (
                <CheckGlyph className="text-current" size={16} />
              ) : (
                <CrossGlyph className="text-current" size={16} />
              )}
            </span>
            {/* The icon above is decorative (aria-hidden); this carries
                the pass/fail meaning for assistive tech. */}
            <span className="sr-only">
              {t(r.isCorrect ? "result.srCorrect" : "result.srIncorrect")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-body text-sm font-semibold text-candy-ink truncate">
                {t("result.questionLabel", { index: i + 1 })}:{" "}
                {r.answer || t("result.skipped")}
              </div>
              {!r.isCorrect ? (
                <div className="font-mono text-[11px] text-candy-ink/70">
                  {t("result.correctAnswer", { answer: r.correctAnswer })}
                </div>
              ) : null}
              {r.explanation ? (
                <div className="font-body text-xs text-candy-ink/70 mt-1">
                  {r.explanation}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
