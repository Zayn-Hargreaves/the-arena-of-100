import { AppShellLayout } from "@/components/ui/app-shell-layout";
import type { ResultLoadState as LoadState } from "@/hooks/use-match-results";
import { useTranslations } from "next-intl";

export function ResultLoadStateView({
  state,
  onHome,
  onRetry,
}: {
  state: Exclude<LoadState, "ready">;
  onHome: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("Result.loadState");

  if (state === "loading") {
    return (
      <AppShellLayout>
        <div className="max-w-4xl mx-auto w-full pt-8 text-center font-display font-black text-candy-ink uppercase">
          {t("loading")}
        </div>
      </AppShellLayout>
    );
  }

  const content = {
    not_found: [t("notFound.message"), t("notFound.action"), "bg-candy-blue"],
    unauthorized: [
      t("unauthorized.message"),
      t("unauthorized.action"),
      "bg-candy-pink",
    ],
    network_error: [
      t("networkError.message"),
      t("networkError.action"),
      "bg-candy-yellow",
    ],
  } as const;
  const [message, action, background] = content[state];

  return (
    <AppShellLayout>
      <div className="max-w-4xl mx-auto w-full pt-8 text-center space-y-4">
        <p className="font-display font-black text-candy-ink uppercase">
          {message}
        </p>
        <button
          type="button"
          onClick={state === "network_error" ? onRetry : onHome}
          className={`h-11 px-6 ${background} text-candy-ink border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase`}
        >
          {action}
        </button>
      </div>
    </AppShellLayout>
  );
}
