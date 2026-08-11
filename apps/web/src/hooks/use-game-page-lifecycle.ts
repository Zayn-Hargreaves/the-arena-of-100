import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import type { Match } from "@/stores/socket-store.types";

interface UseGamePageLifecycleOptions {
  matchId: string;
  matchStatus: Match["status"] | undefined;
  roomTerminated: boolean;
  roomTerminationMessage: string | null;
  requestSnapshot: (matchId: string, lastSeenSeqNo: number) => void;
  clearTimers: () => void;
}

export function useGamePageLifecycle({
  matchId,
  matchStatus,
  roomTerminated,
  roomTerminationMessage,
  requestSnapshot,
  clearTimers,
}: UseGamePageLifecycleOptions) {
  const router = useRouter();
  const { toast } = useToast();
  const tTermination = useTranslations("Game.termination");
  const snapshotHydratedRef = useRef(false);
  const terminationNotifiedRef = useRef(false);

  useEffect(() => {
    if (snapshotHydratedRef.current || !matchId) return;
    snapshotHydratedRef.current = true;
    requestSnapshot(matchId, useSocketStore.getState().lastSeenSeqNo);
  }, [matchId, requestSnapshot]);

  useEffect(() => {
    if (!roomTerminated || terminationNotifiedRef.current) return;
    terminationNotifiedRef.current = true;
    clearTimers();
    toast({
      title: tTermination("toastTitle"),
      description: roomTerminationMessage ?? tTermination("toastDefault"),
      variant: "error",
    });
    const redirectTimer = window.setTimeout(() => router.push("/"), 1500);
    return () => {
      window.clearTimeout(redirectTimer);
      useSocketStore.setState({
        roomTerminated: false,
        roomTerminationMessage: null,
      });
    };
  }, [
    roomTerminated,
    roomTerminationMessage,
    router,
    toast,
    tTermination,
    clearTimers,
  ]);

  useEffect(() => {
    if (matchStatus !== "FINISHED") return;
    const redirectTimer = setTimeout(
      () => router.push(`/result/${matchId}`),
      3000,
    );
    return () => clearTimeout(redirectTimer);
  }, [matchStatus, matchId, router]);
}
