"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { useSocketStore } from "@/stores/socket-store";

/** Stable id so the input can reference the error via aria-describedby. */
const NICKNAME_ERROR_ID = "daily-nickname-error";

interface DailyNicknameGateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after guest auth resolves so the parent can submit. */
  onAuthenticated: () => void | Promise<void>;
  /**
   * Called when `onAuthenticated` rejects. Post-auth failures belong to
   * the parent's error surface, not this modal (which is already closed
   * by then), so they are routed here instead of being displayed inline.
   * When omitted the rejection is logged rather than escaping as an
   * unhandled promise rejection.
   */
  onAuthenticatedError?: (error: unknown) => void;
  title: string;
  description: string;
  ctaLabel: string;
  cancelLabel: string;
}

export function DailyNicknameGate({
  open,
  onOpenChange,
  onAuthenticated,
  onAuthenticatedError,
  title,
  description,
  ctaLabel,
  cancelLabel,
}: Readonly<DailyNicknameGateProps>) {
  const t = useTranslations("daily");
  const authenticate = useSocketStore((state) => state.authenticate);
  const username = useSocketStore((state) => state.username);
  const [nickname, setNickname] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError(t("gate.errors.required"));
      return;
    }
    setSubmitting(true);
    setError(null);

    // Only authentication failures belong to this modal — they are what
    // the user can act on here (bad nickname, auth service down). The
    // parent's post-auth work is NOT in this scope: swallowing its
    // errors would hide them from the caller, which owns its own error
    // surface (e.g. the page's submitError card).
    try {
      await authenticate(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("gate.errors.authFailed"));
      setSubmitting(false);
      return;
    }

    // Close the modal before the parent reacts so the consumer never
    // sees an open dialog while it kicks off its post-auth work
    // (e.g. submitting answers).
    onOpenChange(false);

    // The modal is already closed, so a post-auth failure has no inline
    // surface here — it belongs to the parent. Catch it either way: the
    // form handler calls `void submit()`, so an escaping rejection would
    // become an unhandled promise rejection.
    try {
      await onAuthenticated();
    } catch (e) {
      if (onAuthenticatedError) {
        onAuthenticatedError(e);
      } else {
        console.error("DailyNicknameGate: onAuthenticated rejected", e);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      closeLabel={cancelLabel}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block space-y-1">
          <span className="font-mono text-[10px] font-black uppercase tracking-wider text-candy-ink/70">
            {t("gate.nicknameLabel")}
          </span>
          <input
            type="text"
            value={nickname}
            disabled={submitting}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={username ?? t("gate.playerPlaceholder")}
            maxLength={32}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? NICKNAME_ERROR_ID : undefined}
            className="w-full border-[2px] border-candy-ink rounded-xl px-3 py-2 font-body text-sm text-candy-ink bg-white focus:outline-none focus:ring-2 focus:ring-candy-yellow disabled:opacity-60"
            autoFocus
          />
        </label>
        {error ? (
          <p
            id={NICKNAME_ERROR_ID}
            role="alert"
            className="font-body text-xs text-candy-red font-semibold"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="min-h-11 px-4 py-2 rounded-xl bg-white text-candy-ink border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={submitting || !nickname.trim()}
            className="min-h-11 px-4 py-2 rounded-xl bg-candy-pink text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] disabled:opacity-60"
          >
            {ctaLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
