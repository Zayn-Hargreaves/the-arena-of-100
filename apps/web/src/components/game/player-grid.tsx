"use client";

import React from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface Player {
  id: string;
  name: string;
  status: "active" | "eliminated" | "offline";
  score?: number;
}

export interface PlayerGridProps {
  players: Player[];
  maxPlayers?: number;
  className?: string;
}

export const PlayerGrid: React.FC<PlayerGridProps> = ({
  players,
  maxPlayers = 100,
  className = "",
}) => {
  // Create array with all player slots
  const playerSlots = Array.from({ length: maxPlayers }, (_, index) => {
    const player = players[index];
    return {
      id: player?.id || `empty-${index}`,
      name: player?.name || "",
      status: player?.status || "offline",
      isEmpty: !player,
    };
  });

  return (
    <div className={cn("grid grid-cols-10 gap-2", className)}>
      {playerSlots.map((slot) => {
        if (slot.isEmpty) {
          return (
            <div
              key={slot.id}
              className="jelly-card w-full aspect-square rounded-full bg-candy-cloud border-2 border-candy-ink opacity-30"
            />
          );
        }

        return (
          <div
            key={slot.id}
            className={cn(
              "jelly-card aspect-square rounded-full border-2 border-candy-ink transition-all duration-300",
              slot.status === "eliminated" &&
                "grayscale opacity-50 animate-pulse",
              "hover:translate-y-[-2px] hover:shadow-[0_12px_0_0_#2B2D42]",
            )}
          >
            <Avatar
              size="xs"
              fallback={slot.name}
              status={
                slot.status === "active"
                  ? "online"
                  : slot.status === "eliminated"
                    ? "eliminated"
                    : "offline"
              }
              className={cn(
                "w-full h-full rounded-full",
                slot.status === "eliminated" && "grayscale",
              )}
            />
          </div>
        );
      })}
    </div>
  );
};

// Loading state component
export const PlayerGridSkeleton: React.FC<{ maxPlayers?: number }> = ({
  maxPlayers = 100,
}) => {
  return (
    <div className="grid grid-cols-10 gap-2">
      {Array.from({ length: maxPlayers }).map((_, index) => (
        <Skeleton
          key={index}
          className="aspect-square rounded-full bg-candy-cloud"
        />
      ))}
    </div>
  );
};

PlayerGrid.displayName = "PlayerGrid";
