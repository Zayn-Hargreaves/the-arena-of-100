import React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ScrollText, Terminal } from "lucide-react";

export function AdminHeader() {
  const t = useTranslations("admin");

  return (
    <div className="relative bg-candy-red border-[3px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] overflow-hidden text-white flex flex-col md:flex-row items-center md:justify-between gap-6">
      <div className="absolute top-0 left-0 right-0 h-3 bg-white/20 z-0" />

      <div className="space-y-2 relative z-10 text-center md:text-left">
        <h1 className="font-display font-black text-3xl md:text-4xl tracking-wider uppercase flex items-center justify-center md:justify-start gap-3">
          <Terminal className="w-8 h-8 text-candy-yellow animate-pulse" />
          {t("title")}
        </h1>
        <p className="font-mono text-xs font-black uppercase text-white/90">
          {t("subtitle")}
        </p>
      </div>

      <div className="shrink-0 relative z-10 flex flex-col sm:flex-row items-center gap-3">
        <Link
          href="/admin/audit"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border-[3px] border-candy-ink rounded-2xl text-candy-ink font-display font-black text-xs shadow-[3px_3px_0_0_#000] uppercase tracking-wider hover:bg-candy-cloud active:translate-y-0.5 active:shadow-[1px_1px_0_0_#000] transition-all"
        >
          <ScrollText className="w-4 h-4 text-candy-blue" />
          {t("auditLog")}
        </Link>
        <span className="px-4 py-2 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl text-candy-ink font-display font-black text-xs shadow-[3px_3px_0_0_#000] uppercase tracking-wider">
          {t("rootAccess")}
        </span>
      </div>
    </div>
  );
}
