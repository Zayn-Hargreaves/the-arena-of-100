"use client";

import React, { useState, useRef, useEffect } from "react";
import { Copy, Check, Link as LinkIcon, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface RoomCodeCardProps {
  roomCode: string;
}

export const RoomCodeCard: React.FC<RoomCodeCardProps> = ({ roomCode }) => {
  const t = useTranslations("lobby.roomCodeCard");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const codeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const linkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (codeTimeoutRef.current) clearTimeout(codeTimeoutRef.current);
      if (linkTimeoutRef.current) clearTimeout(linkTimeoutRef.current);
    };
  }, []);

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
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
  };

  const handleCopyCode = async () => {
    const success = await copyToClipboard(roomCode);
    if (!isMountedRef.current) return;
    if (success) {
      setCopiedCode(true);
      if (codeTimeoutRef.current) clearTimeout(codeTimeoutRef.current);
      codeTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setCopiedCode(false);
        codeTimeoutRef.current = null;
      }, 2000);
    }
  };

  const handleCopyLink = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    const success = await copyToClipboard(url);
    if (!isMountedRef.current) return;
    if (success) {
      setCopiedLink(true);
      if (linkTimeoutRef.current) clearTimeout(linkTimeoutRef.current);
      linkTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setCopiedLink(false);
        linkTimeoutRef.current = null;
      }, 2000);
    }
  };

  return (
    <div className="p-5 bg-candy-cloud/60 border-[3.5px] border-candy-ink rounded-3xl space-y-4 shadow-[5px_5px_0_0_#2B2D42] relative overflow-hidden">
      {/* Top Tag */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border-[2.5px] border-candy-ink rounded-xl text-[11px] font-display font-black text-candy-ink uppercase tracking-wider shadow-[2px_2px_0_0_#2B2D42]">
          <Sparkles className="w-3.5 h-3.5 text-candy-yellow fill-candy-yellow" />
          {t("label")}
        </span>
        <span className="font-mono text-[11px] font-bold text-candy-ink/60 uppercase">
          {t("pinAndLink")}
        </span>
      </div>

      {/* Code Display with Fixed-Size Square Action Button */}
      <div className="bg-white p-3.5 rounded-2xl border-[3px] border-candy-ink flex items-center justify-between gap-3 shadow-[3px_3px_0_0_#2B2D42]">
        <span className="font-display font-black text-3xl md:text-4xl text-candy-blue tracking-widest uppercase select-all drop-shadow-[0_1px_0_#2B2D42]">
          {roomCode}
        </span>
        <button
          type="button"
          onClick={handleCopyCode}
          className={cn(
            "w-11 h-11 rounded-xl border-[2.5px] border-candy-ink flex items-center justify-center transition-all outline-none cursor-pointer shrink-0 shadow-[2px_2px_0_0_#2B2D42]",
            copiedCode
              ? "bg-candy-mint text-candy-ink shadow-[1px_1px_0_0_#2B2D42]"
              : "bg-candy-yellow text-candy-ink hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1px]",
          )}
          title={copiedCode ? t("copiedCode") : t("copyCode")}
          aria-label={copiedCode ? t("copiedCode") : t("copyCode")}
        >
          {copiedCode ? (
            <Check className="w-5 h-5 text-candy-ink stroke-[3] animate-bounce" />
          ) : (
            <Copy className="w-5 h-5 stroke-[2.5]" />
          )}
        </button>
      </div>

      {/* Copied Feedback Badge */}
      {copiedCode && (
        <div className="text-center font-display font-black text-xs text-candy-ink bg-candy-mint/30 border-2 border-candy-ink rounded-xl py-1.5 shadow-[2px_2px_0_0_#2B2D42] animate-fade-in flex items-center justify-center gap-1.5">
          <Check className="w-4 h-4 stroke-[3] text-candy-ink" />
          {t("copiedCode")}
        </div>
      )}

      {/* Invite Link Action */}
      <button
        type="button"
        onClick={handleCopyLink}
        className={cn(
          "w-full py-2.5 px-4 rounded-xl border-[2.5px] border-candy-ink text-candy-ink font-display font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:translate-y-[-1px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none",
          copiedLink ? "bg-candy-mint" : "bg-white hover:bg-candy-cloud",
        )}
      >
        {copiedLink ? (
          <>
            <Check className="w-4 h-4 text-candy-ink stroke-[3]" />
            <span>{t("copiedLink")}</span>
          </>
        ) : (
          <>
            <LinkIcon className="w-4 h-4 text-candy-pink stroke-[2.5]" />
            <span>{t("copyLink")}</span>
          </>
        )}
      </button>

      <p className="text-[11px] font-sans font-semibold text-candy-ink/65 text-center leading-tight">
        {t("shareHint")}
      </p>
    </div>
  );
};
