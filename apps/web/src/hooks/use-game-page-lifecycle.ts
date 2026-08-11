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
  const snapshotMatchIdRef = useRef<string | null>(null);
  const terminationNotifiedRef = useRef(false);
  const terminationRedirectRef = useRef<number | null>(null);
  const resultRedirectRef = useRef<number | null>(null);

  useEffect(() => {
    if (snapshotMatchIdRef.current !== matchId) {
      snapshotMatchIdRef.current = matchId;
      snapshotHydratedRef.current = false;
    }
    if (snapshotHydratedRef.current || !matchId) return;
    snapshotHydratedRef.current = true;
    requestSnapshot(matchId, useSocketStore.getState().lastSeenSeqNo);
  }, [matchId, requestSnapshot]);

  useEffect(() => {
    if (!roomTerminated || terminationNotifiedRef.current) return;
    terminationNotifiedRef.current = true;
    clearTimers();
    if (resultRedirectRef.current !== null) {
      window.clearTimeout(resultRedirectRef.current);
      resultRedirectRef.current = null;
    }
    toast({
      title: tTermination("toastTitle"),
      description: roomTerminationMessage ?? tTermination("toastDefault"),
      variant: "error",
    });
    terminationRedirectRef.current = window.setTimeout(
      () => router.push("/"),
      1500,
    );
  }, [
    roomTerminated,
    roomTerminationMessage,
    router,
    toast,
    tTermination,
    clearTimers,
  ]);

  useEffect(
    () => () => {
      if (terminationRedirectRef.current !== null) {
        window.clearTimeout(terminationRedirectRef.current);
      }
      useSocketStore.setState({
        roomTerminated: false,
        roomTerminationMessage: null,
      });
    },
    [],
  );

  useEffect(() => {
    if (matchStatus !== "FINISHED" || roomTerminated) return;
    resultRedirectRef.current = window.setTimeout(
      () => router.push(`/result/${matchId}`),
      3000,
    );
    return () => {
      if (resultRedirectRef.current !== null) {
        window.clearTimeout(resultRedirectRef.current);
        resultRedirectRef.current = null;
      }
    };
  }, [matchStatus, matchId, roomTerminated, router]);
}
