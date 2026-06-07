"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

export interface RoomCodeCardProps {
  roomCode: string;
}

export const RoomCodeCard: React.FC<RoomCodeCardProps> = ({ roomCode }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(roomCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = roomCode;
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "0";
        textarea.style.width = "0";
        textarea.style.height = "0";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        textarea.style.zIndex = "-9999";
        document.body.appendChild(textarea);
        try {
          textarea.focus();
          textarea.select();
          const successful = document.execCommand("copy");
          if (successful) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } else {
            console.error("Failed to copy code using execCommand");
          }
        } catch (err) {
          console.error("Fallback copy failed", err);
        } finally {
          if (textarea.parentNode) {
            document.body.removeChild(textarea);
          }
        }
      }
    } catch (err) {
      console.error("Failed to copy room code: ", err);
    }
  };

  return (
    <div className="p-4 bg-candy-cloud border-[3px] border-candy-ink rounded-2xl space-y-2 shadow-[4px_4px_0_0_#2B2D42]">
      <span className="text-xs font-bold text-candy-ink/75 font-sans">
        Mã Phòng Đấu
      </span>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display font-black text-3xl text-candy-blue tracking-widest uppercase select-all">
          {roomCode}
        </span>
        <button
          onClick={handleCopyCode}
          className="p-2.5 rounded-xl border-[3px] border-candy-ink bg-white text-candy-ink hover:translate-y-[-1px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all outline-none cursor-pointer"
          title="Sao chép mã"
        >
          {copied ? (
            <Check className="w-4 h-4 text-candy-mint stroke-[2.5]" />
          ) : (
            <Copy className="w-4 h-4 stroke-[2.5]" />
          )}
        </button>
      </div>
    </div>
  );
};
