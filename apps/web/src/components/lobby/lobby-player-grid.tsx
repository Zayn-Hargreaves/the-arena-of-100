"use client";

import React, { useState, useEffect, type FC } from "react";
import { useTranslations } from "next-intl";
import { Users, Crown, Sparkles, UserCheck, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/ui/avatar-frame";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { cn } from "@/lib/utils";
import { avatars, findAvatarBySeed, type AvatarOption } from "@/lib/avatars";
import { GAME_CONFIG, type AvatarSeed } from "@arena/shared";

export interface LobbyPlayer {
  id: string;
  name: string;
  status: string;
  score: number;
  isOnline: boolean;
}

interface LobbyPlayerGridProps {
  players: LobbyPlayer[];
  currentUserId: string | null;
  hostId: string | null;
  emptyStateMessage?: string;
  capacity?: number;
}

export const LobbyPlayerGrid: FC<LobbyPlayerGridProps> = ({
  players,
  currentUserId,
  hostId,
  emptyStateMessage,
  capacity = GAME_CONFIG.MAX_PLAYERS,
}) => {
  const t = useTranslations("lobby.playerGrid");

  const [selfAvatar, setSelfAvatar] = useState<AvatarOption>(() =>
    findAvatarBySeed("jellyfrog" as AvatarSeed),
  );

  useEffect(() => {
    try {
      const storedSeed = localStorage.getItem("avatarSeed") as AvatarSeed;
      if (storedSeed) {
        setSelfAvatar(findAvatarBySeed(storedSeed));
      }
    } catch {
      // Ignore localStorage read errors in SSR/sandboxed mode
    }
  }, []);

  const getPlayerAvatar = (player: LobbyPlayer): AvatarOption => {
    if (player.id === currentUserId) {
      return selfAvatar;
    }

    let hash = 0;
    for (let i = 0; i < player.name.length; i++) {
      hash += player.name.charCodeAt(i);
    }
    const index = Math.abs(hash) % avatars.length;
    const avatar = avatars[index] ?? avatars[0]!;
    return findAvatarBySeed(avatar.seed);
  };

  // Calculate dynamic placeholder slots to fill the arena grid nicely (minimum 6 slots)
  const minSlots = 6;
  const placeholderCount = Math.max(0, Math.min(minSlots - players.length, 5));

  if (players.length === 0) {
    return (
      <div className="col-span-full flex flex-col items-center justify-center py-16 px-4 rounded-3xl border-[3.5px] border-dashed border-candy-ink/25 bg-white/60 shadow-[4px_4px_0_0_#2B2D42]">
        <Users className="w-12 h-12 text-candy-pink stroke-[2] mb-3 animate-bounce" />
        <p className="font-display font-black text-lg text-candy-ink uppercase tracking-wider text-center">
          {emptyStateMessage ?? t("empty")}
        </p>
        <p className="font-sans text-xs font-semibold text-candy-ink/60 mt-1">
          {t("emptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
      {players.map((player) => {
        const playerAvatar = getPlayerAvatar(player);
        const isCurrent = player.id === currentUserId;
        const isPlayerHost = player.id === hostId;

        return (
          <div
            key={player.id}
            className={cn(
              "p-3.5 flex items-center gap-3 rounded-2xl border-[3px] border-candy-ink transition-all shadow-[3px_3px_0_0_#2B2D42] hover:translate-y-[-2px] hover:shadow-[5px_5px_0_0_#2B2D42] relative overflow-hidden",
              isCurrent
                ? "bg-gradient-to-br from-[#FFF5F7] via-white to-[#FFE8EE] border-candy-pink shadow-[4px_4px_0_0_#FF758F] ring-2 ring-candy-pink/30"
                : "bg-white text-candy-ink",
              player.isOnline === false && "opacity-60 grayscale",
            )}
          >
            {/* Corner Highlight for Current User */}
            {isCurrent && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-candy-pink rounded-full border-2 border-white shadow-sm" />
            )}

            <AvatarFrame
              size="md"
              className={cn(
                "bg-candy-cloud/70 border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] rounded-2xl overflow-hidden shrink-0",
                isCurrent && "border-candy-pink bg-[#FFE8EE]/40",
              )}
            >
              {playerAvatar.isAnimated && playerAvatar.spritesheet ? (
                <div className="w-full h-full flex items-center justify-center overflow-hidden">
                  <AnimatedSprite
                    src={playerAvatar.spritesheet}
                    width="44px"
                    height="44px"
                    scale={0.25}
                    row={0}
                    speed={120}
                  />
                </div>
              ) : (
                <Avatar
                  size="md"
                  fallback={playerAvatar.seed}
                  status={player.isOnline === false ? "offline" : "online"}
                  className="border-0 shadow-none"
                />
              )}
            </AvatarFrame>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 truncate">
                <p className="font-display font-black text-sm truncate uppercase tracking-wide text-candy-ink">
                  {player.name}
                </p>
                {isPlayerHost && (
                  <Crown className="w-4 h-4 text-candy-yellow fill-candy-yellow shrink-0" />
                )}
              </div>

              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                {isCurrent && isPlayerHost && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-candy-yellow border-[1.5px] border-candy-ink rounded-md text-[9px] font-display font-black text-candy-ink uppercase shadow-[1px_1px_0_0_#2B2D42]">
                    <Crown className="w-3 h-3" />
                    {t("youHost")}
                  </span>
                )}
                {isCurrent && !isPlayerHost && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-candy-pink text-white border-[1.5px] border-candy-ink rounded-md text-[9px] font-display font-black uppercase shadow-[1px_1px_0_0_#2B2D42]">
                    <Sparkles className="w-3 h-3" />
                    {t("you")}
                  </span>
                )}
                {!isCurrent && isPlayerHost && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-candy-yellow/30 text-candy-ink border border-candy-ink/40 rounded-md text-[9px] font-display font-black uppercase">
                    {t("host")}
                  </span>
                )}
                {!isCurrent && !isPlayerHost && player.status === "ready" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-candy-mint">
                    <UserCheck className="w-3 h-3 stroke-[2.5]" />
                    {t("ready")}
                  </span>
                )}
                {player.isOnline === false && (
                  <span className="text-[8px] font-black uppercase tracking-wider text-candy-red bg-candy-red/10 px-1.5 py-0.5 rounded-md border border-candy-red/30">
                    {t("offline")}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Dynamic Placeholder Slots */}
      {Array.from({ length: placeholderCount }).map((_, index) => (
        <div
          key={`placeholder-${index}`}
          className="p-3.5 flex items-center gap-3 rounded-2xl border-[2.5px] border-dashed border-candy-ink/20 bg-white/40 select-none transition-all"
        >
          <div className="w-12 h-12 rounded-2xl border-[2px] border-dashed border-candy-ink/20 bg-candy-cloud/40 flex items-center justify-center shrink-0">
            <Loader2 className="w-5 h-5 text-candy-ink/25 animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-xs uppercase tracking-wide text-candy-ink/35 truncate">
              {t("waitingSlot")}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider font-semibold text-candy-ink/25 mt-0.5">
              {t("slotNumber", {
                slot: players.length + index + 1,
                capacity: capacity ?? GAME_CONFIG.MAX_PLAYERS,
              })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};
