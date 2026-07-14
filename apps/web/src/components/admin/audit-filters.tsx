"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Filter, RotateCcw, Search } from "lucide-react";
import { KNOWN_AUDIT_EVENT_TYPES } from "@arena/shared";
import type { AuditFilters } from "@/hooks/use-audit-events";

interface AuditFiltersProps {
  /** Currently-applied filters (source of truth from the hook). */
  value: AuditFilters;
  /** Apply a new filter set (triggers a refetch, resets to page 0). */
  onApply: (filters: AuditFilters) => void;
  /** Clear all filters back to empty. */
  onReset: () => void;
  /** Disable inputs while a request is in flight. */
  disabled?: boolean;
}

const inputClass =
  "w-full h-11 px-3 bg-candy-cloud border-[3px] border-candy-ink rounded-2xl font-mono text-sm font-bold text-candy-ink shadow-[2.5px_2.5px_0_0_#000] outline-none focus:ring-2 focus:ring-candy-ink focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

const labelClass =
  "block text-[11px] font-mono font-black uppercase text-candy-ink/80 mb-1.5";

/**
 * Filter bar for the audit panel. Holds a local draft so the
 * operator can compose several filters before triggering a single
 * refetch on "Apply" — fields the backend DTO supports (event type,
 * room id, admin user id, optional createdAt range).
 */
export function AuditFilters({
  value,
  onApply,
  onReset,
  disabled,
}: AuditFiltersProps) {
  const t = useTranslations("admin.audit");
  const [draft, setDraft] = useState<AuditFilters>(value);

  // Keep the draft in sync if the applied filters change elsewhere
  // (e.g. a reset triggered from the empty state).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply({
      eventType: draft.eventType.trim(),
      roomId: draft.roomId.trim(),
      adminUserId: draft.adminUserId.trim(),
      createdAfter: draft.createdAfter.trim(),
      createdBefore: draft.createdBefore.trim(),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border-[3px] border-candy-ink rounded-3xl p-5 md:p-6 shadow-[6px_6px_0_0_#2B2D42] space-y-5"
    >
      <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider flex items-center gap-2">
        <Filter className="w-4 h-4 text-candy-blue" />
        {t("filters.title")}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Event type */}
        <div>
          <label htmlFor="audit-filter-event-type" className={labelClass}>
            {t("filters.eventType")}
          </label>
          <select
            id="audit-filter-event-type"
            value={draft.eventType}
            disabled={disabled}
            onChange={(e) =>
              setDraft((d) => ({ ...d, eventType: e.target.value }))
            }
            className={inputClass}
          >
            <option value="">{t("filters.allEvents")}</option>
            {KNOWN_AUDIT_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`eventTypes.${type}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Room ID */}
        <div>
          <label htmlFor="audit-filter-room-id" className={labelClass}>
            {t("filters.roomId")}
          </label>
          <input
            id="audit-filter-room-id"
            type="text"
            value={draft.roomId}
            disabled={disabled}
            placeholder={t("filters.roomIdPlaceholder")}
            onChange={(e) =>
              setDraft((d) => ({ ...d, roomId: e.target.value }))
            }
            className={inputClass}
          />
        </div>

        {/* Admin user ID */}
        <div>
          <label htmlFor="audit-filter-admin-id" className={labelClass}>
            {t("filters.adminUserId")}
          </label>
          <input
            id="audit-filter-admin-id"
            type="text"
            value={draft.adminUserId}
            disabled={disabled}
            placeholder={t("filters.adminUserIdPlaceholder")}
            onChange={(e) =>
              setDraft((d) => ({ ...d, adminUserId: e.target.value }))
            }
            className={inputClass}
          />
        </div>

        {/* createdAfter */}
        <div>
          <label htmlFor="audit-filter-created-after" className={labelClass}>
            {t("filters.createdAfter")}
          </label>
          <input
            id="audit-filter-created-after"
            type="datetime-local"
            step="1"
            value={draft.createdAfter}
            disabled={disabled}
            onChange={(e) =>
              setDraft((d) => ({ ...d, createdAfter: e.target.value }))
            }
            className={inputClass}
          />
        </div>

        {/* createdBefore */}
        <div>
          <label htmlFor="audit-filter-created-before" className={labelClass}>
            {t("filters.createdBefore")}
          </label>
          <input
            id="audit-filter-created-before"
            type="datetime-local"
            step="1"
            value={draft.createdBefore}
            disabled={disabled}
            onChange={(e) =>
              setDraft((d) => ({ ...d, createdBefore: e.target.value }))
            }
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="flex items-center justify-center h-11 px-5 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          <Search className="w-4 h-4 mr-2 shrink-0" />
          {t("filters.apply")}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          className="flex items-center justify-center h-11 px-5 bg-white border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-candy-cloud active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          <RotateCcw className="w-4 h-4 mr-2 shrink-0" />
          {t("filters.reset")}
        </button>
      </div>
    </form>
  );
}
