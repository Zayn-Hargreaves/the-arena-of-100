import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CardGlyph } from "./card-glyphs";

export interface TimeDelta {
  deltaSeconds: number;
  key: number;
}

export interface TimerProps {
  duration: number; // Max round duration in seconds (e.g., 15)
  timeLeft: number; // Current seconds left (e.g., 12.5)
  size?: number; // Width of the component in pixels
  height?: number; // Height of the component in pixels
  showText?: boolean;
  timeDelta?: TimeDelta | null;
  className?: string;
}

interface TimeDeltaBadgeProps {
  deltaSeconds: number;
  size?: "sm" | "md";
  className?: string;
}

const TimeDeltaBadge: React.FC<TimeDeltaBadgeProps> = ({
  deltaSeconds,
  size = "md",
  className,
}) => {
  const t = useTranslations("Timer");
  if (deltaSeconds === 0) return null;
  const isPositive = deltaSeconds > 0;
  const isSm = size === "sm";
  const absSeconds = Math.abs(deltaSeconds);
  const announcement = isPositive
    ? t("secondsAdded", { count: absSeconds })
    : t("secondsRemoved", { count: absSeconds });

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "z-30 flex items-center gap-1 font-display font-black pointer-events-none",
        isSm
          ? "px-1.5 py-0.5 rounded-full border-[1.5px] border-candy-ink text-[10px]"
          : "px-2 py-0.5 rounded-full border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] text-xs",
        isPositive
          ? "bg-candy-mint text-candy-ink animate-bounce"
          : "bg-candy-red text-white animate-shake",
        className,
      )}
    >
      <span className="sr-only">{announcement}</span>
      <CardGlyph
        variant={isPositive ? "timeBonus" : "freeze"}
        size={isSm ? 12 : 14}
      />
      <span aria-hidden="true">
        {isPositive ? `+${deltaSeconds}s` : `${deltaSeconds}s`}
      </span>
    </div>
  );
};

export const Timer: React.FC<TimerProps> = ({
  duration,
  timeLeft,
  size = 200,
  height = 24,
  showText = true,
  timeDelta = null,
  className = "",
}) => {
  const t = useTranslations("Timer");

  // Safe percentage bounded [0, 100]
  const percentage =
    duration > 0 ? Math.max(0, Math.min(100, (timeLeft / duration) * 100)) : 0;

  // Determine state thresholds
  const isWarning = timeLeft <= duration * 0.5 && timeLeft > 5; // <50% duration, above danger
  const isDanger = timeLeft <= 5; // <5 seconds remaining

  const isCircular = Math.abs(size - height) < 10;

  let strokeColorClass = "text-candy-mint";
  let progressBgClass = "bg-candy-mint";

  if (isDanger) {
    strokeColorClass = "text-candy-red";
    progressBgClass = "bg-candy-red";
  } else if (isWarning) {
    strokeColorClass = "text-candy-yellow";
    progressBgClass = "bg-candy-yellow";
  }

  if (isCircular) {
    // Render an extremely premium circular 3D dial!
    return (
      <div
        className={cn(
          "relative flex items-center justify-center select-none font-sans",
          isDanger && "animate-jelly-wobble",
          className,
        )}
        style={{ width: size, height: height }}
        aria-label={`Time remaining: ${Math.ceil(timeLeft)} seconds`}
        role="timer"
      >
        {/* Outer 3D circular background with solid outline and offset shadow */}
        <div className="absolute inset-0 rounded-full border-[3px] border-candy-ink bg-white shadow-[3px_3px_0_0_#2B2D42]"></div>

        {/* Circular path representation using SVG */}
        <svg
          className="absolute w-[80%] h-[80%] -rotate-90"
          viewBox="0 0 36 36"
        >
          <path
            className="text-candy-cloud"
            strokeWidth="4"
            stroke="currentColor"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <path
            className={cn("transition-all duration-100", strokeColorClass)}
            strokeDasharray={`${percentage}, 100`}
            strokeWidth="4"
            strokeLinecap="round"
            stroke="currentColor"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
        </svg>

        {/* Floating text display */}
        {showText && (
          <div className="absolute flex flex-col items-center justify-center z-10 leading-none">
            <span
              className={cn(
                "font-display font-black text-xl leading-none",
                isDanger ? "text-candy-red animate-pulse" : "text-candy-ink",
              )}
            >
              {Math.ceil(timeLeft)}
            </span>
            <span className="text-[7px] uppercase font-display font-black text-candy-ink/50 mt-0.5">
              {t("seconds")}
            </span>
          </div>
        )}

        {/* Floating Time Delta Animation Badge */}
        {timeDelta && (
          <TimeDeltaBadge
            key={timeDelta.key}
            deltaSeconds={timeDelta.deltaSeconds}
            size="md"
            className="absolute -top-3 -right-3"
          />
        )}
      </div>
    );
  }

  // Pill progress bar layout fallback
  return (
    <div
      className={cn(
        "relative flex items-center justify-center select-none font-mono overflow-hidden rounded-full border-[3px] border-candy-ink bg-candy-cloud shadow-[3px_3px_0_0_#2B2D42]",
        isDanger && "animate-pulse",
        className,
      )}
      style={{ width: size, height: height }}
      aria-label={`Time remaining: ${Math.ceil(timeLeft)} seconds`}
      role="timer"
    >
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 rounded-full transition-all duration-100",
          progressBgClass,
        )}
        style={{
          width: `${percentage}%`,
        }}
      ></div>

      {showText && (
        <span className="absolute font-display font-black text-xs text-candy-ink z-10">
          {Math.ceil(timeLeft)} {t("seconds")}
        </span>
      )}

      {/* Floating Time Delta Animation Badge */}
      {timeDelta && (
        <TimeDeltaBadge
          key={timeDelta.key}
          deltaSeconds={timeDelta.deltaSeconds}
          size="sm"
          className="absolute right-2"
        />
      )}
    </div>
  );
};

Timer.displayName = "Timer";
