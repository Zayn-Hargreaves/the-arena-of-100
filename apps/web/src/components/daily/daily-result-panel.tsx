"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { DailySubmitResponse } from "@/types/daily";
import { playSfx } from "@/lib/sound-engine";
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

  React.useEffect(() => {
    playSfx(allCorrect ? "victory" : "correct");
  }, [allCorrect]);

  // Locale-aware score format (e.g. "1,234" in en, "1.234" in vi).
  const formattedScore = format.number(result.score);
  const accuracyPct = Math.round(
    (result.correctCount / result.totalQuestions) * 100,
  );

  return (
    <div className="space-y-6">
      {/* Score Hero Banner */}
      <div className="bg-candy-yellow border-[3px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] rounded-2xl p-6 relative overflow-hidden space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-dashed border-candy-ink/25 pb-4">
          <div>
            <div className="font-mono text-[11px] font-black uppercase tracking-wider text-candy-ink/75">
              {t("result.score")}
            </div>
            <div className="font-display font-black text-4xl sm:text-5xl text-candy-ink tracking-tight">
              {formattedScore}
              <span className="text-lg sm:text-xl font-mono text-candy-ink/70 ml-2 font-bold">
                PTS
              </span>
            </div>
          </div>

          {allCorrect ? (
            <div className="bg-candy-mint border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] rounded-xl px-3.5 py-2 inline-flex items-center gap-2 self-start sm:self-auto">
              <CheckGlyph className="text-candy-ink" size={18} />
              <span className="font-display font-black text-xs uppercase text-candy-ink">
                {t("result.perfectRun")}
              </span>
            </div>
          ) : (
            <div className="bg-white/80 border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] rounded-xl px-3.5 py-1.5 inline-flex items-center gap-2 self-start sm:self-auto">
              <span className="font-mono font-black text-xs text-candy-ink">
                {accuracyPct}% {t("result.correct").toLowerCase()}
              </span>
            </div>
          )}
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] rounded-xl p-3 text-center space-y-1">
            <div className="font-mono text-[10px] font-black uppercase text-candy-ink/60">
              {t("result.correct")}
            </div>
            <div className="font-display font-black text-lg sm:text-xl text-candy-ink">
              {result.correctCount}/{result.totalQuestions}
            </div>
          </div>

          <div className="bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] rounded-xl p-3 text-center space-y-1">
            <div className="font-mono text-[10px] font-black uppercase text-candy-ink/60">
              {t("result.streak")}
            </div>
            <div className="font-display font-black text-lg sm:text-xl text-candy-ink inline-flex items-center justify-center gap-1">
              {result.streakAfter}
              <StreakGlyph className="text-candy-pink" size={16} />
            </div>
          </div>

          <div className="bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] rounded-xl p-3 text-center space-y-1">
            <div className="font-mono text-[10px] font-black uppercase text-candy-ink/60">
              {t("result.speed")}
            </div>
            <div className="font-display font-black text-sm sm:text-base text-candy-ink truncate">
              {speedBonusLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Question Breakdown List */}
      <div className="space-y-3">
        <h3 className="font-display font-black text-base text-candy-ink uppercase tracking-wider">
          Chi tiết câu hỏi
        </h3>

        <div className="space-y-2.5">
          {result.results.map((r, i) => (
            <div
              key={i}
              className={`border-[2px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] rounded-2xl p-4 transition-all ${
                r.isCorrect ? "bg-candy-mint/15" : "bg-candy-pink/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] shrink-0 font-display font-black text-xs ${
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

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono text-xs font-black text-candy-ink">
                      {t("result.questionLabel", { index: i + 1 })}
                    </span>
                    <span
                      className={`font-mono text-[10px] font-black uppercase px-2 py-0.5 rounded border border-candy-ink/30 ${
                        r.isCorrect
                          ? "bg-candy-mint/40 text-emerald-900"
                          : "bg-candy-pink/30 text-rose-900"
                      }`}
                    >
                      {r.isCorrect
                        ? t("result.srCorrect")
                        : t("result.srIncorrect")}
                    </span>
                  </div>

                  {/* Answers chosen vs correct */}
                  <div className="flex flex-wrap items-center gap-2 text-sm font-body">
                    <span
                      className={`px-2 py-0.5 rounded-lg border font-mono font-bold text-xs ${
                        r.isCorrect
                          ? "bg-white border-emerald-400 text-emerald-900"
                          : "bg-white border-rose-400 text-rose-800 line-through"
                      }`}
                    >
                      {r.answer || t("result.skipped")}
                    </span>

                    {!r.isCorrect && (
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-100 border border-emerald-400 text-emerald-900 font-mono font-black text-xs">
                        {t("result.correctAnswer", { answer: r.correctAnswer })}
                      </span>
                    )}
                  </div>

                  {/* Explanation card */}
                  {r.explanation && (
                    <div className="bg-white/80 border border-candy-ink/20 rounded-xl p-3 text-xs font-body text-candy-ink/80 leading-relaxed">
                      <span className="font-bold text-candy-ink block mb-0.5">
                        Giải thích:
                      </span>
                      {r.explanation}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
