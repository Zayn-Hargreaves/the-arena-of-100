"use client";

import React, { use } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { useRouter } from "@/i18n/routing";
import { useSocketStore } from "@/stores/socket-store";
import { useMatchResults } from "@/hooks/use-match-results";
import { ResultContent } from "@/components/game/result-content";
import { ResultLoadStateView } from "@/components/game/result-load-state";

interface ResultPageProps {
  params: Promise<{ matchId: string }>;
}

export default function ResultPage({ params }: Readonly<ResultPageProps>) {
  const { matchId } = use(params);
  const router = useRouter();
  const userId = useSocketStore((s) => s.userId);
  const { loadState, winner, yourPerformance, opponents, retry } =
    useMatchResults(matchId, userId);

  if (loadState !== "ready") {
    return (
      <ResultLoadStateView
        state={loadState}
        onHome={() => router.replace("/")}
        onRetry={retry}
      />
    );
  }

  return (
    <AppShellLayout>
      <ResultContent
        matchId={matchId}
        winner={winner}
        performance={yourPerformance}
        opponents={opponents}
        onRematch={() => router.push("/room/create")}
        onHome={() => router.push("/")}
      />
    </AppShellLayout>
  );
}
