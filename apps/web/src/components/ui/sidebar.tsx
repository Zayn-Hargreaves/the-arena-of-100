"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
  Gamepad2,
  Trophy,
  Settings,
  Shield,
  User,
  PlusCircle,
  Menu,
  X,
  ChevronLeft,
} from "lucide-react";
import { Avatar } from "./avatar";

export interface SidebarProps {
  nickname?: string;
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  nickname = "",
  className = "",
}) => {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolvedNickname = nickname.trim();
  const displayName = resolvedNickname || t("guestName");
  const subtitleKey = resolvedNickname ? "playerRole" : "guestRole";

  const navItems = [
    { key: "nav.createRoom", href: "/room/create", icon: PlusCircle },
    { key: "nav.arena", href: "/game", icon: Gamepad2, disabled: true },
    { key: "nav.rankings", href: "/rankings", icon: Trophy },
    { key: "nav.settings", href: "/settings", icon: Settings },
    { key: "nav.profile", href: "/profile", icon: User },
    { key: "nav.admin", href: "/admin", icon: Shield },
  ];

  const handleToggle = () => setCollapsed(!collapsed);

  // Close mobile menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobileOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (mobileOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      }
    }
  }, [mobileOpen]);

  return (
    <>
      {/* --- DESKTOP SIDEBAR --- */}
      <aside
        className={cn(
          "hidden md:flex flex-col h-screen sticky top-0 bg-white border-r-4 border-candy-ink transition-all duration-300 select-none z-30 shrink-0 relative",
          collapsed ? "w-20" : "w-64",
          className,
        )}
      >
        {/* Toggle Button - Floating Handle */}
        <button
          onClick={handleToggle}
          className={cn(
            "absolute top-6 -right-3.5 p-1 rounded-lg bg-white border-3 border-candy-ink hover:bg-candy-yellow text-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:shadow-[1px_1px_0_0_#2B2D42] hover:translate-x-[0.5px] hover:translate-y-[0.5px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow z-50",
            "flex items-center justify-center",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft
            className={cn(
              "w-3.5 h-3.5 transition-transform duration-300",
              collapsed && "rotate-180",
            )}
          />
        </button>

        {/* Sidebar Header */}
        <div
          className={cn(
            "flex items-center border-b-4 border-candy-ink h-16 shrink-0 transition-all duration-300 justify-center px-3",
          )}
        >
          <Link
            href="/"
            className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 transition-all duration-300 select-none w-full text-center"
          >
            <span
              className={cn(
                "font-display font-black tracking-wider text-candy-pink transition-all duration-300 leading-none",
                collapsed ? "text-[11px]" : "text-xl",
              )}
            >
              ARENA
            </span>
            <span
              className={cn(
                "font-display font-black tracking-wider text-candy-ink transition-all duration-300 leading-none",
                collapsed ? "text-[9px]" : "text-xl",
              )}
            >
              OF 100
            </span>
          </Link>
        </div>

        {/* Navigation Section */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto transition-all duration-300",
            collapsed ? "p-2 space-y-3" : "p-3 space-y-1.5",
          )}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            if (item.disabled) return null;

            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "group relative flex items-center transition-all duration-300 border-3 border-candy-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow",
                  collapsed
                    ? "w-12 h-12 justify-center p-0 mx-auto rounded-2xl"
                    : "gap-3 p-3 rounded-xl",
                  isActive
                    ? "bg-candy-yellow text-candy-ink font-bold shadow-[4px_4px_0_0_#2B2D42]"
                    : "text-candy-ink hover:bg-candy-cloud hover:shadow-[2px_2px_0_0_#2B2D42]",
                )}
              >
                {/* Active left indicator line */}
                {isActive && !collapsed && (
                  <span className="absolute left-0 top-1/4 h-1/2 w-[3px] bg-candy-pink rounded-r" />
                )}

                <Icon
                  className={cn(
                    "w-5 h-5 transition-transform duration-300 shrink-0",
                    isActive ? "text-candy-ink" : "group-hover:scale-110",
                  )}
                />

                {!collapsed && (
                  <span className="font-sans text-sm tracking-wide transition-opacity duration-300">
                    {t(item.key)}
                  </span>
                )}

                {/* Collapsed Tooltip */}
                {collapsed && (
                  <div className="absolute left-full ml-4 px-3 py-1.5 bg-white border-3 border-candy-ink rounded-xl text-xs font-bold text-candy-ink opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none whitespace-nowrap shadow-[3px_3px_0_0_#2B2D42] z-50">
                    {t(item.key)}
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer / User Profile Section */}
        <div
          className={cn(
            "border-t-4 border-candy-ink flex shrink-0 transition-all duration-300",
            collapsed ? "p-3 justify-center" : "p-4 items-center gap-3",
          )}
        >
          <Avatar
            size="sm"
            fallback={displayName}
            status="online"
            className="shrink-0 border-2 border-candy-ink"
          />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-display text-sm font-bold text-candy-ink truncate">
                {displayName}
              </p>
              <p className="font-mono text-[10px] text-candy-ink/60 uppercase tracking-wider">
                {t(subtitleKey)}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* --- MOBILE ACTION BAR (TOP) --- */}
      <header className="md:hidden flex items-center justify-between px-4 h-16 bg-white border-b-4 border-candy-ink select-none z-30 w-full shrink-0">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-display font-bold text-base tracking-wider text-candy-pink">
            ARENA OF 100
          </span>
        </Link>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-xl bg-candy-cloud border-3 border-candy-ink hover:bg-candy-yellow text-candy-ink transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
      </header>

      {/* --- MOBILE NAV OVERLAY --- */}
      {mobileOpen && (
        /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
        <dialog
          ref={dialogRef}
          aria-modal="true"
          aria-label="Mobile navigation menu"
          className="md:hidden fixed inset-0 top-16 z-40 flex flex-col p-6 animate-fade-in border-t-4 border-candy-ink select-none w-full h-[calc(100vh-4rem)] max-w-none max-h-none m-0 bg-white"
          onClick={(e) => {
            if (e.target === dialogRef.current) {
              setMobileOpen(false);
            }
          }}
          onClose={() => setMobileOpen(false)}
        >
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 -z-10 cursor-default"
          />
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label={t("closeMenu")}
            className="self-end p-2 rounded-xl bg-candy-cloud border-3 border-candy-ink hover:bg-candy-yellow text-candy-ink transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow"
          >
            <X className="w-5 h-5" />
          </button>
          <nav className="flex-1 space-y-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));

              if (item.disabled) return null;

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border-3 border-candy-ink transition-all duration-300",
                    isActive
                      ? "bg-candy-yellow text-candy-ink font-bold shadow-[4px_4px_0_0_#2B2D42]"
                      : "text-candy-ink hover:bg-candy-cloud hover:shadow-[2px_2px_0_0_#2B2D42]",
                  )}
                >
                  <Icon className="w-6 h-6 shrink-0" />
                  <span className="font-sans text-base tracking-wide">
                    {t(item.key)}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t-4 border-candy-ink pt-6 flex items-center gap-4">
            <Avatar size="md" fallback={displayName} status="online" />
            <div>
              <p className="font-display text-base font-bold text-candy-ink">
                {displayName}
              </p>
              <p className="font-mono text-xs text-candy-ink/60 uppercase tracking-wider">
                {t(subtitleKey)}
              </p>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
};

Sidebar.displayName = "Sidebar";
