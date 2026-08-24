import React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdminDangerZoneProps {
  seeding: boolean;
  resetting: boolean;
  onSeedQuestions: () => void;
  onResetSystem: () => void;
}

export function AdminDangerZone({
  seeding,
  resetting,
  onSeedQuestions,
  onResetSystem,
}: AdminDangerZoneProps) {
  const t = useTranslations("admin");

  return (
    <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] space-y-6">
      <div className="flex items-center gap-3 border-b-2 border-candy-ink/10 pb-4">
        <div className="p-2.5 bg-candy-yellow rounded-2xl border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#000]">
          <ShieldCheck className="w-6 h-6 text-candy-ink" />
        </div>
        <div>
          <h2 className="font-display font-black text-xl text-candy-ink uppercase">
            {t("dangerZoneTitle")}
          </h2>
          <p className="font-mono text-xs font-bold text-candy-ink/60 uppercase">
            {t("dangerZoneSubtitle")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Seed Database Card */}
        <div className="bg-[#FFF8E7] border-2 border-candy-ink rounded-2xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="font-display font-black text-base text-candy-ink uppercase flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-candy-blue" />
              {t("dbSyncTitle")}
            </h3>
            <p className="font-mono text-xs text-candy-ink/70">
              {t("dbSyncDesc")}
            </p>
          </div>

          <Button
            variant="secondary"
            onClick={onSeedQuestions}
            disabled={seeding || resetting}
            isLoading={seeding}
            leftIcon={RefreshCw}
          >
            {seeding ? t("syncing") : t("syncBtn")}
          </Button>
        </div>

        {/* Reset System Card */}
        <div className="bg-[#FFE5EC] border-2 border-candy-ink rounded-2xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="font-display font-black text-base text-candy-red uppercase flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-candy-red" />
              {t("systemResetTitle")}
            </h3>
            <p className="font-mono text-xs text-candy-ink/70">
              {t("systemResetDesc")}
            </p>
          </div>

          <Button
            variant="danger"
            onClick={onResetSystem}
            disabled={seeding || resetting}
            isLoading={resetting}
            leftIcon={AlertTriangle}
          >
            {resetting ? t("resetting") : t("resetBtn")}
          </Button>
        </div>
      </div>
    </div>
  );
}
