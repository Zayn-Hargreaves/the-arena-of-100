"use client";

import React from "react";
import { MatchStatus } from "@arena/shared";
import { ProfessorHudWidget } from "@/components/character/professor-hud-widget";
import { OpponentsSidebar, type OpponentPlayer } from "./opponents-sidebar";
import { AntiHackNote } from "./anti-hack-note";
import { LeaveMatchButton } from "./leave-match-button";

export interface GameSidebarPanelProps {
  timeLeft: number;
  hasAnswered: boolean;
  isCorrect: boolean | null;
  isEliminated: boolean;
  players: OpponentPlayer[];
  userId: string | null;
  roundCompleted: boolean;
  matchStatus?: MatchStatus;
  onLeaveClick: () => void;
}

export function GameSidebarPanel({
  timeLeft,
  hasAnswered,
  isCorrect,
  isEliminated,
  players,
  userId,
  roundCompleted,
  matchStatus,
  onLeaveClick,
}: Readonly<GameSidebarPanelProps>) {
  return (
    <div className="lg:col-span-1 space-y-6">
      {/* Professor Exam Supervisor Widget */}
      <ProfessorHudWidget
        timeLeft={timeLeft}
        hasAnswered={hasAnswered}
        isCorrect={isCorrect}
        isEliminated={isEliminated}
      />

      <OpponentsSidebar players={players} userId={userId} />

      <AntiHackNote />

      <LeaveMatchButton
        onClick={onLeaveClick}
        disabled={roundCompleted || matchStatus === MatchStatus.FINISHED}
      />
    </div>
  );
}
