import React from "react";
import { useTranslations } from "next-intl";
import { Skull } from "lucide-react";

interface AdminKillSwitchProps {
  terminateRoomId: string;
  setTerminateRoomId: (id: string) => void;
  terminateMessage: string;
  setTerminateMessage: (msg: string) => void;
  terminating: boolean;
  onTerminateClick: () => void;
}

export function AdminKillSwitch({
  terminateRoomId,
  setTerminateRoomId,
  terminateMessage,
  setTerminateMessage,
  terminating,
  onTerminateClick,
}: AdminKillSwitchProps) {
  const tTerminate = useTranslations("admin.terminateRoom");

  return (
    <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] space-y-6">
      <div className="flex items-center gap-3 border-b-2 border-candy-ink/10 pb-4">
        <div className="p-2.5 bg-candy-red rounded-2xl border-[2.5px] border-candy-ink text-white shadow-[2px_2px_0_0_#000]">
          <Skull className="w-6 h-6" />
        </div>
        <div>
          <h2 className="font-display font-black text-xl text-candy-ink uppercase">
            {tTerminate("title")}
          </h2>
          <p className="font-mono text-xs font-bold text-candy-ink/60 uppercase">
            {tTerminate("subtitle")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="terminate-room-id"
            className="block font-mono text-xs font-black uppercase text-candy-ink"
          >
            {tTerminate("label")} <span className="text-candy-red">*</span>
          </label>
          <input
            id="terminate-room-id"
            type="text"
            value={terminateRoomId}
            onChange={(e) => setTerminateRoomId(e.target.value)}
            placeholder={tTerminate("roomIdPlaceholder")}
            disabled={terminating}
            aria-required="true"
            className="w-full bg-candy-cloud border-2 border-candy-ink rounded-xl px-4 py-2.5 font-mono text-sm text-candy-ink focus:outline-none focus:ring-2 focus:ring-candy-red disabled:opacity-50"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="terminate-message"
            className="block font-mono text-xs font-black uppercase text-candy-ink"
          >
            {tTerminate("messageLabel")}
          </label>
          <input
            id="terminate-message"
            type="text"
            value={terminateMessage}
            onChange={(e) => setTerminateMessage(e.target.value)}
            placeholder={tTerminate("messagePlaceholder")}
            disabled={terminating}
            maxLength={200}
            className="w-full bg-candy-cloud border-2 border-candy-ink rounded-xl px-4 py-2.5 font-mono text-sm text-candy-ink focus:outline-none focus:ring-2 focus:ring-candy-red disabled:opacity-50"
          />
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-mono text-xs text-candy-ink/70">
            {tTerminate("warning")}
          </p>
          <button
            type="button"
            onClick={onTerminateClick}
            disabled={terminating || !terminateRoomId.trim()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-candy-red hover:bg-candy-red/90 text-white font-display font-black text-xs uppercase tracking-wider rounded-2xl border-[3px] border-candy-ink shadow-[4px_4px_0_0_#000] active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
          >
            <Skull className="w-4 h-4" />
            {terminating ? tTerminate("submitting") : tTerminate("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
