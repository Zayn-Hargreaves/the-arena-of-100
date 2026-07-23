"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { useRouter } from "@/i18n/routing";

interface AdminAccessDeniedProps {
  title: string;
  description: string;
  returnHomeLabel: string;
}

/**
 * Shared "ACCESS DENIED" panel for any admin-only client view.
 * Callers translate the three labels via `useTranslations`; this
 * component is purely presentational and locale-routing-aware so a
 * non-admin can always bounce back to the deck.
 */
export function AdminAccessDenied({
  title,
  description,
  returnHomeLabel,
}: Readonly<AdminAccessDeniedProps>) {
  const router = useRouter();

  return (
    <AppShellLayout>
      <div className="max-w-md mx-auto w-full text-center space-y-6 pt-12 select-none">
        <div className="bg-candy-red border-[3px] border-candy-ink rounded-3xl p-8 shadow-[6px_6px_0_0_#2B2D42] text-white space-y-4">
          <div className="flex justify-center">
            <AlertTriangle className="w-16 h-16 text-candy-yellow animate-bounce" />
          </div>
          <h1 className="font-display font-black text-2xl tracking-wider uppercase">
            {title}
          </h1>
          <p className="font-mono text-xs font-black uppercase text-white/95 leading-relaxed">
            {description}
          </p>
        </div>
        <button
          onClick={() => router.push("/")}
          className="px-6 py-3 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all"
        >
          {returnHomeLabel}
        </button>
      </div>
    </AppShellLayout>
  );
}
