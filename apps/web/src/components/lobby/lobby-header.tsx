"use client";

import { useEffect, useState, type FC } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, LogOut, Radio } from "lucide-react";
import { RoomStatus } from "@arena/shared";

interface LobbyHeaderProps {
  roomStatus: RoomStatus;
  onLeave: (signal: AbortSignal) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-ink focus-visible:ring-offset-2";

const HEADING_KEYS: Record<RoomStatus, string> = {
  [RoomStatus.WAITING]: "heading.waiting",
  [RoomStatus.COUNTDOWN]: "heading.countdown",
  [RoomStatus.STARTING]: "heading.starting",
  [RoomStatus.IN_GAME]: "heading.in_game",
  [RoomStatus.FINISHED]: "heading.waiting",
};

const SUB_LABEL_KEYS: Record<RoomStatus, string> = {
  [RoomStatus.WAITING]: "sublabel.waiting",
  [RoomStatus.COUNTDOWN]: "sublabel.countdown",
  [RoomStatus.STARTING]: "sublabel.starting",
  [RoomStatus.IN_GAME]: "sublabel.in_game",
  [RoomStatus.FINISHED]: "sublabel.waiting",
};

export const LobbyHeader: FC<LobbyHeaderProps> = ({
  roomStatus,
  onLeave,
  onError,
}) => {
  const t = useTranslations("lobby");
  const [isLeaving, setIsLeaving] = useState(false);

  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    return () => {
      controller.abort();
    };
  }, [controller]);

  const lobbyHeading = t(HEADING_KEYS[roomStatus] ?? "heading.waiting");
  const lobbySubLabel = t(SUB_LABEL_KEYS[roomStatus] ?? "sublabel.waiting");

  const handleBack = async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    try {
      await onLeave(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        onError?.(error);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLeaving(false);
      }
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b-[3px] border-candy-ink/10">
      {/* Title and Back button */}
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={handleBack}
          disabled={isLeaving}
          aria-label={t("actions.back")}
          aria-busy={isLeaving}
          className={`flex items-center gap-1.5 px-3.5 py-2 border-[3px] border-candy-ink bg-white text-candy-ink font-display font-black text-xs uppercase rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none disabled:opacity-60 disabled:cursor-not-allowed ${FOCUS_RING}`}
        >
          {isLeaving ? (
            <Loader2 className="w-4 h-4 stroke-[2.5] animate-spin" />
          ) : (
            <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
          )}
          <span className="hidden xs:inline">{t("actions.back")}</span>
        </button>

        <div>
          <div className="flex items-center gap-2">
            <span className="font-display font-black text-[11px] text-candy-pink uppercase tracking-wider flex items-center gap-1">
              <Radio className="w-3 h-3 text-candy-pink animate-pulse" />
              {lobbySubLabel}
            </span>
          </div>
          <h1 className="font-display font-black text-2xl md:text-3xl tracking-wide uppercase text-candy-ink drop-shadow-[0_1px_0_rgba(0,0,0,0.05)]">
            {lobbyHeading}
          </h1>
        </div>
      </div>

      {/* Leave Room Action */}
      <button
        type="button"
        onClick={handleBack}
        disabled={isLeaving}
        aria-label={t("actions.leave")}
        aria-busy={isLeaving}
        className={`flex items-center gap-2 px-4 py-2 border-[3px] border-candy-ink bg-candy-red/90 hover:bg-candy-red text-white font-display font-black text-xs uppercase rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none disabled:opacity-60 disabled:cursor-not-allowed shrink-0 ${FOCUS_RING}`}
      >
        <LogOut className="w-3.5 h-3.5 stroke-[2.5]" />
        {t("actions.leave")}
      </button>
    </div>
  );
};
