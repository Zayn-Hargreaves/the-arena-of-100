"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Link, useRouter } from "@/i18n/routing";

interface AdminAccessDeniedProps {
  title: string;
  description: string;
  returnHomeLabel: string;
}

function WarningTriangleSvg({
  className = "w-16 h-16",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M24 6L4 40H44L24 6Z"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M24 18V28"
        stroke="#2B2D42"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="24" cy="34" r="2.2" fill="#2B2D42" />
    </svg>
  );
}

function AdminKeyLockSvg({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2.5"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M8 11V7C8 4.8 9.8 3 12 3C14.2 3 16 4.8 16 7V11"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16" r="1.5" fill="#2B2D42" />
    </svg>
  );
}

/**
 * Shared "ACCESS DENIED" panel for any admin-only client view.
 */
export function AdminAccessDenied({
  title,
  description,
  returnHomeLabel,
}: Readonly<AdminAccessDeniedProps>) {
  const router = useRouter();
  const t = useTranslations("admin");

  return (
    <AppShellLayout>
      <div className="max-w-md mx-auto w-full text-center space-y-6 pt-12 select-none">
        <div className="bg-candy-red border-[3.5px] border-candy-ink rounded-3xl p-8 shadow-[6px_6px_0_0_#2B2D42] text-white space-y-4">
          <div className="flex justify-center animate-bounce">
            <WarningTriangleSvg className="w-18 h-18 drop-shadow-[2px_2px_0_#000]" />
          </div>
          <h1 className="font-display font-black text-2xl tracking-wider uppercase">
            {title}
          </h1>
          <p className="font-mono text-xs font-black uppercase text-white/95 leading-relaxed">
            {description}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="w-full sm:w-auto px-6 py-3 bg-white border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-candy-cloud active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all cursor-pointer"
          >
            {returnHomeLabel}
          </button>

          <Link
            href="/admin/login"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all cursor-pointer"
          >
            <AdminKeyLockSvg className="w-4 h-4 text-candy-ink" />
            {t("accessDenied.loginButton")}
          </Link>
        </div>
      </div>
    </AppShellLayout>
  );
}
