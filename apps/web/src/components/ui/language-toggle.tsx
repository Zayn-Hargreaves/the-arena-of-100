"use client";

import React, { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { GlobeSvg } from "@/components/home/home-icons";
import { cn } from "@/lib/utils";

interface LanguageToggleProps {
  className?: string;
  showIcon?: boolean;
}

export function LanguageToggle({
  className,
  showIcon = true,
}: Readonly<LanguageToggleProps>) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleSwitch = (newLocale: "vi" | "en") => {
    if (newLocale === locale || isPending) return;
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn(
        "inline-flex items-center gap-0.5 sm:gap-1 bg-white border-2 sm:border-3 border-candy-ink p-0.5 sm:p-1 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] sm:shadow-[3px_3px_0_0_#2B2D42] select-none shrink-0",
        className,
      )}
    >
      {showIcon && (
        <span
          className="hidden md:inline-flex pl-1.5 pr-0.5 text-candy-ink"
          aria-hidden="true"
        >
          <GlobeSvg size={16} />
        </span>
      )}
      <button
        type="button"
        disabled={isPending}
        onClick={() => handleSwitch("vi")}
        aria-pressed={locale === "vi"}
        aria-label={t("vietnamese")}
        className={cn(
          "px-1.5 sm:px-2.5 py-0.5 sm:py-1 text-[10px] sm:text-xs font-display font-black rounded-xl uppercase transition-all cursor-pointer disabled:opacity-60",
          locale === "vi"
            ? "bg-candy-mint text-white border-2 border-candy-ink shadow-[1px_1px_0_0_#2B2D42]"
            : "text-candy-ink/60 hover:text-candy-ink hover:bg-candy-cloud border-2 border-transparent",
        )}
      >
        VI
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => handleSwitch("en")}
        aria-pressed={locale === "en"}
        aria-label={t("english")}
        className={cn(
          "px-1.5 sm:px-2.5 py-0.5 sm:py-1 text-[10px] sm:text-xs font-display font-black rounded-xl uppercase transition-all cursor-pointer disabled:opacity-60",
          locale === "en"
            ? "bg-candy-pink text-white border-2 border-candy-ink shadow-[1px_1px_0_0_#2B2D42]"
            : "text-candy-ink/60 hover:text-candy-ink hover:bg-candy-cloud border-2 border-transparent",
        )}
      >
        EN
      </button>
    </div>
  );
}
