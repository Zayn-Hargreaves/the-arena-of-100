"use client";

import type { FC } from "react";
import { useTranslations } from "next-intl";
import { Gamepad } from "lucide-react";
import { RoomStatus } from "@arena/shared";
import { cn } from "@/lib/utils";

interface LobbyStartControlsProps {
  isHost: boolean;
  isPrivateRoom: boolean;
  canHostStart: boolean;
  roomStatus: RoomStatus;
  countdownRemainingSeconds: number;
  onStart: () => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-ink focus-visible:ring-offset-2";

export const LobbyStartControls: FC<LobbyStartControlsProps> = ({
  isHost,
  isPrivateRoom,
  canHostStart,
  roomStatus,
  countdownRemainingSeconds,
  onStart,
}) => {
  const t = useTranslations("lobby.startControls");

  if (!isHost || !isPrivateRoom) {
    return null;
  }

  const labelKey =
    roomStatus === RoomStatus.COUNTDOWN
      ? "countdown"
      : roomStatus === RoomStatus.STARTING
        ? "starting"
        : roomStatus === RoomStatus.IN_GAME
          ? "inGame"
          : "waiting";

  const label =
    labelKey === "countdown"
      ? t(labelKey, { seconds: countdownRemainingSeconds })
      : t(labelKey);

  return (
    <button
      type="button"
      onClick={onStart}
      disabled={!canHostStart}
      aria-busy={roomStatus !== RoomStatus.WAITING}
      className={cn(
        "w-full h-14 bg-candy-mint text-candy-ink border-[3.5px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[2px_2px_0_0_#2B2D42] font-display font-black text-sm tracking-widest uppercase flex items-center justify-center cursor-pointer transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed",
        FOCUS_RING,
      )}
    >
      <Gamepad className="w-5 h-5 mr-2 animate-bounce stroke-[2.5]" />
      {label}
    </button>
  );
};
