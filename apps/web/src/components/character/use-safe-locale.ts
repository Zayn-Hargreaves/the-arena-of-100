"use client";

import { useLocale } from "next-intl";

export function useSafeLocale(fallback = "vi"): string {
  const locale = useLocale();
  return locale || fallback;
}
