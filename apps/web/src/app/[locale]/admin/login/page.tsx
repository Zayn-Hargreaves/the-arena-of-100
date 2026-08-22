"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import { apiFetch } from "@/lib/api";
import { Link, useRouter } from "@/i18n/routing";

function AdminLockBadgeSvg({
  className = "w-12 h-12",
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
      <rect
        x="8"
        y="18"
        width="32"
        height="24"
        rx="6"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="3.5"
      />
      <path
        d="M16 18V13C16 8.5 19.5 5 24 5C28.5 5 32 8.5 32 13V18"
        stroke="#2B2D42"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle
        cx="24"
        cy="28"
        r="3"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M24 31V35"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KeySvg({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="12"
        r="4"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M12 12H20M17 12V15M19.5 12V14"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TerminalSvg({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" fill="#2B2D42" />
      <path
        d="M7 9L10 12L7 15M12 15H16"
        stroke="#06D6A0"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdminLoginPage() {
  const t = useTranslations("admin.login");
  const { toast } = useToast();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsSubmitting(true);

    try {
      const response = await apiFetch("/api/v1/auth/admin-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(errorData.message || t("error"));
      }

      const raw = (await response.json()) as {
        data?: {
          accessToken: string;
          user: { id: string; username: string; role: string };
        };
        accessToken?: string;
        user?: { id: string; username: string; role: string };
      };

      const payload = raw.data || raw;

      if (!payload.user || !payload.accessToken) {
        throw new Error(t("error"));
      }

      // Update global socket & auth state
      useSocketStore.setState({
        accessToken: payload.accessToken,
        userId: payload.user.id,
        userRole: payload.user.role,
        username: payload.user.username,
        isAuthenticated: true,
      });

      toast({
        title: t("success"),
        description: t("successDesc", {
          username: payload.user.username,
          role: payload.user.role,
        }),
      });

      router.push("/admin");
    } catch (err) {
      toast({
        title: t("failedTitle"),
        description: err instanceof Error ? err.message : t("error"),
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShellLayout>
      <div className="max-w-md mx-auto w-full space-y-6 pt-8 select-none">
        {/* Header Hero */}
        <div className="relative bg-candy-red border-[3.5px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] text-white text-center space-y-3 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-3 bg-white/20 z-0" />
          <div className="flex justify-center relative z-10">
            <div className="p-3 bg-white rounded-2xl border-[2.5px] border-candy-ink shadow-[3px_3px_0_0_#000]">
              <AdminLockBadgeSvg className="w-12 h-12" />
            </div>
          </div>
          <div className="space-y-1 relative z-10">
            <h1 className="font-display font-black text-2xl md:text-3xl tracking-wider uppercase">
              {t("title")}
            </h1>
            <p className="font-mono text-xs font-bold text-white/90 leading-relaxed">
              {t("subtitle")}
            </p>
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-white border-[3.5px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] space-y-5">
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Password Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="admin-password"
                className="block text-xs font-mono font-black uppercase text-candy-ink"
              >
                {t("passwordLabel")}
              </label>
              <input
                id="admin-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                className="w-full px-4 py-3 bg-candy-cloud/70 border-[2.5px] border-candy-ink rounded-2xl font-mono text-sm font-bold text-candy-ink focus:bg-white focus:outline-none focus:ring-2 focus:ring-candy-yellow shadow-inner"
              />
            </div>

            {/* Dev Hint */}
            <div className="p-3 rounded-xl bg-candy-yellow/30 border-2 border-candy-ink flex items-center gap-2 text-[11px] font-mono font-bold text-candy-ink">
              <TerminalSvg className="w-4 h-4 shrink-0 text-candy-ink" />
              <span>{t("devHint")}</span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !password.trim()}
              className="w-full flex items-center justify-center gap-2 h-12 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              <KeySvg className="w-4 h-4 text-candy-ink" />
              {isSubmitting ? t("submitting") : t("submit")}
            </button>
          </form>

          {/* Back link */}
          <div className="text-center pt-2">
            <Link
              href="/"
              className="font-mono text-xs font-black uppercase text-candy-ink/70 hover:text-candy-pink underline"
            >
              {t("backToHome")}
            </Link>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
