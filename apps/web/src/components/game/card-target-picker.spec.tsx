// ============================================================
// `CardTargetPicker` tests — bypass behavior (spec §4.3
// "Target picker is UI-only self-pause"; card-validator
// "Defensive/THU cards are self-only").
//
// Verifies:
//   - self-only Defensive/THU cards bypass the dialog and
//     invoke `onPick` with no target (so the wire payload
//     omits `targetPlayerId`)
//   - AOE Offensive/CONG cards auto-select the first eligible
//     target without rendering the dialog
//   - single-target CONG cards still render the dialog and
//     invoke `onPick(target.playerId)` on click
//   - the dedup ref is keyed by `offerSeqNo` (the same
//     `cardId` arriving in a different offer still fires)
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import React from "react";

import { CardTargetPicker } from "./card-target-picker";

const TARGETS = [
  { playerId: "p1", name: "P1" },
  { playerId: "p2", name: "P2" },
] as const;

describe("CardTargetPicker", () => {
  it("bypasses the dialog for self-only Defensive/THU cards and invokes onPick with no target", async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(
      <CardTargetPicker
        cardId="TN-1"
        offerSeqNo={1}
        targets={TARGETS}
        onPick={onPick}
        onCancel={onCancel}
      />,
    );
    expect(
      screen.queryByRole("dialog", { name: "select" }),
    ).not.toBeInTheDocument();
    // The effect that fires `onPick` runs during the commit
    // phase; let any pending microtasks flush.
    await Promise.resolve();
    expect(onPick).toHaveBeenCalledWith();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("auto-picks the first eligible target for AOE Offensive/CONG cards", async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(
      <CardTargetPicker
        cardId="CB-8"
        offerSeqNo={2}
        targets={TARGETS}
        onPick={onPick}
        onCancel={onCancel}
      />,
    );
    expect(
      screen.queryByRole("dialog", { name: "select" }),
    ).not.toBeInTheDocument();
    await Promise.resolve();
    expect(onPick).toHaveBeenCalledWith("p1");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("renders the dialog for single-target CONG cards and picks on click", async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(
      <CardTargetPicker
        cardId="CB-1"
        offerSeqNo={3}
        targets={TARGETS}
        onPick={onPick}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "select" });
    expect(dialog).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "P2" }));
    expect(onPick).toHaveBeenCalledWith("p2");
  });

  it("fires onPick again when the same cardId arrives in a new offerSeqNo", async () => {
    // Re-rendering with a fresh offerSeqNo clears the dedup gate
    // for the same cardId. This is the realistic flow: a player
    // picks the same card template from a later offer. Keeping
    // the same mounted instance preserves the dedup ref, so the
    // gate clears because `offerSeqNo` (not `cardId`) is the key.
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <CardTargetPicker
        cardId="TN-1"
        offerSeqNo={10}
        targets={TARGETS}
        onPick={onPick}
        onCancel={onCancel}
      />,
    );
    await Promise.resolve();
    expect(onPick).toHaveBeenCalledTimes(1);
    rerender(
      <CardTargetPicker
        cardId="TN-1"
        offerSeqNo={11}
        targets={TARGETS}
        onPick={onPick}
        onCancel={onCancel}
      />,
    );
    await Promise.resolve();
    expect(onPick).toHaveBeenCalledTimes(2);
  });
});
