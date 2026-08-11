"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { type CardId, getCardDefinition } from "@arena/shared";

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
  // For self-only Defensive/THU cards the picker is bypassed
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
// For self-only Defensive/THU cards, the modal is bypassed
// and the card plays immediately. For Offensive/CONG cards
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
  const isSelfOnly = def.classId === "THU";
  const isAoe =
    def.classId === "CONG" &&
    (def.effectTemplate as { targetCount?: number }).targetCount !== 1 &&
    (def.effectTemplate as { targetCount?: number }).targetCount !== undefined;

  // Auto-bypass: fire-and-forget. Both branches guard with a ref
  // keyed by `offerSeqNo` so the effect runs at most once per
  // offer — the parent can re-render with new `targets` / `onPick`
  // references (e.g. after a roster update) without re-firing.
  // A later offer carrying the same `cardId` starts a fresh
  // session and triggers `onPick` again.
  //
  // Self-only Defensive/THU cards: the dialog is bypassed and
  // `onPick` is invoked with no target so the wire payload
  // omits `targetPlayerId` (server rejects any target on a
  // self-only play). Full selection, timing, and validation
  // remain the server's responsibility.
  //
  // AOE Offensive/CONG cards: the client sends only the initial
  // eligible target; full AOE roster expansion is the server's
  // responsibility.
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

  if (isSelfOnly) {
    return null;
  }

  if (isAoe) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("select")}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/40",
        className,
      )}
    >
      <div className="rounded-lg border-2 border-candy-ink bg-white p-6 shadow-[6px_6px_0_0_#2B2D42]">
        <h2 className="mb-4 text-lg font-bold">{t("select")}</h2>
        <ul className="space-y-2">
          {targets.map((target) => (
            <li key={target.playerId}>
              <button
                type="button"
                onClick={() => onPick(target.playerId)}
                className="w-full rounded border-2 border-candy-ink px-3 py-2 text-left hover:bg-candy-pink/20"
              >
                {target.name}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded border-2 border-candy-ink bg-candy-cloud px-3 py-2"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
