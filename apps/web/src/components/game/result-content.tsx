import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { Avatar } from "@/components/ui/avatar";
import type {
  PerformanceViewModel,
  WinnerViewModel,
} from "@/hooks/use-match-results";
import { ProfessorAvatar } from "@/components/character/professor-avatar";
import {
  getRandomProfessorDialogue,
  type ProfessorMood,
} from "@/components/character/professor-roast-engine";

interface ResultContentProps {
  matchId: string;
  winner: WinnerViewModel;
  performance: PerformanceViewModel;
  opponents: number;
  onRematch: () => void;
  onHome: () => void;
}

export function ResultContent({
  matchId,
  winner,
  performance,
  opponents,
  onRematch,
  onHome,
}: ResultContentProps) {
  const t = useTranslations("Result");
  const tProf = useTranslations("Professor");
  const locale = useLocale();

  const isWinner =
    performance.isWinner ||
    (performance.rank === 1 && !performance.eliminatedRound);
  const isEliminated = !isWinner;
  const rank = performance.rank;
  const isTop10 =
    !isWinner && typeof rank === "number" && rank >= 2 && rank <= 10;

  const evaluationMood: ProfessorMood = isWinner
    ? "proud_cheer"
    : isTop10
      ? "proud_cheer"
      : "angry_roast";

  const evaluationText = isWinner
    ? getRandomProfessorDialogue("result_winner", locale).text
    : isTop10
      ? getRandomProfessorDialogue("result_top10", locale).text
      : getRandomProfessorDialogue("result_early_elim", locale).text;

  const gradeBadge = isWinner
    ? tProf("grades.valedictorian")
    : isTop10
      ? tProf("grades.honor")
      : tProf("grades.remedial");

  return (
    <div className="max-w-4xl mx-auto w-full space-y-8 pt-2 select-none animate-slide-up">
      <div className="text-center space-y-1">
        <span className="font-display font-black text-[10px] text-candy-pink uppercase tracking-widest animate-pulse">
          {t("reportLabel")}
        </span>
        <h1 className="font-display font-black text-4xl md:text-5xl text-candy-ink uppercase drop-shadow-[0_3px_0_rgba(0,0,0,0.05)]">
          {t("title")}
        </h1>
        <p className="font-mono text-[9px] text-candy-ink/60 uppercase font-black tracking-widest">
          {t("matchId", { matchId: matchId.toUpperCase() })}
        </p>
      </div>

      <div className="p-6 pt-9 md:p-8 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42] flex flex-col md:flex-row items-center gap-6 relative overflow-hidden transition-all hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#2B2D42]">
        <div className="bg-candy-yellow text-candy-ink border-[2.5px] border-candy-ink px-3 py-1 text-[10px] font-display font-black tracking-wider rounded-xl absolute top-3 right-3 shadow-[2px_2px_0_0_#2B2D42] flex items-center gap-1.5 z-10">
          <MiniGlyph
            variant="trophy"
            className="w-3.5 h-3.5 text-candy-ink stroke-[2.5] shrink-0"
          />
          <span>{t("championBadge")}</span>
        </div>
        <div className="relative shrink-0 mt-1 md:mt-0">
          {winner.isAnimated && winner.spritesheet ? (
            <div className="w-24 h-24 border-[3.5px] border-candy-ink rounded-2xl bg-candy-cloud overflow-hidden flex items-center justify-center relative shadow-[4px_4px_0_0_#2B2D42]">
              <AnimatedSprite
                src={winner.spritesheet}
                width="96px"
                height="96px"
                scale={0.5}
                row={0}
                speed={120}
              />
            </div>
          ) : (
            <Avatar
              size="xl"
              fallback={winner.name}
              className="border-[3.5px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42]"
            />
          )}
        </div>
        <div className="flex-1 space-y-4 text-center md:text-left">
          <div className="space-y-1">
            <h2 className="font-display font-black text-2xl text-candy-pink uppercase tracking-wider">
              {winner.name}
            </h2>
            <p className="font-sans font-bold text-sm text-candy-ink/75 leading-relaxed">
              {t("championDescription", { opponents })}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <Metric
              label={t("metrics.score")}
              value={winner.totalScore}
              color="pink"
            />
            <Metric
              label={t("metrics.accuracy")}
              value={winner.accuracy}
              color="blue"
            />
            <Metric
              label={t("metrics.reaction")}
              value={winner.averageSpeed}
              color="mint"
            />
            <Metric
              label={t("metrics.survivedRounds")}
              value={winner.survivedRounds}
              color="blue"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42] space-y-4 md:col-span-2">
          <h3 className="font-display font-black text-base text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-2">
            <MiniGlyph
              variant="swords"
              className="w-5 h-5 text-candy-pink stroke-[2.5]"
            />
            {t("performance.title")} · {performance.name}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <PerformanceCard
              label={t("performance.rank")}
              value={
                isWinner
                  ? "#1"
                  : performance.rank !== null && performance.rank !== undefined
                    ? `#${performance.rank}`
                    : isEliminated
                      ? t("performance.eliminated")
                      : "--"
              }
              color="pink"
              icon={
                <MiniGlyph
                  variant="trophy"
                  className="w-4 h-4 text-candy-pink stroke-[2.5]"
                />
              }
            />
            <PerformanceCard
              label={t("performance.score")}
              value={performance.score}
              color="cloud"
            />
            <PerformanceCard
              label={t("performance.elo")}
              value={
                performance.eloDelta !== undefined &&
                performance.eloDelta !== null
                  ? `${performance.eloDelta > 0 ? "+" : ""}${performance.eloDelta} ELO`
                  : "--"
              }
              color={
                (performance.eloDelta ?? 0) > 0
                  ? "mint"
                  : (performance.eloDelta ?? 0) < 0
                    ? "pink"
                    : "cloud"
              }
              icon={
                <MiniGlyph
                  variant="shield"
                  className="w-4 h-4 text-candy-blue stroke-[2.5]"
                />
              }
            />
            <PerformanceCard
              label={t("performance.eliminatedRound")}
              value={
                performance.eliminatedRound
                  ? t("performance.roundValue", {
                      round: performance.eliminatedRound,
                    })
                  : "--"
              }
              color="blue"
              icon={
                <MiniGlyph
                  variant="hourglass"
                  className="w-4 h-4 text-candy-blue stroke-[2.5]"
                />
              }
            />
            <PerformanceCard
              label={t("performance.accuracy")}
              value={performance.accuracy}
              color="yellow"
              icon={
                <MiniGlyph
                  variant="target"
                  className="w-4 h-4 text-candy-orange stroke-[2.5]"
                />
              }
            />
            <PerformanceCard
              label={t("performance.reactionSpeed")}
              value={performance.speed}
              color="mint"
              icon={
                <MiniGlyph
                  variant="zap"
                  className="w-4 h-4 text-candy-mint stroke-[2.5]"
                />
              }
            />
          </div>

          {/* Professor Academic Evaluation / Sổ liên lạc của Giáo sư */}
          <div className="p-4 sm:p-5 rounded-3xl border-[3.5px] border-candy-ink bg-[#FFFDF5] shadow-[4px_4px_0_0_#2B2D42] flex flex-col sm:flex-row items-center sm:items-start gap-4 overflow-hidden">
            <div className="shrink-0 pt-0.5">
              <ProfessorAvatar mood={evaluationMood} size="md" showNameplate />
            </div>

            <div className="flex-1 text-center sm:text-left space-y-2 min-w-0 w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-2 border-candy-ink/15 pb-1.5">
                <span className="font-display font-black text-xs text-candy-pink uppercase tracking-wide">
                  {tProf("evalLabel")}
                </span>
                <span
                  className={`self-center sm:self-auto inline-block border-[2px] border-candy-ink px-3 py-0.5 rounded-lg font-display font-black text-[10px] uppercase tracking-wider shadow-[2px_2px_0_0_#2B2D42] shrink-0 ${
                    isWinner
                      ? "bg-candy-yellow text-candy-ink"
                      : isTop10
                        ? "bg-candy-mint text-candy-ink"
                        : "bg-candy-yellow text-candy-ink"
                  }`}
                >
                  {gradeBadge}
                </span>
              </div>
              <p className="font-sans font-bold text-xs sm:text-sm text-candy-ink leading-relaxed tracking-normal">
                &ldquo;{evaluationText}&rdquo;
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-3xl border-[3.5px] border-candy-ink bg-candy-cloud flex flex-col justify-center gap-4 shadow-[6px_6px_0_0_#2B2D42]">
          <ActionButton onClick={onRematch} color="pink" glyph="rematch">
            {t("actions.rematch")}
          </ActionButton>
          <ActionButton onClick={onHome} color="blue" glyph="home">
            {t("actions.home")}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: "pink" | "blue" | "mint";
}) {
  const textColor = {
    pink: "text-candy-pink",
    blue: "text-candy-blue",
    mint: "text-candy-mint",
  }[color];
  return (
    <div className="p-2.5 bg-candy-cloud border-[2px] border-candy-ink rounded-xl shadow-[2px_2px_0_0_#2B2D42]">
      <span className="block text-[8px] text-candy-ink/65 uppercase font-display font-black">
        {label}
      </span>
      <span className={`font-display font-black text-sm ${textColor}`}>
        {value}
      </span>
    </div>
  );
}

function PerformanceCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  color: "pink" | "cloud" | "blue" | "yellow" | "mint";
  icon?: ReactNode;
}) {
  const background = {
    pink: "bg-candy-pink/10",
    cloud: "bg-candy-cloud",
    blue: "bg-candy-blue/10",
    yellow: "bg-candy-yellow/10",
    mint: "bg-candy-mint/10",
  }[color];

  const valueStr = String(value);
  const fontSize =
    valueStr.length > 8
      ? "text-xs sm:text-sm tracking-tight"
      : valueStr.length > 5
        ? "text-sm sm:text-base tracking-tight"
        : "text-2xl";

  return (
    <div
      className={`p-3.5 sm:p-4 ${background} border-[3px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] flex flex-col justify-between overflow-hidden min-h-[84px]`}
    >
      <span className="text-[10px] text-candy-ink/75 font-display font-black uppercase flex items-center gap-1.5 leading-none shrink-0 truncate">
        {icon}
        {label}
      </span>
      <span
        className={`font-display font-black text-candy-ink block pt-1 leading-tight break-words uppercase ${fontSize}`}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  onClick,
  color,
  glyph,
  children,
}: {
  onClick: () => void;
  color: "pink" | "blue";
  glyph: "rematch" | "home";
  children: ReactNode;
}) {
  const background = color === "pink" ? "bg-candy-pink" : "bg-candy-blue";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full h-12 ${background} text-candy-ink border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer transition-all outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-ink focus-visible:ring-offset-2 focus-visible:ring-offset-candy-bg`}
    >
      <MiniGlyph variant={glyph} className="w-4 h-4 stroke-[2.5]" />
      {children}
    </button>
  );
}
