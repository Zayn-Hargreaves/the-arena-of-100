"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { ZapSvg, CloseSvg } from "@/components/home/home-icons";
import { ProfessorAvatar } from "@/components/character/professor-avatar";
import { ProfessorDialogueBox } from "@/components/character/professor-dialogue-box";
import { getRandomProfessorDialogue } from "@/components/character/professor-roast-engine";

interface FocusableElement {
  focus: (options?: FocusOptions) => void;
}

function isFocusableElement(element: unknown): element is FocusableElement {
  return (
    element !== null &&
    typeof element === "object" &&
    "focus" in element &&
    typeof (element as { focus: unknown }).focus === "function"
  );
}

export function MatchmakingModal() {
  const t = useTranslations("MatchmakingModal");
  const tErrors = useTranslations("Errors");
  const tProf = useTranslations("Professor");
  const router = useRouter();
  const {
    matchmaking,
    leaveMatchmaking,
    clearMatchmakingMatched,
    joinRoom,
    leaveRoom,
  } = useSocketStore();

  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [professorLine, setProfessorLine] = useState(() =>
    tProf("dialogues.matchmaking_waiting.0"),
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<FocusableElement | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;
  const joinRoomRef = useRef(joinRoom);
  joinRoomRef.current = joinRoom;
  const leaveRoomRef = useRef(leaveRoom);
  leaveRoomRef.current = leaveRoom;
  const clearMatchedRef = useRef(clearMatchmakingMatched);
  clearMatchedRef.current = clearMatchmakingMatched;
  const attemptedRoomCodeRef = useRef<string | null>(null);
  const joinInFlightRef = useRef(false);
  const joinAttemptIdRef = useRef(0);

  const handleLeaveMatchmaking = useCallback(() => {
    joinAttemptIdRef.current++;
    joinInFlightRef.current = false;
    attemptedRoomCodeRef.current = null;
    setJoinError(null);
    leaveMatchmaking();
  }, [leaveMatchmaking]);

  // Invalidate any in-flight join attempts on unmount
  useEffect(() => {
    return () => {
      joinAttemptIdRef.current++;
      joinInFlightRef.current = false;
      attemptedRoomCodeRef.current = null;
    };
  }, []);

  const isVisible = Boolean(
    matchmaking.isQueued || matchmaking.matchedRoomCode,
  );
  const isMatched = Boolean(matchmaking.matchedRoomCode);

  // Save previously focused element on open and restore on close
  useEffect(() => {
    if (isVisible) {
      const active =
        typeof document !== "undefined" ? document.activeElement : null;
      previouslyFocusedElementRef.current = isFocusableElement(active)
        ? active
        : null;

      return () => {
        previouslyFocusedElementRef.current?.focus();
      };
    }
    return undefined;
  }, [isVisible]);

  // Focus management on open and when isMatched changes
  useEffect(() => {
    if (!isVisible) return undefined;

    const timer = setTimeout(() => {
      if (dialogRef.current) {
        if (isMatched) {
          dialogRef.current.focus();
        } else {
          const focusable = dialogRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (focusable) {
            focusable.focus();
          } else {
            dialogRef.current.focus();
          }
        }
      }
    }, 50);

    return () => {
      clearTimeout(timer);
    };
  }, [isVisible, isMatched]);

  // Keydown handler for Escape and Focus Trap
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isMatched) {
        e.preventDefault();
        handleLeaveMatchmaking();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusableElements =
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
        if (focusableElements.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, isMatched, handleLeaveMatchmaking]);

  // Local ticker for smooth second counting starting from matchmaking.elapsedSeconds
  useEffect(() => {
    if (!matchmaking.isQueued || !matchmaking.queuedAt) {
      setDisplaySeconds(0);
      return;
    }

    const startClientTime = Date.now();
    const baseElapsed = matchmaking.elapsedSeconds ?? 0;
    setDisplaySeconds(baseElapsed);

    const interval = setInterval(() => {
      const delta = Math.floor((Date.now() - startClientTime) / 1000);
      setDisplaySeconds(baseElapsed + delta);
    }, 1000);

    return () => clearInterval(interval);
  }, [matchmaking.isQueued, matchmaking.queuedAt, matchmaking.elapsedSeconds]);

  // Dialogue ticker for Professor during matchmaking
  useEffect(() => {
    if (isMatched) {
      setProfessorLine(tProf("dialogues.matchmaking_matched.0"));
      return undefined;
    }
    if (isVisible) {
      const interval = setInterval(() => {
        const d = getRandomProfessorDialogue("matchmaking_waiting");
        setProfessorLine(tProf(d.key));
      }, 4000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isVisible, isMatched, tProf]);

  const getErrorMessage = (errorKey: string | null) => {
    if (!errorKey) return "";
    try {
      return tErrors(errorKey as Parameters<typeof tErrors>[0]);
    } catch {
      return tErrors("UNKNOWN_ERROR");
    }
  };

  const handleJoinMatchedRoom = useCallback(
    (targetCode: string, targetMatchId?: string | null) => {
      if (joinInFlightRef.current) return;
      joinInFlightRef.current = true;
      const attemptId = ++joinAttemptIdRef.current;
      setJoinError(null);
      attemptedRoomCodeRef.current = targetCode;
      const delayPromise = new Promise((resolve) => setTimeout(resolve, 500));
      const joinPromise = joinRoomRef.current(targetCode);

      return Promise.all([joinPromise, delayPromise])
        .then(() => {
          if (attemptId !== joinAttemptIdRef.current) {
            const socketState = useSocketStore.getState();
            const joinedRoomId =
              socketState.room?.id ?? socketState.matchmaking.matchedRoomId;
            if (joinedRoomId) {
              leaveRoomRef.current?.(joinedRoomId);
            }
            return;
          }
          const socketState = useSocketStore.getState();
          const resolvedMatchId =
            targetMatchId ??
            socketState.match?.id ??
            socketState.room?.currentMatchId;

          clearMatchedRef.current();
          if (resolvedMatchId) {
            routerRef.current.push(`/game/${resolvedMatchId}`);
          } else {
            routerRef.current.push(`/lobby/${targetCode}`);
          }
        })
        .catch((err) => {
          if (attemptId !== joinAttemptIdRef.current) {
            return;
          }
          console.warn("Auto-joining matched room error:", err);
          attemptedRoomCodeRef.current = null;
          const errorCode =
            err instanceof Error && err.message ? err.message : "UNKNOWN_ERROR";
          setJoinError(errorCode);
        })
        .finally(() => {
          if (attemptId === joinAttemptIdRef.current) {
            joinInFlightRef.current = false;
          }
        });
    },
    [],
  );

  // Handle match found auto-redirect
  useEffect(() => {
    const targetCode = matchmaking.matchedRoomCode;
    if (targetCode && attemptedRoomCodeRef.current !== targetCode) {
      void handleJoinMatchedRoom(targetCode);
    }
  }, [matchmaking.matchedRoomCode, handleJoinMatchedRoom]);

  if (!isVisible) {
    return null;
  }

  const minutes = Math.floor(displaySeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (displaySeconds % 60).toString().padStart(2, "0");

  const estSeconds =
    matchmaking.estimatedWaitSeconds && matchmaking.estimatedWaitSeconds > 0
      ? matchmaking.estimatedWaitSeconds
      : 30;
  const estMinutes = Math.floor(estSeconds / 60)
    .toString()
    .padStart(2, "0");
  const estSecs = (estSeconds % 60).toString().padStart(2, "0");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="matchmaking-modal-title"
        tabIndex={-1}
        className="relative w-full max-w-md bg-white border-4 border-candy-ink rounded-3xl p-6 shadow-[8px_8px_0_0_#2B2D42] overflow-hidden outline-none"
      >
        {/* Playful Top Badge */}
        <div className="flex justify-between items-center mb-4">
          <div
            id="matchmaking-modal-title"
            className="inline-flex items-center gap-2 bg-candy-purple text-white font-display text-xs px-3 py-1.5 border-3 border-candy-ink rounded-full shadow-[2px_2px_0_0_#2B2D42]"
          >
            <ZapSvg size={16} />
            <span className="font-black uppercase tracking-wider">
              {isMatched ? t("matchFoundTitle") : t("searchingTitle")}
            </span>
          </div>

          {!isMatched && (
            <button
              onClick={handleLeaveMatchmaking}
              aria-label={t("cancelButton")}
              className="p-1.5 rounded-xl border-2 border-candy-ink bg-candy-cloud hover:bg-candy-red hover:text-white transition-colors cursor-pointer"
              title={t("cancelButton")}
            >
              <CloseSvg size={18} />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex flex-col items-center text-center my-4 gap-3">
          {joinError ? (
            <div className="flex flex-col items-center gap-3">
              <ProfessorAvatar mood="angry_roast" size="lg" />
              <div role="alert" aria-live="assertive">
                <h3 className="font-display font-black text-lg text-candy-red">
                  {getErrorMessage(joinError)}
                </h3>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (matchmaking.matchedRoomCode) {
                      void handleJoinMatchedRoom(matchmaking.matchedRoomCode);
                    }
                  }}
                  className="px-4 py-2 bg-candy-yellow border-2 border-candy-ink rounded-xl font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] cursor-pointer"
                >
                  {t("retry")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setJoinError(null);
                    handleLeaveMatchmaking();
                  }}
                  className="px-4 py-2 bg-white border-2 border-candy-ink rounded-xl font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] cursor-pointer"
                >
                  {t("cancelButton")}
                </button>
              </div>
            </div>
          ) : isMatched ? (
            <div className="flex flex-col items-center gap-3 animate-bounce motion-reduce:animate-none">
              <ProfessorAvatar mood="proud_cheer" size="lg" />
              <h3 className="font-display font-black text-2xl text-candy-ink">
                {t("readyToBattle")}
              </h3>
              <ProfessorDialogueBox
                text={professorLine}
                tailPosition="bottom"
                variant="paper"
                className="w-full text-center"
              />
              <p className="font-display text-xs text-candy-slate font-bold">
                {t("redirecting", {
                  roomCode: matchmaking.matchedRoomCode ?? "",
                })}
              </p>
            </div>
          ) : (
            <>
              {/* Professor Examining with Magnifying Glass */}
              <div className="relative flex items-center justify-center my-1">
                <ProfessorAvatar mood="searching" size="lg" />
              </div>

              {/* Professor Dialogue */}
              <ProfessorDialogueBox
                text={professorLine}
                tailPosition="bottom"
                variant="paper"
                className="w-full text-center text-xs"
              />

              {/* Timer Display */}
              <div>
                <div className="font-display font-black text-3xl tracking-widest text-candy-ink">
                  {minutes}:{seconds}
                </div>
                <div className="font-display text-xs text-candy-slate font-bold mt-0.5">
                  {t("estimatedWait", { time: `${estMinutes}:${estSecs}` })}
                </div>
              </div>

              {/* Players in Queue Indicator */}
              <div className="w-full bg-[#FFF8E7] border-3 border-candy-ink rounded-2xl p-3 shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-between text-xs font-display">
                <span className="text-candy-slate font-bold flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-candy-mint animate-pulse inline-block" />
                  {t("playersInQueue")}
                </span>
                <span className="font-black text-candy-ink bg-white px-2.5 py-0.5 border-2 border-candy-ink rounded-lg">
                  {t("playerCount", {
                    count: Math.max(1, matchmaking.playersInQueue),
                  })}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        {!isMatched && (
          <div className="mt-2">
            <button
              onClick={handleLeaveMatchmaking}
              aria-label={t("cancelButton")}
              className="w-full py-3 bg-white hover:bg-candy-red hover:text-white text-candy-ink border-3 border-candy-ink rounded-2xl font-display font-black text-sm uppercase shadow-[3px_3px_0_0_#2B2D42] hover:translate-y-[-1px] active:translate-y-[1px] transition-all cursor-pointer"
            >
              {t("cancelSearch")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
