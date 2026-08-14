"use client";

import React, { useEffect, useState } from "react";
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
    labelVi: string;
    labelEn: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  GENERAL: {
    labelVi: "Kiến Thức Chung",
    labelEn: "General Knowledge",
    icon: Globe,
    color: "from-blue-500/20 to-cyan-500/20 border-cyan-500/30",
  },
  SCIENCE: {
    labelVi: "Khoa Học & Tự Nhiên",
    labelEn: "Science & Nature",
    icon: Flame,
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-500/30",
  },
  HISTORY: {
    labelVi: "Lịch Sử & Thế Giới",
    labelEn: "History & World",
    icon: Landmark,
    color: "from-amber-500/20 to-yellow-500/20 border-amber-500/30",
  },
  GEOGRAPHY: {
    labelVi: "Địa Lý & Du Lịch",
    labelEn: "Geography",
    icon: Compass,
    color: "from-sky-500/20 to-blue-500/20 border-sky-500/30",
  },
  ENTERTAINMENT: {
    labelVi: "Giải Trí & Âm Nhạc",
    labelEn: "Entertainment",
    icon: Film,
    color: "from-purple-500/20 to-pink-500/20 border-purple-500/30",
  },
  SPORTS: {
    labelVi: "Thể Thao",
    labelEn: "Sports",
    icon: Trophy,
    color: "from-orange-500/20 to-red-500/20 border-orange-500/30",
  },
  TECH: {
    labelVi: "Công Nghệ & IT",
    labelEn: "Technology & IT",
    icon: Code,
    color: "from-indigo-500/20 to-violet-500/20 border-indigo-500/30",
  },
  LITERATURE: {
    labelVi: "Văn Học & Nghệ Thuật",
    labelEn: "Literature & Art",
    icon: BookOpen,
    color: "from-rose-500/20 to-pink-500/20 border-rose-500/30",
  },
};

export function TopicVotingOverlay() {
  const t = useTranslations("Game.topicVoting");
  const { topicVoting, voteBanTopic } = useSocketStore();

  const [timeLeft, setTimeLeft] = useState<number>(10);

  useEffect(() => {
    if (!topicVoting) return;

    const calculateRemaining = () => {
      const remaining = Math.max(
        0,
        Math.ceil((topicVoting.endsAt - Date.now()) / 1000),
      );
      setTimeLeft(remaining);
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 200);
    return () => clearInterval(interval);
  }, [topicVoting?.endsAt]);

  if (!topicVoting) return null;

  const {
    candidateTopics,
    voteCounts,
    myVotedTopic,
    bannedTopics,
    activeTopics,
    isFinished,
    totalVotes,
    matchId,
  } = topicVoting;

  const handleVote = (topic: string) => {
    if (isFinished || timeLeft <= 0) return;
    voteBanTopic(matchId, topic);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl p-6 md:p-8 bg-slate-900/90 border border-slate-700/60 rounded-2xl shadow-2xl shadow-rose-950/20 overflow-hidden text-slate-100 flex flex-col items-center animate-scale-in">
        {/* Header Glow */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-32 bg-rose-500/20 blur-3xl pointer-events-none" />

        {/* Title & Countdown */}
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/30 rounded-full text-rose-400 font-mono text-xs tracking-wider uppercase">
            <Ban className="w-3.5 h-3.5" />
            <span>{t("title")}</span>
          </div>

          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-rose-100 to-rose-400">
            {isFinished ? t("bannedTopicsHeader") : t("subtitle")}
          </h2>

          {!isFinished && (
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
          {candidateTopics.map((topic) => {
            const meta = TOPIC_METADATA[topic] || {
              labelVi: topic,
              labelEn: topic,
              icon: BookOpen,
              color: "from-slate-800 to-slate-900 border-slate-700",
            };
            const Icon = meta.icon;
            const votes = voteCounts[topic] || 0;
            const isSelected = myVotedTopic === topic;
            const isBanned = bannedTopics.includes(topic);
            const isActive = activeTopics.includes(topic);

            return (
              <button
                type="button"
                key={topic}
                onClick={() => handleVote(topic)}
                disabled={isFinished || timeLeft <= 0}
                aria-pressed={isSelected}
                className={`relative text-left w-full p-5 rounded-xl border transition-all duration-200 select-none overflow-hidden flex flex-col justify-between min-h-[140px] bg-gradient-to-br ${
                  meta.color
                } ${
                  isFinished || timeLeft <= 0
                    ? "cursor-default"
                    : "cursor-pointer"
                } ${
                  isSelected
                    ? "ring-2 ring-rose-500 border-rose-500 shadow-lg shadow-rose-950/40 transform scale-[1.02]"
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
                        {meta.labelVi}
                      </h3>
                      <p className="text-xs text-slate-400">{meta.labelEn}</p>
                    </div>
                  </div>

                  {isSelected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-[10px] font-bold text-rose-300">
                      <CheckCircle2 className="w-3 h-3" />
                      {t("voted")}
                    </span>
                  )}
                </div>

                {/* Vote Count / Status Bar */}
                <div className="mt-4 pt-3 border-t border-slate-700/40 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-300">
                    {votes} {t("votesCount", { count: votes })}
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
