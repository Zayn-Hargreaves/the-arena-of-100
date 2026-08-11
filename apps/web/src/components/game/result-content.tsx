import {
  Home,
  Hourglass,
  RotateCcw,
  Swords,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { Avatar } from "@/components/ui/avatar";

interface WinnerViewModel {
  name: string;
  spritesheet: string;
  isAnimated: boolean;
  totalScore: number;
  averageSpeed: string;
  accuracy: string;
}

interface PerformanceViewModel {
  rank: number;
  score: number;
  speed: string;
  accuracy: string;
  eliminatedRound?: number | null;
}

interface ResultContentProps {
  matchId: string;
  winner: WinnerViewModel;
  performance: PerformanceViewModel;
  onRematch: () => void;
  onHome: () => void;
}

export function ResultContent({
  matchId,
  winner,
  performance,
  onRematch,
  onHome,
}: ResultContentProps) {
  const t = useTranslations("Result");

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

      <div className="p-6 md:p-8 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42] flex flex-col md:flex-row items-center gap-6 relative overflow-hidden transition-all hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#2B2D42]">
        <div className="bg-candy-yellow text-candy-ink border-[2.5px] border-candy-ink px-3 py-1 text-[9px] font-display font-black tracking-wider rounded-lg absolute top-3 right-3 shadow-[2px_2px_0_0_#2B2D42]">
          {t("championBadge")}
        </div>
        <div className="relative shrink-0">
          {winner.isAnimated && winner.spritesheet ? (
            <div className="w-24 h-24 border-[3.5px] border-candy-ink rounded-2xl bg-candy-cloud overflow-hidden flex items-center justify-center relative shadow-[4px_4px_0_0_#2B2D42]">
              <AnimatedSprite
                src={winner.spritesheet}
                scale={3.8}
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
          <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-candy-yellow text-candy-ink flex items-center justify-center border-[3px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42]">
            <Trophy className="w-5 h-5 fill-candy-ink stroke-[2.5]" />
          </div>
        </div>
        <div className="flex-1 space-y-4 text-center md:text-left">
          <div className="space-y-1">
            <h2 className="font-display font-black text-2xl text-candy-pink uppercase tracking-wider">
              {winner.name}
            </h2>
            <p className="font-sans font-bold text-sm text-candy-ink/75 leading-relaxed">
              {t("championDescription")}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
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
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42] space-y-4 md:col-span-2">
          <h3 className="font-display font-black text-base text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-2">
            <Swords className="w-5 h-5 text-candy-pink stroke-[2.5]" />
            {t("performance.title")}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <PerformanceCard
              label={t("performance.rank")}
              value={`#${performance.rank}`}
              color="pink"
              icon={<Trophy className="w-4 h-4 text-candy-pink stroke-[2.5]" />}
            />
            <PerformanceCard
              label={t("performance.score")}
              value={performance.score}
              color="cloud"
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
                <Hourglass className="w-4 h-4 text-candy-blue stroke-[2.5]" />
              }
            />
            <PerformanceCard
              label={t("performance.accuracy")}
              value={performance.accuracy}
              color="yellow"
              icon={
                <Target className="w-4 h-4 text-candy-orange stroke-[2.5]" />
              }
            />
            <PerformanceCard
              label={t("performance.reactionSpeed")}
              value={performance.speed}
              color="mint"
              icon={<Zap className="w-4 h-4 text-candy-mint stroke-[2.5]" />}
            />
          </div>
        </div>

        <div className="p-6 rounded-3xl border-[3.5px] border-candy-ink bg-candy-cloud flex flex-col justify-center gap-4 shadow-[6px_6px_0_0_#2B2D42]">
          <ActionButton onClick={onRematch} color="pink" icon={<RotateCcw />}>
            {t("actions.rematch")}
          </ActionButton>
          <ActionButton onClick={onHome} color="blue" icon={<Home />}>
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
  return (
    <div
      className={`p-4 ${background} border-[3px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] space-y-1`}
    >
      <span className="text-[10px] text-candy-ink/75 font-display font-black uppercase flex items-center gap-1.5 leading-none">
        {icon}
        {label}
      </span>
      <span className="font-display font-black text-2xl text-candy-ink block pt-1">
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  onClick,
  color,
  icon,
  children,
}: {
  onClick: () => void;
  color: "pink" | "blue";
  icon: ReactElement<{ className?: string }>;
  children: ReactNode;
}) {
  const background = color === "pink" ? "bg-candy-pink" : "bg-candy-blue";
  return (
    <button
      onClick={onClick}
      className={`w-full h-12 ${background} text-candy-ink border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center justify-center cursor-pointer transition-all outline-none`}
    >
      {cloneElement(icon, { className: "w-4 h-4 mr-2 stroke-[2.5]" })}
      {children}
    </button>
  );
}
