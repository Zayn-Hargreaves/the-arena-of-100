import React from "react";
import { cn } from "@/lib/utils";

interface MessageCardProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "default" | "error";
}

export function MessageCard({
  message,
  actionLabel,
  onAction,
  tone = "default",
}: Readonly<MessageCardProps>) {
  return (
    <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-5 shadow-[4px_4px_0_0_#2B2D42] space-y-3">
      <p
        className={cn(
          "text-sm font-semibold leading-6 text-candy-ink",
          tone === "error" && "text-candy-red",
        )}
      >
        {message}
      </p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="min-h-11 px-4 py-2 rounded-xl bg-candy-pink text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
