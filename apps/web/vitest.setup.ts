import "@testing-library/jest-dom/vitest";
import React from "react";
import { vi } from "vitest";

// jsdom doesn't implement matchMedia — used by some Tailwind responsive helpers.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom doesn't implement HTMLDialogElement.prototype.showModal and close.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ||
    function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ||
    function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
}

// next-intl useTranslations hook — return a function that mirrors the key path.
// Wrapped in vi.hoisted() so it is initialized before the hoisted vi.mock
// factory executes; vi.fn() preserves per-spec override capability
// (e.g., to assert against resolved locale strings rather than key paths).
const { useTranslationsMock } = vi.hoisted(() => {
  const fn = vi.fn((_namespace?: string) => {
    const t = (key: string, params?: Record<string, string | number>) => {
      if (!params) return key;
      return key.replace(/\{(\w+)\}/g, (_, name: string) =>
        String(params[name] ?? ""),
      );
    };
    t.has = (_key: string) => false;
    return t;
  });
  return { useTranslationsMock: fn };
});

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    ...actual,
    useTranslations: useTranslationsMock,
    useFormatter: () => ({
      // The tests assert against the raw number value; locale-aware
      // formatting is exercised in the real app via the i18n provider.
      number: (value: number) => String(value),
      dateTime: (value: Date | number) => String(value),
      date: (value: Date | number) => String(value),
    }),
    useLocale: () => "en",
  };
});

// next-intl/routing — usePathname/useRouter/Link wrappers (createElement to keep file .ts).
vi.mock("@/i18n/routing", async () => {
  return {
    Link: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      React.createElement("a", { href, ...rest }, children),
    usePathname: () => "/",
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    }),
  };
});
