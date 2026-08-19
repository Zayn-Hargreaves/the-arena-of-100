"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Ban,
  Clock,
  Flame,
  CheckCircle2,
  Sparkles,
  BookOpen,
  Code,
  Globe,
  Film,
  Trophy,
  Landmark,
  Compass,
} from "lucide-react";
import { useSocketStore } from "@/stores/socket-store";

const TOPIC_METADATA: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  GENERAL: {
    icon: Globe,
    color: "from-sky-500/20 to-blue-500/20 border-sky-500/30",
  },
  SCIENCE: {
    icon: Flame,
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-500/30",
  },
  HISTORY: {
    icon: Landmark,
    color: "from-amber-500/20 to-orange-500/20 border-amber-500/30",
  },
  TECH: {
    icon: Code,
    color: "from-indigo-500/20 to-violet-500/20 border-indigo-500/30",
  },
  TECHNOLOGY: {
    icon: Code,
    color: "from-indigo-500/20 to-violet-500/20 border-indigo-500/30",
  },
  ENTERTAINMENT: {
    icon: Film,
    color: "from-purple-500/20 to-fuchsia-500/20 border-purple-500/30",
  },
  SPORTS: {
    icon: Trophy,
    color: "from-yellow-500/20 to-amber-500/20 border-yellow-500/30",
  },
  GEOGRAPHY: {
    icon: Compass,
    color: "from-teal-500/20 to-cyan-500/20 border-teal-500/30",
  },
  LOGIC: {
    icon: BookOpen,
    color: "from-rose-500/20 to-pink-500/20 border-rose-500/30",
  },
  CULTURE: {
    icon: BookOpen,
    color: "from-purple-500/20 to-pink-500/20 border-purple-500/30",
  },
};

export function TopicVotingOverlay() {
  const t = useTranslations("Game.topicVoting");
  const { topicVoting, voteBanTopic, match } = useSocketStore();

  const [timeLeft, setTimeLeft] = useState<number>(10);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const isPhaseValid =
    !match || match.status === "TOPIC_VOTING" || match.status === "COUNTDOWN";
  const isOpen = Boolean(topicVoting && isPhaseValid);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current =
      document.activeElement as HTMLElement | null;

    if (dialogRef.current) {
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length > 0) {
        focusable[0]?.focus();
      } else {
        dialogRef.current.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (
          document.activeElement === lastElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (
        previousActiveElement.current &&
        typeof previousActiveElement.current.focus === "function"
      ) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  const endsAt = topicVoting?.endsAt;
  useEffect(() => {
    if (!endsAt) {
      setTimeLeft(0);
      return;
    }

    const calculateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 200);
    return () => clearInterval(interval);
  }, [endsAt]);

  const bannedTopics = topicVoting?.bannedTopics;
  const activeTopics = topicVoting?.activeTopics;
  const candidateTopics = topicVoting?.candidateTopics;
  const voteCounts = topicVoting?.voteCounts;
  const totalVotes = topicVoting?.totalVotes ?? 0;

  const bannedSet = useMemo(() => new Set(bannedTopics ?? []), [bannedTopics]);
  const activeSet = useMemo(() => new Set(activeTopics ?? []), [activeTopics]);

  // Determine top 2 most voted topics when voting is ongoing
  const topBannedCandidates = useMemo(() => {
    if (
      !candidateTopics ||
      candidateTopics.length === 0 ||
      totalVotes === 0 ||
      !voteCounts
    ) {
      return new Set<string>();
    }
    const counts = voteCounts;
    const sorted = [...candidateTopics]
      .filter((t) => (counts[t] ?? 0) > 0)
      .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
    return new Set(sorted.slice(0, 2));
  }, [candidateTopics, voteCounts, totalVotes]);

  if (!isOpen || !topicVoting) return null;

  const {
    candidateTopics: renderCandidateTopics,
    voteCounts: renderVoteCounts,
    myVotedTopic,
    isFinished,
    matchId,
  } = topicVoting;

  const handleVote = (topic: string) => {
    if (isFinished) return;
    voteBanTopic(matchId, topic);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="topic-voting-title"
        className="relative w-full max-w-4xl max-h-[90dvh] overflow-y-auto p-6 md:p-8 bg-slate-900/95 border border-slate-700/60 rounded-2xl shadow-2xl shadow-rose-950/20 text-slate-100 flex flex-col items-center animate-scale-in scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
      >
        {/* Header Glow */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-32 bg-rose-500/20 blur-3xl pointer-events-none" />

        {/* Title & Countdown */}
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/30 rounded-full text-rose-400 font-mono text-xs tracking-wider uppercase">
            <Ban className="w-3.5 h-3.5" />
            <span>{t("title")}</span>
          </div>

          <h2
            id="topic-voting-title"
            className="text-2xl md:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-rose-100 to-rose-400"
          >
            {isFinished ? t("bannedTopicsHeader") : t("subtitle")}
          </h2>

          {!isFinished && endsAt && (
            <div className="flex items-center justify-center gap-2 text-slate-400 text-sm font-medium">
              <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
              <span>{t("votingEndsIn")}</span>
              <span className="font-mono text-lg font-bold text-amber-300">
                {timeLeft}s
              </span>
              <span className="text-xs text-slate-500 ml-2">
                ({totalVotes} {t("votesCount", { count: totalVotes })})
              </span>
            </div>
          )}
        </div>

        {/* Candidates Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 w-full mb-6">
          {renderCandidateTopics.map((topic) => {
            const meta = TOPIC_METADATA[topic] || {
              icon: BookOpen,
              color: "from-slate-800 to-slate-900 border-slate-700",
            };
            const Icon = meta.icon;
            const votes = renderVoteCounts[topic] || 0;
            const isSelected = myVotedTopic === topic;
            const isBanned = bannedSet.has(topic);
            const isActive = activeSet.has(topic);
            const isTopDanger = !isFinished && topBannedCandidates.has(topic);
            const votePercent =
              totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
            const topicLabel = t.has(topic) ? t(topic) : topic;

            return (
              <button
                type="button"
                key={topic}
                onClick={() => handleVote(topic)}
                disabled={isFinished}
                aria-pressed={isSelected}
                className={`relative text-left w-full p-5 rounded-xl border transition-all duration-200 select-none overflow-hidden flex flex-col justify-between min-h-[150px] bg-gradient-to-br ${
                  meta.color
                } ${isFinished ? "cursor-default" : "cursor-pointer"} ${
                  isSelected
                    ? "ring-2 ring-rose-500 border-rose-500 shadow-lg shadow-rose-950/40 transform scale-[1.02]"
                    : isTopDanger
                      ? "border-amber-500/50 hover:border-amber-400/80 hover:scale-[1.01]"
                      : "hover:border-slate-500/50 hover:scale-[1.01]"
                } ${isBanned ? "opacity-60 grayscale" : ""}`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-rose-400">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-slate-100 leading-tight">
                        {topicLabel}
                      </h3>
                    </div>
                  </div>

                  {isSelected ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-[10px] font-bold text-rose-300">
                      <CheckCircle2 className="w-3 h-3" />
                      {t("voted")}
                    </span>
                  ) : isTopDanger ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] font-bold text-amber-300">
                      <Flame className="w-3 h-3 text-amber-400" />
                      {t("topDanger")}
                    </span>
                  ) : null}
                </div>

                {/* Progress Bar (Visible during voting when votes exist) */}
                {!isFinished && totalVotes > 0 && (
                  <div className="w-full bg-slate-950/60 rounded-full h-1.5 overflow-hidden my-3 border border-slate-800/80">
                    <div
                      className={`h-full transition-all duration-300 ease-out rounded-full ${
                        isTopDanger
                          ? "bg-gradient-to-r from-rose-500 to-amber-400"
                          : "bg-rose-500/70"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(votePercent, votes > 0 ? 5 : 0))}%`,
                      }}
                    />
                  </div>
                )}

                {/* Vote Count / Status Bar */}
                <div className="mt-2 pt-2 border-t border-slate-700/40 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-300">
                    {votes} {t("votesCount", { count: votes })}
                    {totalVotes > 0 && !isFinished && (
                      <span className="text-slate-400 font-sans ml-1 text-[11px]">
                        ({votePercent}%)
                      </span>
                    )}
                  </span>

                  {!isFinished && (
                    <span
                      className={`text-xs px-3 py-1 rounded-md font-bold transition-colors ${
                        isSelected
                          ? "bg-rose-500 text-white shadow-sm"
                          : "bg-slate-800/80 group-hover:bg-rose-600 group-hover:text-white text-slate-300 border border-slate-700/60"
                      }`}
                    >
                      {isSelected ? t("voted") : t("banButton")}
                    </span>
                  )}

                  {isFinished && isBanned && (
                    <span className="text-xs font-extrabold text-rose-400 flex items-center gap-1">
                      <Ban className="w-3.5 h-3.5" />
                      {t("banned")}
                    </span>
                  )}

                  {isFinished && isActive && (
                    <span className="text-xs font-extrabold text-emerald-400 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      {t("active")}
                    </span>
                  )}
                </div>

                {/* Banned Stamped Overlay */}
                {isFinished && isBanned && (
                  <div className="absolute inset-0 bg-rose-950/40 flex items-center justify-center pointer-events-none">
                    <div className="border-4 border-rose-500/80 rounded-lg px-4 py-1 rotate-[-12deg] text-rose-400 font-black text-xl tracking-widest uppercase shadow-xl bg-slate-950/80">
                      {t("banned")}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer note */}
        {isFinished && (
          <div className="text-center text-sm font-medium text-amber-400 flex items-center gap-2 animate-pulse">
            <Sparkles className="w-4 h-4 animate-spin" />
            <span>{t("startingMatch")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
