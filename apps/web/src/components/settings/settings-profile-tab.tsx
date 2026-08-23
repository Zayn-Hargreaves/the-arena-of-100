"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { avatars, type AvatarOption } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import type { AvatarSeed } from "@arena/shared";
import {
  UserBadgeSvg,
  SparklesCandySvg,
  CheckmarkBadgeSvg,
} from "./settings-icons";

interface SettingsProfileTabProps {
  callsign: string;
  onCallsignChange: (value: string) => void;
  onSaveCallsign: (e?: React.FormEvent) => void;
  selectedAvatarSeed: AvatarSeed;
  currentAvatar?: AvatarOption;
  profileLoading: boolean;
  onAvatarChange: (seed: AvatarSeed) => void;
  updateAvatarPending: boolean;
  submittingSeed: AvatarSeed | null;
}

export function SettingsProfileTab({
  callsign,
  onCallsignChange,
  onSaveCallsign,
  selectedAvatarSeed,
  currentAvatar,
  profileLoading,
  onAvatarChange,
  updateAvatarPending,
  submittingSeed,
}: Readonly<SettingsProfileTabProps>) {
  const t = useTranslations("settings");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Callsign & Live Preview Showcase */}
      <div className="lg:col-span-5 space-y-6">
        {/* Callsign Form */}
        <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-5 rounded-3xl space-y-4">
          <div className="flex items-center gap-2 text-candy-ink">
            <UserBadgeSvg className="w-5 h-5" />
            <h3 className="font-display font-black text-xs uppercase tracking-wider">
              {t("profile.callsignLabel")}
            </h3>
          </div>

          <form onSubmit={onSaveCallsign} className="space-y-3">
            <div className="relative">
              <input
                type="text"
                maxLength={20}
                value={callsign}
                onChange={(e) => onCallsignChange(e.target.value)}
                placeholder={t("profile.callsignPlaceholder")}
                className="w-full h-11 px-3.5 rounded-2xl bg-white border-[2.5px] border-candy-ink font-display font-black text-sm text-candy-ink placeholder:text-candy-ink/40 shadow-[2px_2px_0_0_#2B2D42] focus:outline-none focus:ring-2 focus:ring-candy-pink"
              />
            </div>
            <p className="font-body text-[11px] text-candy-ink/70 font-semibold leading-relaxed">
              {t("profile.callsignHint")}
            </p>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-candy-yellow text-candy-ink font-display font-black text-xs uppercase tracking-wide border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer"
            >
              {t("profile.saveCallsign")}
            </button>
          </form>
        </div>

        {/* Avatar Showcase Card */}
        <div className="bg-white border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl text-center relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-20 h-20 bg-candy-yellow/20 rounded-full blur-xl pointer-events-none" />
          <span className="inline-block px-3 py-1 rounded-full bg-candy-sky text-candy-ink font-mono text-[10px] font-black uppercase tracking-wider border-[1.5px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] mb-3">
            {t("profile.avatarShowcase")}
          </span>

          {profileLoading ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Skeleton width="110px" height="110px" className="rounded-3xl" />
              <Skeleton width="140px" height="20px" />
              <Skeleton width="90px" height="12px" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="w-28 h-28 rounded-3xl bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] flex items-center justify-center relative overflow-hidden group">
                <SpriteFrame
                  src={currentAvatar?.spritesheet}
                  scale={0.48}
                  width="88px"
                  height="96px"
                  frameClassName="w-24 h-24 rounded-2xl"
                  skeletonSize="72px"
                />
              </div>
              <h4 className="font-display font-black text-lg text-candy-ink uppercase tracking-wide mt-2 drop-shadow-[1px_1px_0_#FFE45E]">
                {currentAvatar?.name ?? t("profile.avatarFallback")}
              </h4>
              <p className="font-mono text-xs text-candy-ink/60 font-black uppercase tracking-widest">
                {t("profile.seedLabel")} #{selectedAvatarSeed}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Avatar Selection Roster */}
      <div className="lg:col-span-7 bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-5 sm:p-6 rounded-3xl space-y-4">
        <div className="flex items-center justify-between border-b-[2px] border-dashed border-candy-ink/20 pb-3">
          <div>
            <h3 className="font-display font-black text-sm uppercase tracking-wider text-candy-ink flex items-center gap-2">
              <SparklesCandySvg className="w-5 h-5" />
              {t("profile.avatarGallery")}
            </h3>
            <p className="font-body text-xs text-candy-ink/75 font-semibold mt-0.5">
              {t("profile.chooseTip")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pt-2">
          {avatars.map((avatar) => {
            const isActive = avatar.seed === selectedAvatarSeed;
            const isPending =
              updateAvatarPending && avatar.seed === submittingSeed;

            return (
              <button
                key={avatar.seed}
                type="button"
                aria-pressed={isActive}
                aria-disabled={updateAvatarPending}
                aria-busy={isPending}
                disabled={updateAvatarPending}
                onClick={() => {
                  if (!updateAvatarPending) {
                    onAvatarChange(avatar.seed);
                  }
                }}
                className={cn(
                  "group rounded-2xl border-[3px] border-candy-ink p-2.5 text-center transition-all cursor-pointer relative",
                  isActive
                    ? "bg-candy-yellow -translate-y-1 shadow-[4px_4px_0_0_#2B2D42]"
                    : "bg-white hover:bg-candy-yellow/20 hover:-translate-y-0.5 shadow-[2px_2px_0_0_#2B2D42]",
                  isPending && "opacity-60 animate-pulse",
                  updateAvatarPending && "cursor-not-allowed opacity-60",
                )}
              >
                {isActive && (
                  <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-candy-mint border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] flex items-center justify-center z-10">
                    <CheckmarkBadgeSvg
                      className="w-3.5 h-3.5 text-white"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{t("profile.selected")}</span>
                  </span>
                )}
                <div className="w-14 h-14 mx-auto rounded-xl bg-candy-cloud border-[2px] border-candy-ink flex items-center justify-center overflow-hidden">
                  <SpriteFrame
                    src={avatar.spritesheet}
                    scale={0.24}
                    width="48px"
                    height="52px"
                    frameClassName="w-14 h-14"
                    skeletonSize="36px"
                  />
                </div>
                <p className="mt-2 text-[10px] font-display font-black uppercase text-candy-ink truncate">
                  {avatar.name}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
