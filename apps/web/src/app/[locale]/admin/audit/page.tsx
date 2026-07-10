"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ScrollText,
} from "lucide-react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Link, useRouter } from "@/i18n/routing";
import { useSocketStore } from "@/stores/socket-store";
import { useAuditEvents } from "@/hooks/use-audit-events";
import { AuditFiltersBar } from "@/components/admin/audit-filters";
import { AuditTable } from "@/components/admin/audit-table";

const PAGE_SIZE = 25;

export default function AdminAuditPage() {
  const t = useTranslations("admin.audit");
  const router = useRouter();
  const userRole = useSocketStore((state) => state.userRole);

  const {
    events,
    total,
    page,
    pageCount,
    hasPrev,
    hasNext,
    filters,
    isLoading,
    isFetching,
    isError,
    setFilters,
    resetFilters,
    nextPage,
    prevPage,
    refetch,
  } = useAuditEvents({ pageSize: PAGE_SIZE });

  // Same client-side clearance gate as the main admin console. The
  // endpoint is also server-guarded (Role.ADMIN), so this is UX, not
  // the security boundary.
  if (userRole !== "ADMIN") {
    return (
      <AppShellLayout>
        <div className="max-w-md mx-auto w-full text-center space-y-6 pt-12 select-none">
          <div className="bg-candy-red border-[3px] border-candy-ink rounded-3xl p-8 shadow-[6px_6px_0_0_#2B2D42] text-white space-y-4">
            <div className="flex justify-center">
              <AlertTriangle className="w-16 h-16 text-candy-yellow animate-bounce" />
            </div>
            <h1 className="font-display font-black text-2xl tracking-wider uppercase">
              {t("accessDenied.title")}
            </h1>
            <p className="font-mono text-xs font-black uppercase text-white/95 leading-relaxed">
              {t("accessDenied.description")}
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all"
          >
            {t("accessDenied.returnHome")}
          </button>
        </div>
      </AppShellLayout>
    );
  }

  // page is 0-based internally; display 1-based.
  const displayPage = Math.min(page + 1, pageCount);

  return (
    <AppShellLayout>
      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none">
        {/* Header */}
        <div className="relative bg-candy-blue border-[3px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] overflow-hidden text-white flex flex-col md:flex-row items-center md:justify-between gap-6">
          <div className="absolute top-0 left-0 right-0 h-3 bg-white/20 z-0" />
          <div className="space-y-2 relative z-10 text-center md:text-left">
            <h1 className="font-display font-black text-3xl md:text-4xl tracking-wider uppercase flex items-center justify-center md:justify-start gap-3">
              <ScrollText className="w-8 h-8 text-candy-yellow" />
              {t("title")}
            </h1>
            <p className="font-mono text-xs font-black uppercase text-white/90">
              {t("subtitle")}
            </p>
          </div>
          <Link
            href="/admin"
            className="shrink-0 relative z-10 inline-flex items-center gap-2 px-4 py-2 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl text-candy-ink font-display font-black text-xs shadow-[3px_3px_0_0_#000] uppercase tracking-wider hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[1px_1px_0_0_#000] transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
            {t("backToConsole")}
          </Link>
        </div>

        {/* Filters */}
        <AuditFiltersBar
          value={filters}
          onApply={setFilters}
          onReset={resetFilters}
          disabled={isFetching}
        />

        {/* Table */}
        <AuditTable
          events={events}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          onRetry={refetch}
          pageSize={PAGE_SIZE}
        />

        {/* Pagination */}
        {!isError && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white border-[3px] border-candy-ink rounded-3xl px-5 py-4 shadow-[4px_4px_0_0_#2B2D42]">
            <span className="font-mono text-[11px] font-black uppercase text-candy-ink/70">
              {t("pagination.summary", {
                page: displayPage,
                pageCount,
                total,
              })}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={prevPage}
                disabled={!hasPrev || isFetching}
                className="inline-flex items-center justify-center h-10 px-4 bg-white border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[3px_3px_0_0_#000] hover:bg-candy-cloud active:translate-y-0.5 active:shadow-[1px_1px_0_0_#000] transition-all disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t("pagination.prev")}
              </button>
              <button
                type="button"
                onClick={nextPage}
                disabled={!hasNext || isFetching}
                className="inline-flex items-center justify-center h-10 px-4 bg-white border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[3px_3px_0_0_#000] hover:bg-candy-cloud active:translate-y-0.5 active:shadow-[1px_1px_0_0_#000] transition-all disabled:opacity-40 disabled:pointer-events-none"
              >
                {t("pagination.next")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShellLayout>
  );
}
