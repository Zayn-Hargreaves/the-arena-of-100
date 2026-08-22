"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { type CardId, getCardDefinition } from "@arena/shared";
import { CardGlyph, getGlyphForCardId } from "./card-glyphs";
import { MiniGlyph } from "@/components/ui/mini-glyph";

export interface CardTargetPickerProps {
  cardId: CardId;
  // Identifier for the offer / selection session this picker
  // belongs to. The dedup ref keys on this value (not on
  // `cardId`) so the same card ID appearing in a fresh offer
  // still invokes `onPick` and renders correctly. The server
  // uses `payload.offerSeqNo` ↔ `CARD_OFFER.seqNo` as the
  // authoritative correlation (see spec §3.3 "cardId +
  // offerSeqNo correlation").
  offerSeqNo: number;
  targets: ReadonlyArray<{ playerId: string; name: string }>;
  // For self-only Defensive/DEFENSE cards the picker is bypassed
  // and `onPick` is invoked with NO argument so the emitted
  // command omits `targetPlayerId` (server validator rejects any
  // `targetPlayerId` on a self-only play). For all other cards
  // `onPick` receives the chosen target's playerId.
  onPick: (targetPlayerId?: string) => void;
  onCancel: () => void;
  className?: string;
}

// `CardTargetPicker` — modal-overlay that pauses the player's
// own timer for ≤2s (UI-only, server `answerDeadline` is
// unaffected) per spec §4.3 "Target picker is UI-only self-pause".
//
// For self-only Defensive/DEFENSE cards, the modal is bypassed
// and the card plays immediately. For Offensive/ATTACK cards
// with `targetCount > 1`
// (AOE), the picker auto-selects the eligible roster without
// prompting the player.
export function CardTargetPicker({
  cardId,
  offerSeqNo,
  targets,
  onPick,
  onCancel,
  className,
}: CardTargetPickerProps) {
  const t = useTranslations("Cards");
  const def = getCardDefinition(cardId);
  const isSelfOnly = def.classId === "DEFENSE";
  const isAoe =
    def.classId === "ATTACK" &&
    (def.effectTemplate as { targetCount?: number }).targetCount !== 1 &&
    (def.effectTemplate as { targetCount?: number }).targetCount !== undefined;

  const firedRef = React.useRef<Set<number>>(new Set());
  React.useEffect(() => {
    if (firedRef.current.has(offerSeqNo)) return;
    if (isSelfOnly) {
      firedRef.current.add(offerSeqNo);
      onPick();
      return;
    }
    if (!isAoe) return;
    if (targets.length === 0) return;
    firedRef.current.add(offerSeqNo);
    onPick(targets[0]!.playerId);
  }, [isSelfOnly, isAoe, cardId, offerSeqNo, targets, onPick]);

  const [searchQuery, setSearchQuery] = React.useState("");
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElement = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (isSelfOnly || isAoe) return;
    previousActiveElement.current =
      document.activeElement as HTMLElement | null;
    if (dialogRef.current) {
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length > 0) {
        focusable[0]?.focus();
      } else {
        dialogRef.current.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (
          document.activeElement === lastElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (
        previousActiveElement.current &&
        typeof previousActiveElement.current.focus === "function"
      ) {
        previousActiveElement.current.focus();
      }
    };
  }, [isSelfOnly, isAoe, onCancel]);

  const filteredTargets = React.useMemo(() => {
    if (!searchQuery.trim()) return targets;
    const q = searchQuery.toLowerCase().trim();
    return targets.filter((t) => t.name.toLowerCase().includes(q));
  }, [targets, searchQuery]);

  if (isSelfOnly) {
    return null;
  }

  if (isAoe) {
    return null;
  }

  const handleRandomPick = () => {
    if (targets.length === 0) return;
    const randomTarget = targets[Math.floor(Math.random() * targets.length)];
    if (randomTarget) {
      onPick(randomTarget.playerId);
    }
  };

  const cardName = t.has(`byId.${cardId}.name`)
    ? t(`byId.${cardId}.name`)
    : def.name;

  const cardDesc = t.has(`byId.${cardId}.description`)
    ? t(`byId.${cardId}.description`)
    : def.description;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={t("select")}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-candy-ink/60 backdrop-blur-sm p-4 animate-fade-in outline-none",
        className,
      )}
    >
      <div className="w-full max-w-lg rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] overflow-hidden flex flex-col max-h-[85vh] animate-scale-up">
        {/* Header with Card Info */}
        <div className="bg-candy-yellow border-b-[3px] border-candy-ink p-4 sm:p-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center shrink-0 text-candy-ink">
              <CardGlyph variant={getGlyphForCardId(cardId)} size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-black text-sm sm:text-base text-candy-ink uppercase tracking-wider">
                  {cardName}
                </span>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border-[1.5px] border-candy-ink bg-candy-pink/30 text-candy-ink">
                  {def.tier}
                </span>
              </div>
              <p className="text-xs text-candy-ink/75 font-medium mt-0.5 line-clamp-1">
                {cardDesc}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 rounded-xl bg-white hover:bg-candy-red hover:text-white border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center font-black text-sm shrink-0 transition-colors"
            aria-label={t("cancel")}
          >
            <MiniGlyph variant="close" className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>

        {/* Action Bar: Quick Random Target + Search */}
        <div className="p-4 bg-candy-cloud/40 border-b-2 border-candy-ink/15 space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRandomPick}
              className="flex-1 flex items-center justify-center gap-2 bg-candy-orange hover:bg-candy-orange/90 text-white font-display font-black text-xs sm:text-sm py-2.5 px-4 rounded-2xl border-2 border-candy-ink shadow-[3px_3px_0_0_#2B2D42] active:translate-y-0.5 active:shadow-[1px_1px_0_0_#2B2D42] transition-all"
            >
              <MiniGlyph
                variant="target"
                className="w-4 h-4 text-white stroke-[2.5]"
              />
              <span>{t("picker.randomTarget")}</span>
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              aria-label={t("picker.searchLabel")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("picker.searchPlaceholder", {
                count: targets.length,
              })}
              className="w-full bg-white border-2 border-candy-ink rounded-xl px-3.5 py-2 text-xs sm:text-sm text-candy-ink placeholder:text-candy-ink/40 font-medium focus:outline-none focus:ring-2 focus:ring-candy-pink/50 shadow-[2px_2px_0_0_#2B2D42]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-candy-ink/50 hover:text-candy-ink text-xs font-bold"
                aria-label={t("picker.clearSearch")}
              >
                <MiniGlyph variant="close" className="w-3 h-3 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Target Grid (2 columns) */}
        <div className="p-4 overflow-y-auto flex-1 max-h-[300px]">
          {filteredTargets.length === 0 ? (
            <div className="text-center py-8 text-candy-ink/50 text-xs font-bold">
              {t("picker.noMatches")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredTargets.map((target) => (
                <button
                  key={target.playerId}
                  type="button"
                  aria-label={target.name}
                  onClick={() => onPick(target.playerId)}
                  className="flex items-center gap-2.5 w-full rounded-2xl border-2 border-candy-ink bg-white p-2.5 text-left hover:bg-candy-yellow/40 hover:border-candy-ink hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-0 active:shadow-none shadow-[2px_2px_0_0_#2B2D42] transition-all group"
                >
                  <div
                    aria-hidden="true"
                    className="w-8 h-8 rounded-xl bg-candy-cloud border-[1.5px] border-candy-ink flex items-center justify-center font-bold text-xs shrink-0 group-hover:bg-candy-pink/30 group-hover:rotate-3 transition-transform"
                  >
                    {target.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-display font-bold text-xs sm:text-sm text-candy-ink truncate flex-1">
                    {target.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-candy-ink/40 group-hover:text-candy-ink group-hover:translate-x-0.5 transition-all text-xs"
                  >
                    <MiniGlyph
                      variant="arrowRight"
                      className="w-3.5 h-3.5 stroke-[2.5]"
                    />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-candy-cloud/30 border-t-2 border-candy-ink/20 flex items-center justify-between gap-3">
          <span className="text-[11px] text-candy-ink/60 font-medium">
            {t("picker.prompt")}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border-2 border-candy-ink bg-white hover:bg-candy-cloud px-4 py-1.5 text-xs font-bold text-candy-ink shadow-[2px_2px_0_0_#2B2D42] transition-colors"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
