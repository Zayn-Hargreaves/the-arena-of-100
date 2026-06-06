import type { Locale } from "@/i18n/routing";

export function formatPercent(value: number, fractionDigits = 0) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(fractionDigits) ||
    fractionDigits < 0
  ) {
    return "—";
  }
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatResponseMs(value: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "0.00s";
  }
  return `${(value / 1000).toFixed(2)}s`;
}

const LOCALE_BCP47: Record<Locale, string> = {
  vi: "vi-VN",
  en: "en-US",
};

export function formatPlayedAt(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(LOCALE_BCP47[locale] ?? locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDuration(value: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "0s";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}
