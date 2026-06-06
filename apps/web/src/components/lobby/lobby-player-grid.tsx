"use client";

import React from "react";
import { Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/ui/avatar-frame";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { cn } from "@/lib/utils";
import { avatars } from "@/lib/avatars";

export interface LobbyPlayer {
  id: string;
  name: string;
  status: string;
  score: number;
  isOnline?: boolean;
}

interface LobbyPlayerGridProps {
  players: LobbyPlayer[];
  currentUserId: string | null;
  hostId: string | null;
  emptyStateMessage?: string;
}

export const LobbyPlayerGrid: React.FC<LobbyPlayerGridProps> = ({
  players,
  currentUserId,
  hostId,
  emptyStateMessage = "Đang chờ người chơi tham gia...",
}) => {
  const getPlayerAvatar = (player: LobbyPlayer) => {
    if (player.id === currentUserId && typeof window !== "undefined") {
      const seed = localStorage.getItem("avatarSeed") || "jellyfrog";
      const name = localStorage.getItem("avatarName") || "Ếch Thạch (Jelly)";
      const isAnimated = localStorage.getItem("avatarIsAnimated") === "true";
      const spritesheet = localStorage.getItem("avatarSpritesheet") || "";
      return { seed, name, isAnimated, spritesheet };
    }

    const hash = player.name
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = hash % avatars.length;
    const avatar = avatars[index];
    return {
      seed: avatar.seed,
      name: avatar.name,
      isAnimated: Boolean(avatar.isAnimated),
      spritesheet: avatar.spritesheet || "",
    };
  };

  if (players.length === 0) {
    return (
      <div className="col-span-full flex flex-col items-center justify-center py-16 px-4 rounded-2xl border-[3px] border-dashed border-candy-ink/20 bg-white/50">
        <Users className="w-10 h-10 text-candy-ink/20 stroke-[1.5] mb-3" />
        <p className="font-display font-black text-base text-candy-ink/30 uppercase tracking-wider text-center">
          {emptyStateMessage}
        </p>
        <p className="font-sans text-xs text-candy-ink/20 mt-1">
          Chia sẻ mã phòng để bắt đầu
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {players.map((player) => {
        const playerAvatar = getPlayerAvatar(player);
        const isCurrent = player.id === currentUserId;
        const isPlayerHost = player.id === hostId;

        return (
          <div
            key={player.id}
            className={cn(
              "p-4 flex items-center gap-3 rounded-2xl border-[3px] border-candy-ink transition-all shadow-[4px_4px_0_0_#2B2D42] hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_#2B2D42]",
              isCurrent
                ? "bg-candy-pink text-candy-ink"
                : "bg-white text-candy-ink",
              !player.isOnline && "opacity-60 grayscale",
            )}
          >
            <AvatarFrame size="md">
              {playerAvatar.isAnimated && playerAvatar.spritesheet ? (
                <AnimatedSprite
                  src={playerAvatar.spritesheet}
                  scale={2.2}
                  row={0}
                  speed={120}
                />
              ) : (
                <Avatar
                  size="md"
                  fallback={playerAvatar.seed}
                  status={isCurrent ? "online" : "offline"}
                  className="border-0 shadow-none"
                />
              )}
            </AvatarFrame>
            <div className="flex-1 min-w-0">
              <p className="font-display text-sm truncate uppercase tracking-wide flex items-center gap-2">
                {player.name}
                {!player.isOnline && (
                  <span className="text-[8px] font-black uppercase tracking-wider text-candy-red bg-candy-red/10 px-1.5 py-0.5 rounded-md border border-candy-red/30">
                    Mất kết nối
                  </span>
                )}
              </p>
              <p
                className={cn(
                  "font-mono text-[9px] uppercase tracking-widest font-black opacity-80",
                  isCurrent ? "text-candy-ink" : "text-candy-pink",
                )}
              >
                {isCurrent && isPlayerHost
                  ? "BẠN (HOST)"
                  : isCurrent
                    ? "BẠN"
                    : isPlayerHost
                      ? "HOST"
                      : "ĐÃ SẴN SÀNG"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
