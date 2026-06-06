import { redirect, routing } from "@/i18n/routing";

export default function NotFound() {
  // Root-level not-found has no locale context. Forward to the
  // locale-specific page so users get a fully localized experience
  // (messages live in apps/web/messages/{vi,en}.json under "NotFoundPage").
  redirect({ href: "/not-found", locale: routing.defaultLocale });
}
