"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Swords } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/ui/avatar-frame";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { avatars } from "@/lib/avatars";

export interface OpponentPlayer {
  id: string;
  name: string;
  status: string;
}

export interface OpponentsSidebarProps {
  players: OpponentPlayer[];
  userId: string | null;
}

/**
 * Live opponents list, reading from the server-authoritative
 * `match.players` roster (never mock data). Alive players (ACTIVE /
 * DISCONNECTED) sort first, eliminated last, preserving the server's
 * deterministic join order within each group. Falls back to a neutral
 * "waiting for player list" hint when the roster is empty.
 */
export const OpponentsSidebar: React.FC<OpponentsSidebarProps> = ({
  players,
  userId,
}) => {
  const t = useTranslations("Game");

  // Reading localStorage during render causes a hydration mismatch
  // (SSR has no localStorage, so the server-rendered markup would
  // differ from the client's first render). Use SSR-safe defaults and
  // populate the real values after mount instead.
  const [selfAvatar, setSelfAvatar] = React.useState({
    seed: "jellyfrog",
    isAnimated: false,
    spritesheet: "",
  });

  React.useEffect(() => {
    setSelfAvatar({
      seed: localStorage.getItem("avatarSeed") || "jellyfrog",
      isAnimated: localStorage.getItem("avatarIsAnimated") === "true",
      spritesheet: localStorage.getItem("avatarSpritesheet") || "",
    });
  }, []);

  const getPlayerAvatar = (name: string, id: string) => {
    if (id === userId) {
      return selfAvatar;
    }
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash += name.charCodeAt(i);
    }
    const index = hash % avatars.length;
    const avatar = avatars[index]!;

    // Normalize avatar data to ensure consistent shape
    return {
      seed: avatar.seed,
      isAnimated: Boolean(avatar.isAnimated),
      spritesheet: avatar.spritesheet || "",
    };
  };

  return (
    <div className="p-5 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[5px_5px_0_0_#2B2D42] space-y-4">
      <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-2">
        <Swords className="w-4 h-4 text-candy-red stroke-[2.5]" />
        {t("opponentsTitle")}
      </h3>

      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
        {players.length === 0 ? (
          <div
            data-testid="opponents-empty"
            className="text-xs text-candy-ink/50 italic px-2 py-3 text-center"
          >
            {t("opponentsEmpty")}
          </div>
        ) : (
          [...players]
            .sort((a, b) => {
              const aEliminated = a.status === "ELIMINATED";
              const bEliminated = b.status === "ELIMINATED";
              if (aEliminated !== bEliminated) {
                return aEliminated ? 1 : -1;
              }
              return 0;
            })
            .map((player) => {
              const avatarDetail = getPlayerAvatar(player.name, player.id);
              const isAlive = player.status !== "ELIMINATED";

              return (
                <div
                  key={player.id}
                  data-testid={`opponent-${player.id}`}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-candy-cloud border-[2px] border-candy-ink text-xs shadow-[2px_2px_0_0_#2B2D42]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AvatarFrame size="xs" className="bg-white">
                      {avatarDetail.isAnimated && avatarDetail.spritesheet ? (
                        <AnimatedSprite
                          src={avatarDetail.spritesheet}
                          scale={1.8}
                          row={0}
                          speed={120}
                        />
                      ) : (
                        <Avatar
                          size="xs"
                          fallback={avatarDetail.seed}
                          className="border-0 shadow-none"
                        />
                      )}
                    </AvatarFrame>
                    <span className="font-display font-black text-candy-ink truncate max-w-[80px]">
                      {player.name}
                    </span>
                  </div>
                  <div className="shrink-0 ml-1">
                    {isAlive ? (
                      <span className="text-[9px] font-display font-black text-candy-ink bg-candy-mint border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                        {t("aliveStatus")}
                      </span>
                    ) : (
                      <span className="text-[9px] font-display font-black text-white bg-candy-red border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                        {t("eliminatedStatus")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
};

OpponentsSidebar.displayName = "OpponentsSidebar";
