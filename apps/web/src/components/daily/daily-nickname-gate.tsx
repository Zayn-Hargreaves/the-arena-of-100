"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { useSocketStore } from "@/stores/socket-store";

interface DailyNicknameGateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after guest auth resolves so the parent can submit. */
  onAuthenticated: () => void | Promise<void>;
  title: string;
  description: string;
  ctaLabel: string;
  cancelLabel: string;
}

export function DailyNicknameGate({
  open,
  onOpenChange,
  onAuthenticated,
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
    try {
      await authenticate(trimmed);
      // Close the modal before the parent reacts so the consumer
      // never sees an open dialog while it kicks off its post-auth
      // work (e.g. submitting answers). The parent's onAuthenticated
      // callback still runs with the auth result.
      onOpenChange(false);
      await onAuthenticated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("gate.errors.authFailed"));
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
            className="w-full border-[2px] border-candy-ink rounded-xl px-3 py-2 font-body text-sm text-candy-ink bg-white focus:outline-none focus:ring-2 focus:ring-candy-yellow disabled:opacity-60"
            autoFocus
          />
        </label>
        {error ? (
          <p className="font-body text-xs text-candy-red font-semibold">
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
