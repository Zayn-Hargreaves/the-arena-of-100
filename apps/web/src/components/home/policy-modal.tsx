"use client";

import React, { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  ScrollSvg,
  ShieldCheckSvg,
  CloseSvg,
  SparkleSmallSvg,
} from "./home-icons";
import { cn } from "@/lib/utils";

export type PolicyType = "terms" | "antiCheat";

interface PolicyModalProps {
  isOpen: boolean;
  type: PolicyType;
  onClose: () => void;
  onSelectType?: (type: PolicyType) => void;
}

export function PolicyModal({
  isOpen,
  type,
  onClose,
  onSelectType,
}: Readonly<PolicyModalProps>) {
  const t = useTranslations("policies");
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus and Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    if (typeof document !== "undefined") {
      previouslyFocusedRef.current =
        (document.activeElement as HTMLElement | null) ?? null;
    }

    if (dialogRef.current) {
      const focusable = dialogRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable) {
        focusable.focus();
      } else {
        dialogRef.current.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;

        const firstElement = focusables[0]!;
        const lastElement = focusables[focusables.length - 1]!;

        if (e.shiftKey) {
          if (
            document.activeElement === firstElement ||
            document.activeElement === dialogRef.current
          ) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const prevElement = previouslyFocusedRef.current;
      if (
        prevElement &&
        typeof prevElement.focus === "function" &&
        typeof document !== "undefined" &&
        document.contains(prevElement)
      ) {
        prevElement.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isTerms = type === "terms";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-modal-title"
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-white border-4 border-candy-ink rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_0_#2B2D42] overflow-hidden outline-none max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Top Header & Tab Toggle */}
        <div className="flex justify-between items-start gap-4 mb-4 shrink-0">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSelectType?.("terms")}
              className={cn(
                "inline-flex items-center gap-2 font-display text-xs px-3.5 py-2 border-3 border-candy-ink rounded-2xl transition-all cursor-pointer",
                isTerms
                  ? "bg-candy-yellow text-candy-ink font-black shadow-[3px_3px_0_0_#2B2D42] -translate-y-0.5"
                  : "bg-candy-cloud hover:bg-white text-candy-ink/70 font-bold",
              )}
            >
              <ScrollSvg size={18} className="text-candy-ink" />
              <span>{t("termsTitle")}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectType?.("antiCheat")}
              className={cn(
                "inline-flex items-center gap-2 font-display text-xs px-3.5 py-2 border-3 border-candy-ink rounded-2xl transition-all cursor-pointer",
                !isTerms
                  ? "bg-candy-mint text-white font-black shadow-[3px_3px_0_0_#2B2D42] -translate-y-0.5"
                  : "bg-candy-cloud hover:bg-white text-candy-ink/70 font-bold",
              )}
            >
              <ShieldCheckSvg size={18} className="text-candy-ink" />
              <span>{t("antiCheatTitle")}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="p-2 rounded-2xl border-3 border-candy-ink bg-candy-cloud hover:bg-candy-red hover:text-white transition-colors cursor-pointer shrink-0 shadow-[2px_2px_0_0_#2B2D42]"
          >
            <CloseSvg size={18} />
          </button>
        </div>

        {/* Title & Subtitle */}
        <div className="mb-4 shrink-0 border-b-3 border-dashed border-candy-ink/20 pb-3">
          <h2
            id="policy-modal-title"
            className="font-display font-black text-2xl md:text-3xl text-candy-ink uppercase tracking-tight flex items-center gap-2"
          >
            {isTerms ? (
              <>
                <ScrollSvg size={28} className="text-candy-orange" />
                <span>{t("termsTitle")}</span>
              </>
            ) : (
              <>
                <ShieldCheckSvg size={28} className="text-candy-mint" />
                <span>{t("antiCheatTitle")}</span>
              </>
            )}
          </h2>
          <p className="font-body text-xs md:text-sm text-candy-ink/75 font-semibold mt-1">
            {isTerms ? t("termsSubtitle") : t("antiCheatSubtitle")}
          </p>
        </div>

        {/* Scrollable Policy Content */}
        <div className="overflow-y-auto space-y-4 pr-1 flex-1 text-candy-ink">
          {isTerms ? (
            <>
              {/* Section 1 */}
              <div className="p-4 rounded-2xl bg-[#FFF8E7] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("terms.section1Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("terms.section1Desc")}
                </p>
              </div>

              {/* Section 2 */}
              <div className="p-4 rounded-2xl bg-white border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("terms.section2Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("terms.section2Desc")}
                </p>
              </div>

              {/* Section 3 */}
              <div className="p-4 rounded-2xl bg-white border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("terms.section3Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("terms.section3Desc")}
                </p>
              </div>

              {/* Section 4 */}
              <div className="p-4 rounded-2xl bg-[#FFF0F5] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("terms.section4Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("terms.section4Desc")}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* AntiCheat Section 1 */}
              <div className="p-4 rounded-2xl bg-[#E0F2FE] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("antiCheat.section1Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("antiCheat.section1Desc")}
                </p>
              </div>

              {/* AntiCheat Section 2 */}
              <div className="p-4 rounded-2xl bg-white border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("antiCheat.section2Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("antiCheat.section2Desc")}
                </p>
              </div>

              {/* AntiCheat Section 3 */}
              <div className="p-4 rounded-2xl bg-[#FFF8E7] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("antiCheat.section3Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("antiCheat.section3Desc")}
                </p>
              </div>

              {/* AntiCheat Section 4 */}
              <div className="p-4 rounded-2xl bg-[#FFE5EC] border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <h3 className="font-display font-black text-sm uppercase text-candy-ink flex items-center gap-1.5 mb-1.5">
                  <SparkleSmallSvg size={16} />
                  {t("antiCheat.section4Title")}
                </h3>
                <p className="font-body text-xs leading-relaxed text-candy-ink/85 font-medium">
                  {t("antiCheat.section4Desc")}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer Action Button */}
        <div className="mt-5 pt-3 border-t-3 border-candy-ink shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3.5 bg-candy-mint hover:bg-candy-mint/90 text-white border-3 border-candy-ink rounded-2xl font-display font-black text-sm uppercase shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42] transition-all cursor-pointer"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
