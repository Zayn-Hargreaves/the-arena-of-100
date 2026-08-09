"use client";

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DailyNicknameGate } from "./daily-nickname-gate";

const storeState: {
  accessToken: string | null;
  username: string | null;
  authenticate: (nickname: string) => Promise<void>;
} = {
  accessToken: null,
  username: null,
  authenticate: vi.fn(),
};

function mockUseSocketStore<T>(
  selector?: (s: typeof storeState) => T,
): T | typeof storeState {
  return selector ? selector(storeState) : storeState;
}

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: mockUseSocketStore,
}));

const baseProps = {
  title: "Choose nickname",
  description: "We need a name.",
  ctaLabel: "Continue",
  cancelLabel: "Cancel",
} as const;

describe("DailyNicknameGate", () => {
  beforeEach(() => {
    storeState.accessToken = null;
    storeState.username = null;
    storeState.authenticate = vi.fn();
  });

  it("renders the error copy when the nickname is empty on submit", async () => {
    render(
      <DailyNicknameGate
        open
        onOpenChange={() => undefined}
        onAuthenticated={() => undefined}
        {...baseProps}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    // The submit button is disabled while the trimmed nickname is empty
    // — submit the form directly via Enter to exercise the validation path.
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(screen.getByText("gate.errors.required")).toBeInTheDocument(),
    );
    expect(storeState.authenticate).not.toHaveBeenCalled();
  });

  it("calls onOpenChange(false) before onAuthenticated on successful submit", async () => {
    const callOrder: string[] = [];
    storeState.authenticate = vi.fn(async () => {
      callOrder.push("authenticate");
    });
    const onOpenChange = vi.fn((next: boolean) => {
      callOrder.push(`onOpenChange(${next})`);
    });
    const onAuthenticated = vi.fn(async () => {
      callOrder.push("onAuthenticated");
    });

    render(
      <DailyNicknameGate
        open
        onOpenChange={onOpenChange}
        onAuthenticated={onAuthenticated}
        {...baseProps}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  Alice  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(storeState.authenticate).toHaveBeenCalledWith("Alice");
    // The modal must close BEFORE the parent's post-auth callback runs.
    // Otherwise the parent receives a callback while the dialog is still
    // open, which triggers the wrong UI state.
    expect(callOrder).toEqual([
      "authenticate",
      "onOpenChange(false)",
      "onAuthenticated",
    ]);
  });

  it("surfaces the error and keeps the modal open when authenticate rejects", async () => {
    storeState.authenticate = vi.fn(async () => {
      throw new Error("boom");
    });
    const onOpenChange = vi.fn();
    const onAuthenticated = vi.fn();

    render(
      <DailyNicknameGate
        open
        onOpenChange={onOpenChange}
        onAuthenticated={onAuthenticated}
        {...baseProps}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("routes an onAuthenticated rejection to onAuthenticatedError, not the modal", async () => {
    storeState.authenticate = vi.fn(async () => undefined);
    const postAuthFailure = new Error("submit blew up");
    const onAuthenticated = vi.fn(async () => {
      throw postAuthFailure;
    });
    const onAuthenticatedError = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <DailyNicknameGate
        open
        onOpenChange={onOpenChange}
        onAuthenticated={onAuthenticated}
        onAuthenticatedError={onAuthenticatedError}
        {...baseProps}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(onAuthenticatedError).toHaveBeenCalledWith(postAuthFailure),
    );
    // Auth itself succeeded, so the gate still closes...
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // ...and the post-auth failure must NOT appear in this modal — the
    // parent owns that error surface.
    expect(screen.queryByText("submit blew up")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("logs instead of rejecting when onAuthenticated fails and no error handler is given", async () => {
    storeState.authenticate = vi.fn(async () => undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onAuthenticated = vi.fn(async () => {
      throw new Error("unhandled path");
    });

    render(
      <DailyNicknameGate
        open
        onOpenChange={() => undefined}
        onAuthenticated={onAuthenticated}
        {...baseProps}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // The rejection is swallowed into console.error rather than escaping
    // through the form's `void submit()` as an unhandled rejection.
    await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("falls back to the translated copy when error is not an Error instance", async () => {
    storeState.authenticate = vi.fn(async () => {
      throw "string-error";
    });

    render(
      <DailyNicknameGate
        open
        onOpenChange={() => undefined}
        onAuthenticated={() => undefined}
        {...baseProps}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByText("gate.errors.authFailed")).toBeInTheDocument(),
    );
  });

  it("clears the error and resets state when the gate is closed and reopened", async () => {
    // Drive a real failure so the component reaches the catch branch
    // and `error` is populated. Then close + reopen to exercise the
    // cleanup effect (`if (!open) { setError(null); setSubmitting(false) }`).
    storeState.authenticate = vi.fn(async () => {
      throw new Error("boom");
    });

    const { rerender } = render(
      <DailyNicknameGate
        open
        onOpenChange={() => undefined}
        onAuthenticated={() => undefined}
        {...baseProps}
      />,
    );

    // Enter a nickname and submit — auth will reject, error surfaces.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(storeState.authenticate).toHaveBeenCalledTimes(1);

    // Close the gate. The cleanup effect must run synchronously after
    // the next render commits with `open={false}`.
    rerender(
      <DailyNicknameGate
        open={false}
        onOpenChange={() => undefined}
        onAuthenticated={() => undefined}
        {...baseProps}
      />,
    );

    // Reopen. The error state must be cleared — observable by the
    // absence of the error text in the reopened gate. (Radix Dialog
    // keeps the content mounted across open/close cycles, so the
    // underlying `nickname` state persists — that's intentional and
    // not what this test is checking.)
    rerender(
      <DailyNicknameGate
        open
        onOpenChange={() => undefined}
        onAuthenticated={() => undefined}
        {...baseProps}
      />,
    );

    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    // Reopening alone must not retrigger auth; only the user can.
    expect(storeState.authenticate).toHaveBeenCalledTimes(1);
  });
});
