"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { RankBadge } from "@/components/atoms/rank-badge";
import { Link } from "@/i18n/routing";
import { avatars, findAvatarBySeed, type AvatarOption } from "@/lib/avatars";
import {
  DEFAULT_AVATAR_SEED,
  isValidAvatarSeed,
  DEFAULT_RANK_TIER,
  DEFAULT_ELO,
} from "@arena/shared";
import { formatPlayedAt } from "@/lib/formatters";
import type { useProfileStats } from "@/hooks/use-profile-stats";
import type { Locale } from "@/i18n/routing";
import {
  LightningSpeedSvg,
  ClockTimerSvg,
  CheckmarkCheckSvg,
  SkullDefeatSvg,
  CopyClipboardSvg,
  EditAvatarSvg,
} from "./profile-icons";

// Resolves which avatar to render in the profile header.
function getActiveAvatar(
  profile: { user: { avatar: string } } | undefined,
  catalog: AvatarOption[],
): AvatarOption | undefined {
  const seed = profile?.user.avatar;
  if (seed && isValidAvatarSeed(seed)) {
    return findAvatarBySeed(seed);
  }
  return findAvatarBySeed(DEFAULT_AVATAR_SEED) ?? catalog[0];
}

interface ProfileHeroCardProps {
  profile: ReturnType<typeof useProfileStats>["data"];
  username?: string | null;
  locale: Locale;
}

export function ProfileHeroCard({
  profile,
  username,
  locale,
}: Readonly<ProfileHeroCardProps>) {
  const t = useTranslations("profile");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [hasClipboard, setHasClipboard] = useState(false);
  const copyTimerRef = useRef<NodeJS.Timeout | number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    setHasClipboard(
      typeof navigator !== "undefined" &&
        (Boolean(
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === "function",
        ) ||
          (typeof document !== "undefined" &&
            typeof document.execCommand === "function")),
    );
    return () => {
      isMountedRef.current = false;
      if (copyTimerRef.current != null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  const activeName = profile?.user.username || username || t("hero.guestName");
  const activeAvatar = getActiveAvatar(profile, avatars);
  const uid = profile?.user.id ?? null;

  const copyWithFallback = useCallback((text: string): boolean => {
    try {
      if (typeof document === "undefined") return false;
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      try {
        textarea.focus();
        textarea.select();
        return document.execCommand("copy");
      } finally {
        document.body.removeChild(textarea);
      }
    } catch {
      return false;
    }
  }, []);

  const handleCopyUid = useCallback(() => {
    if (!uid) return;

    const setCopyStatus = (success: boolean) => {
      if (!isMountedRef.current) return;
      setCopied(success);
      setCopyFailed(!success);
      if (copyTimerRef.current != null) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setCopied(false);
        setCopyFailed(false);
        copyTimerRef.current = null;
      }, 2000);
    };

    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      navigator.clipboard
        .writeText(uid)
        .then(() => {
          setCopyStatus(true);
        })
        .catch(() => {
          const fallbackSuccess = copyWithFallback(uid);
          setCopyStatus(fallbackSuccess);
        });
    } else {
      const fallbackSuccess = copyWithFallback(uid);
      setCopyStatus(fallbackSuccess);
    }
  }, [uid, copyWithFallback]);

  return (
    <div className="relative bg-candy-yellow border-[3.5px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[7px_7px_0_0_#2B2D42] overflow-hidden flex flex-col md:flex-row items-center gap-6 md:gap-8">
      {/* Top Decorative Arcade Hologram Band */}
      <div className="absolute top-0 left-0 right-0 h-3.5 bg-candy-pink/30 z-0 flex items-center justify-around overflow-hidden">
        <div className="w-full h-full bg-[repeating-linear-gradient(45deg,#2B2D42_0,#2B2D42_10px,transparent_10px,transparent_20px)] opacity-10" />
      </div>

      {/* Fighter Avatar Portrait */}
      <div className="relative z-10 shrink-0 mt-1 md:mt-0">
        <div className="relative p-1 bg-white rounded-3xl border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42]">
          <SpriteFrame
            src={activeAvatar?.spritesheet}
            scale={0.5}
            width="96px"
            height="104px"
            frameClassName="w-28 h-28 md:w-32 md:h-32 rounded-2xl border-[2.5px] border-candy-ink bg-candy-cloud/40"
            skeletonSize="96px"
          />
          <div className="absolute -bottom-2.5 -right-2.5 w-9 h-9 rounded-full bg-candy-pink text-white flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42]">
            <LightningSpeedSvg size={18} />
          </div>
        </div>
      </div>

      {/* Fighter Info & Actions */}
      <div className="flex-1 text-center md:text-left space-y-3 z-10 relative w-full">
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
          <span className="px-3 py-1 rounded-xl bg-candy-ink text-white text-[10px] font-mono font-black tracking-widest uppercase shadow-[2px_2px_0_0_#2B2D42]">
            {t("hero.fighterPass")}
          </span>
          <span className="px-3 py-1 rounded-xl bg-candy-blue border-2 border-candy-ink text-white text-xs font-mono font-black tracking-wider uppercase shadow-[2px_2px_0_0_#2B2D42]">
            {activeAvatar?.name ??
              findAvatarBySeed(DEFAULT_AVATAR_SEED)?.name ??
              avatars[0]?.name ??
              ""}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-center md:justify-start gap-3">
          <h2 className="font-display font-black text-2xl md:text-4xl tracking-wide text-candy-ink uppercase break-all">
            {activeName}
          </h2>
          {profile && (
            <RankBadge
              tier={profile.user.rankTier ?? DEFAULT_RANK_TIER}
              elo={profile.user.elo ?? DEFAULT_ELO}
              size="md"
              showElo={true}
              className="w-fit mx-auto md:mx-0 shadow-[2px_2px_0_0_#2B2D42]"
            />
          )}
        </div>

        {/* Sub-meta: Registered date, UID + Quick actions */}
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs font-mono font-black text-candy-ink/80 pt-1">
          <span className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-xl border border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42]">
            <ClockTimerSvg size={14} />
            {profile?.user.createdAt
              ? formatPlayedAt(profile.user.createdAt, locale)
              : t("registeredToday")}
          </span>

          {uid ? (
            <>
              <span className="sr-only" aria-live="polite" aria-atomic="true">
                {copied
                  ? t("hero.copied")
                  : copyFailed
                    ? t("hero.copyFailed")
                    : `UID: ${uid}`}
              </span>
              {hasClipboard ? (
                <button
                  type="button"
                  onClick={handleCopyUid}
                  className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] text-candy-pink hover:bg-candy-pink hover:text-white transition-colors cursor-pointer"
                  title={t("hero.copyUid")}
                >
                  {copied ? (
                    <>
                      <CheckmarkCheckSvg size={14} />
                      <span>{t("hero.copied")}</span>
                    </>
                  ) : copyFailed ? (
                    <>
                      <SkullDefeatSvg size={14} />
                      <span>{t("hero.copyFailed")}</span>
                    </>
                  ) : (
                    <>
                      <CopyClipboardSvg size={14} />
                      <span>UID: {uid}</span>
                    </>
                  )}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-xl border border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] text-candy-ink">
                  <CopyClipboardSvg size={14} />
                  <span>UID: {uid}</span>
                </span>
              )}
            </>
          ) : null}

          <Link
            href="/settings"
            className="flex items-center gap-1.5 bg-candy-mint text-white px-3 py-1 rounded-xl border border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0 transition-transform cursor-pointer"
          >
            <EditAvatarSvg size={14} />
            <span>{t("hero.editAvatar")}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
