"use client";

import React, { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import {
  KNOWN_AUDIT_EVENT_TYPES,
  type AuditEvent,
  type AuditEventType,
} from "@/lib/api/audit";
import type { Locale } from "@/i18n/routing";

const KNOWN_EVENT_TYPE_SET = new Set<string>(KNOWN_AUDIT_EVENT_TYPES);

interface AuditTableProps {
  events: AuditEvent[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  onRetry: () => void;
  pageSize: number;
}

const LOCALE_BCP47: Record<string, string> = {
  vi: "vi-VN",
  en: "en-US",
};

/** Date + time — the audit log needs second-level precision. */
function formatTimestamp(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE_BCP47[locale] ?? "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/** Candy-system accent per known action; neutral for anything else. */
function eventTypeAccent(eventType: AuditEventType): string {
  switch (eventType) {
    case "ADMIN_TERMINATE_ROOM":
      return "bg-candy-red text-white";
    case "ADMIN_RESET_SYSTEM":
      return "bg-candy-blue text-white";
    case "ADMIN_SYNC_QUESTIONS":
      return "bg-candy-mint text-white";
    default:
      return "bg-candy-cloud text-candy-ink";
  }
}

const cellClass =
  "px-4 py-3 align-top font-mono text-xs text-candy-ink border-b-[2px] border-candy-ink/10";

const headClass =
  "px-4 py-3 text-left font-display font-black text-[11px] uppercase tracking-wider text-candy-ink border-b-[3px] border-candy-ink";

function EventTypeBadge({ eventType }: { eventType: AuditEventType }) {
  const t = useTranslations("admin.audit");
  // Fall back to the raw event type if it isn't one we have a
  // translation for (unknown/future event types still render
  // legibly instead of showing a broken i18n key).
  const label = KNOWN_EVENT_TYPE_SET.has(eventType)
    ? t(`eventTypes.${eventType}`)
    : eventType;
  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-lg border-[2px] border-candy-ink text-[10px] font-mono font-black uppercase shadow-[2px_2px_0_0_#000] ${eventTypeAccent(eventType)}`}
    >
      {label}
    </span>
  );
}

/** Compact, scrollable JSON view of the audit row payload. */
function PayloadCell({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations("admin.audit");
  const hasPayload = payload && Object.keys(payload).length > 0;

  if (!hasPayload) {
    return <span className="text-candy-ink/40">{t("table.none")}</span>;
  }

  return (
    <pre className="max-w-xs max-h-32 overflow-auto rounded-lg bg-candy-cloud border-[2px] border-candy-ink/20 p-2 text-[10px] leading-relaxed text-candy-ink whitespace-pre-wrap break-words">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function TargetCell({ event }: { event: AuditEvent }) {
  const t = useTranslations("admin.audit");
  if (!event.roomId && !event.matchId) {
    return <span className="text-candy-ink/40">{t("table.none")}</span>;
  }
  return (
    <div className="space-y-1">
      {event.roomId && (
        <div>
          <span className="text-candy-ink/50">{t("table.roomLabel")} </span>
          <span className="font-black">{event.roomId}</span>
        </div>
      )}
      {event.matchId && (
        <div>
          <span className="text-candy-ink/50">{t("table.matchLabel")} </span>
          <span className="font-black">{event.matchId}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Presentational audit-events table. Owns only its render states
 * (skeleton / error / empty / rows); paging and filtering live in
 * the parent so this stays reusable and easy to test.
 */
export function AuditTable({
  events,
  isLoading,
  isFetching,
  isError,
  onRetry,
  pageSize,
}: AuditTableProps) {
  const t = useTranslations("admin.audit");
  const locale = useLocale() as Locale;

  const skeletonRows = useMemo(
    () => Array.from({ length: Math.min(pageSize, 8) }, (_, i) => i),
    [pageSize],
  );

  // Error takes precedence, then first-load skeleton, then empty.
  if (isError) {
    return (
      <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-10 text-center shadow-[6px_6px_0_0_#2B2D42] space-y-4">
        <AlertTriangle className="w-12 h-12 text-candy-red mx-auto" />
        <h3 className="font-display font-black text-base uppercase text-candy-ink">
          {t("error.title")}
        </h3>
        <p className="font-mono text-xs font-bold text-candy-ink/70 max-w-md mx-auto">
          {t("error.description")}
        </p>
        <button
          onClick={onRetry}
          className="inline-flex items-center justify-center h-11 px-5 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          {t("error.retry")}
        </button>
      </div>
    );
  }

  const showSkeleton = isLoading && events.length === 0;
  const showEmpty = !isLoading && events.length === 0;

  return (
    <div className="bg-white border-[3px] border-candy-ink rounded-3xl shadow-[6px_6px_0_0_#2B2D42] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-candy-cloud">
              <th className={headClass}>{t("table.time")}</th>
              <th className={headClass}>{t("table.actor")}</th>
              <th className={headClass}>{t("table.action")}</th>
              <th className={headClass}>{t("table.target")}</th>
              <th className={headClass}>{t("table.metadata")}</th>
            </tr>
          </thead>
          <tbody
            aria-busy={isFetching}
            className={isFetching && !showSkeleton ? "opacity-60" : ""}
          >
            {showSkeleton &&
              skeletonRows.map((i) => (
                <tr key={`skeleton-${i}`}>
                  {Array.from({ length: 5 }).map((_, c) => (
                    <td key={c} className={cellClass}>
                      <div className="h-4 rounded bg-candy-ink/10 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}

            {!showSkeleton &&
              events.map((event) => (
                <tr key={event.id} className="hover:bg-candy-cloud/40">
                  <td className={`${cellClass} whitespace-nowrap`}>
                    {formatTimestamp(event.createdAt, locale)}
                  </td>
                  <td className={cellClass}>
                    {event.adminUserId ? (
                      <span className="font-black break-all">
                        {event.adminUserId}
                      </span>
                    ) : (
                      <span className="text-candy-ink/40">
                        {t("table.systemActor")}
                      </span>
                    )}
                  </td>
                  <td className={cellClass}>
                    <EventTypeBadge eventType={event.eventType} />
                  </td>
                  <td className={`${cellClass} break-all`}>
                    <TargetCell event={event} />
                  </td>
                  <td className={cellClass}>
                    <PayloadCell payload={event.payload} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showEmpty && (
        <div className="p-10 text-center space-y-3">
          <Inbox className="w-12 h-12 text-candy-ink/30 mx-auto" />
          <h3 className="font-display font-black text-base uppercase text-candy-ink">
            {t("empty.title")}
          </h3>
          <p className="font-mono text-xs font-bold text-candy-ink/60 max-w-md mx-auto">
            {t("empty.description")}
          </p>
        </div>
      )}
    </div>
  );
}
