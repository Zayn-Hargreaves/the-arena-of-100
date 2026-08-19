"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CardGlyph } from "./card-glyphs";

export interface QuestionCardProps {
  hasCurrentQuestion: boolean;
  questionText: string;
  roundCompleted: boolean;
  hasAnswered?: boolean;
  isFoggy?: boolean;
  isDelayRender?: boolean;
  isSemanticFlipped?: boolean;
  hintPartial?: string | null;
}

/**
 * The question panel. Renders the current question text, or a loading
 * skeleton when the question is not yet available (late hydration /
 * pre-ROUND_STARTED / snapshot gap) instead of stale fallback content.
 */
export const QuestionCard: React.FC<QuestionCardProps> = ({
  hasCurrentQuestion,
  questionText,
  roundCompleted,
  hasAnswered = false,
  isFoggy = false,
  isDelayRender = false,
  isSemanticFlipped = false,
  hintPartial = null,
}) => {
  const t = useTranslations("Game");

  return (
    <div className="p-6 md:p-10 rounded-3xl border-[3.5px] border-candy-ink bg-candy-yellow text-candy-ink shadow-[6px_6px_0_0_#2B2D42] flex flex-col justify-between min-h-[200px] relative overflow-hidden">
      {/* Fog Visual Overlay (CB-5) */}
      {isFoggy && (
        <div className="absolute inset-0 z-30 bg-slate-900/60 backdrop-blur-md flex flex-col items-center justify-center text-white p-4 animate-fade-in text-center">
          <div className="bg-candy-ink/80 p-3 rounded-2xl border-2 border-white/40 shadow-lg flex items-center gap-3">
            <CardGlyph
              variant="fog"
              size={32}
              className="text-candy-cloud animate-pulse"
            />
            <div className="text-left">
              <span className="font-display font-black text-xs uppercase tracking-wider block text-candy-yellow">
                SƯƠNG MÙ TRÍ NÃO (CB-5)
              </span>
              <span className="text-xs opacity-90">
                Câu hỏi đang bị che phủ trong màn sương mờ...
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Delay Render Overlay (CB-2) */}
      {isDelayRender && (
        <div className="absolute inset-0 z-30 bg-candy-orange/90 backdrop-blur-sm flex flex-col items-center justify-center text-white p-4 animate-fade-in text-center">
          <div className="flex items-center gap-3 bg-candy-ink p-4 rounded-2xl border-2 border-candy-yellow shadow-md">
            <CardGlyph
              variant="delay"
              size={28}
              className="text-candy-yellow animate-spin"
            />
            <div className="text-left">
              <span className="font-display font-black text-xs uppercase tracking-wider block text-candy-yellow">
                PHÁ HOẠI CÂU HỎI (CB-2)
              </span>
              <span className="text-xs">
                Nội dung câu hỏi đang bị đối thủ trì hoãn hiển thị!
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Semantic Flip Warning (CB-7) */}
      {isSemanticFlipped && (
        <div className="mb-3 bg-candy-red text-white px-3.5 py-1.5 rounded-xl border-[2.5px] border-candy-ink shadow-[2.5px_2.5px_0_0_#2B2D42] flex items-center justify-between gap-2 animate-bounce">
          <div className="flex items-center gap-2">
            <CardGlyph
              variant="reverse"
              size={18}
              className="text-candy-yellow shrink-0 animate-spin"
            />
            <span className="text-xs font-black uppercase tracking-wide">
              LẬT NGỮ NGHĨA (CB-7): Câu hỏi đã bị quay ngược 180°!
            </span>
          </div>
          <span className="text-[10px] bg-white/25 px-2 py-0.5 rounded-md font-mono font-black shrink-0">
            FLIPPED
          </span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 w-full mb-3">
        <div className="bg-white border-[2px] border-candy-ink px-2.5 py-0.5 text-[9px] sm:text-[10px] font-mono text-candy-ink font-black tracking-wider rounded-lg shadow-[1.5px_1.5px_0_0_#2B2D42] shrink-0">
          {t("rulesHeader")}
        </div>
        <div className="text-[11px] sm:text-xs font-display font-black text-candy-pink animate-pulse flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-candy-pink border border-candy-ink shrink-0" />
          <span className="whitespace-nowrap">
            {roundCompleted
              ? t("lockedAnswer")
              : hasAnswered
                ? t("answerSubmitted")
                : t("waiting")}
          </span>
        </div>
      </div>

      <h2
        className={cn(
          "font-sans font-bold text-lg md:text-2xl text-candy-ink leading-relaxed tracking-wide my-auto transition-transform duration-500",
          isSemanticFlipped && "scale-y-[-1] scale-x-[-1] select-none",
        )}
      >
        {/* Render a loading skeleton when the current question is not
            yet available, instead of stale fallback content. */}
        {hasCurrentQuestion ? (
          questionText
        ) : (
          <div
            data-testid="loading-question"
            className="animate-pulse text-center text-candy-ink/50 py-4"
          >
            {t("loadingQuestion")}
          </div>
        )}
      </h2>

      {/* Hint Reveal Box (TN-3) */}
      {hintPartial && (
        <div className="mt-4 bg-white/95 border-[2.5px] border-candy-ink p-3.5 rounded-2xl shadow-[3px_3px_0_0_#2B2D42] flex items-center gap-3 animate-slide-up">
          <div className="w-9 h-9 rounded-xl bg-candy-mint flex items-center justify-center border-[2px] border-candy-ink shrink-0 shadow-xs">
            <CardGlyph variant="hint" size={20} className="text-candy-ink" />
          </div>
          <div className="text-left">
            <span className="font-display font-black text-[10px] uppercase tracking-wider text-candy-ink/60 block">
              GỢI Ý TỪ THẺ BÀI (TN-3)
            </span>
            <span className="font-mono font-black text-sm text-candy-ink">
              Đáp án bắt đầu bằng ký tự:{" "}
              <span className="text-candy-pink underline text-base font-display font-black">
                {hintPartial}
              </span>
              ...
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

QuestionCard.displayName = "QuestionCard";
