import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AvatarSelector } from "@/components/home/avatar-selector";
import { ProfessorGreetingCard } from "@/components/home/professor-greeting-card";
import {
  ArrowRightSvg,
  FlameSvg,
  SparkleSmallSvg,
  SwordsSvg,
  UserCheckSvg,
} from "@/components/home/home-icons";
import type { AvatarOption } from "@/lib/avatars";

interface HomeArenaCardProps {
  nickname: string;
  setNickname: (name: string) => void;
  roomCode: string;
  setRoomCode: (code: string) => void;
  isJoining: boolean;
  setIsJoining: (joining: boolean) => void;
  isSubmitting: boolean;
  avatar: AvatarOption;
  squash: boolean;
  cycleAvatar: (direction: number) => void;
  username: string | null;
  onQuickMatchSubmit: (e: React.SubmitEvent) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
}

export function HomeArenaCard({
  nickname,
  setNickname,
  roomCode,
  setRoomCode,
  isJoining,
  setIsJoining,
  isSubmitting,
  avatar,
  squash,
  cycleAvatar,
  username,
  onQuickMatchSubmit,
  onCreateRoom,
  onJoinRoom,
}: HomeArenaCardProps) {
  const t = useTranslations("HomePage");

  return (
    <div className="jelly-card p-6 md:p-8 bg-white relative">
      {/* Subway Surfers Graffiti Accents */}
      <div className="absolute -top-3 -right-3 bg-candy-mint text-white font-display text-xs px-4 py-1.5 border-4 border-candy-ink rounded-xl transform rotate-6 shadow-[2px_2px_0_0_#000] flex items-center gap-1.5">
        <span>{t("guestLogin")}</span>
        <SparkleSmallSvg size={14} />
      </div>

      {/* Professor Attendance Desk / Greeting */}
      <ProfessorGreetingCard nickname={nickname} avatarName={avatar.name} />

      <form onSubmit={onQuickMatchSubmit} className="space-y-6">
        <AvatarSelector
          avatar={avatar}
          isAnimating={squash}
          onPrevious={() => cycleAvatar(-1)}
          onNext={() => cycleAvatar(1)}
        />

        {/* Comic-book style Callsign / Nickname Input */}
        <div className="text-left">
          <label
            className="font-display text-sm text-candy-ink mb-2 uppercase tracking-wide flex items-center gap-1.5"
            htmlFor="nickname"
          >
            <span>{t("nicknameLabel")}</span>
            <FlameSvg size={18} />
          </label>
          <div className="relative">
            <input
              required
              disabled={isSubmitting}
              maxLength={16}
              className="w-full bg-candy-cloud border-4 border-candy-ink text-candy-ink font-display text-xl rounded-2xl py-4 px-5 focus:ring-4 focus:ring-candy-pink/30 focus:border-candy-ink transition-all placeholder:text-candy-ink/45 outline-none disabled:opacity-50"
              id="nickname"
              placeholder={t("nicknamePlaceholder")}
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            {username && (
              <div
                className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center text-candy-mint"
                title={t("socketSynced")}
              >
                <UserCheckSvg size={20} />
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 space-y-4">
          {/* Primary Giant 3D Play button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-14 jelly-btn bg-candy-mint text-white font-display text-xl py-4 uppercase tracking-wide flex items-center justify-center gap-3 disabled:opacity-50"
          >
            <SwordsSvg size={24} className="shrink-0" />
            <span>{t("enterArena")}</span>
          </Button>

          {/* Secondary private room bubble buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCreateRoom}
              className="w-full min-h-12 bg-white hover:bg-candy-cloud text-candy-ink font-display text-xs border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("createRoom")}
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setIsJoining(!isJoining)}
              className="w-full min-h-12 bg-candy-cloud/40 hover:bg-candy-cloud text-candy-ink font-display text-xs border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("joinRoom")}
            </button>
          </div>
        </div>
      </form>

      {/* Expansible Room Code form */}
      {isJoining && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onJoinRoom();
          }}
          className="mt-6 space-y-3 text-left p-4 bg-candy-cloud border-4 border-candy-ink rounded-2xl animate-in slide-in-from-top duration-300"
        >
          <label
            htmlFor="room-code"
            className="block text-xs font-mono font-bold text-candy-ink uppercase tracking-wider"
          >
            {t("roomCode")}
          </label>
          <div className="flex gap-2">
            <input
              id="room-code"
              type="text"
              disabled={isSubmitting}
              placeholder={t("roomCodePlaceholder")}
              maxLength={6}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              aria-label={t("roomCode")}
              className="flex-1 h-12 px-4 rounded-xl bg-white border-3 border-candy-ink text-candy-ink placeholder:text-candy-ink/30 font-mono font-bold text-center tracking-widest text-sm uppercase focus:outline-none focus:border-candy-blue disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-12 px-5 rounded-xl bg-candy-blue border-3 border-candy-ink text-white hover:bg-candy-blue/90 shadow-[2px_2px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[0px_0px_0_0_#2B2D42] font-mono font-bold text-xs flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              aria-label={t("joinRoom")}
            >
              <ArrowRightSvg size={20} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
