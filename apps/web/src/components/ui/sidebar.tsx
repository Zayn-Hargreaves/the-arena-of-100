"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { LanguageToggle } from "./language-toggle";
import { SpriteFrame } from "./sprite-frame";
import { findAvatarBySeed } from "@/lib/avatars";
import {
  type AvatarSeed,
  DEFAULT_AVATAR_SEED,
  isValidAvatarSeed,
} from "@arena/shared";
import { useSocketStore } from "@/stores/socket-store";
import {
  DailyCalendarIcon,
  CreateRoomIcon,
  RankingsTrophyIcon,
  SettingsCogIcon,
  ProfileCardIcon,
  AdminShieldIcon,
  ArcadeChevronIcon,
  ArcadeMenuIcon,
  ArcadeCloseIcon,
} from "./sidebar-icons";

export interface SidebarProps {
  nickname?: string;
  avatarSeed?: string;
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  nickname = "",
  avatarSeed,
  className = "",
}) => {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const userRole = useSocketStore((state) => state.userRole);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const resolvedNickname = nickname.trim();
  const displayName = resolvedNickname || t("guestName");
  const subtitleKey = resolvedNickname ? "playerRole" : "guestRole";

  const closeMobileMenu = () => {
    setMobileOpen(false);
    mobileToggleRef.current?.focus();
  };

  const [resolvedAvatarSeed, setResolvedAvatarSeed] = useState<AvatarSeed>(
    () => {
      if (avatarSeed && isValidAvatarSeed(avatarSeed)) {
        return avatarSeed as AvatarSeed;
      }
      return DEFAULT_AVATAR_SEED;
    },
  );

  useEffect(() => {
    if (avatarSeed && isValidAvatarSeed(avatarSeed)) {
      setResolvedAvatarSeed(avatarSeed as AvatarSeed);
      return;
    }

    const updateFromStorage = () => {
      try {
        const stored = localStorage.getItem("avatarSeed");
        if (stored && isValidAvatarSeed(stored)) {
          setResolvedAvatarSeed(stored as AvatarSeed);
        } else {
          setResolvedAvatarSeed(DEFAULT_AVATAR_SEED);
        }
      } catch {
        // Reset to default on storage errors
        setResolvedAvatarSeed(DEFAULT_AVATAR_SEED);
      }
    };

    updateFromStorage();
    window.addEventListener("storage", updateFromStorage);
    return () => window.removeEventListener("storage", updateFromStorage);
  }, [avatarSeed]);

  const avatarOption = findAvatarBySeed(resolvedAvatarSeed);

  const navItems = [
    { key: "nav.daily", href: "/daily", icon: DailyCalendarIcon },
    { key: "nav.createRoom", href: "/room/create", icon: CreateRoomIcon },
    { key: "nav.arena", href: "/game", icon: CreateRoomIcon, disabled: true },
    { key: "nav.rankings", href: "/rankings", icon: RankingsTrophyIcon },
    { key: "nav.settings", href: "/settings", icon: SettingsCogIcon },
    { key: "nav.profile", href: "/profile", icon: ProfileCardIcon },
    ...(userRole === "ADMIN"
      ? [{ key: "nav.admin", href: "/admin", icon: AdminShieldIcon }]
      : []),
  ];

  const handleToggle = () => setCollapsed(!collapsed);

  // Close mobile menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) {
        closeMobileMenu();
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
          "hidden md:flex flex-col h-screen sticky top-0 bg-[#FFFDF5] border-r-4 border-candy-ink transition-all duration-300 select-none z-30 shrink-0 relative",
          collapsed ? "w-20" : "w-64",
          className,
        )}
      >
        {/* Toggle Button - Floating Handle */}
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            "absolute top-5 -right-3.5 p-1 rounded-xl bg-white border-3 border-candy-ink hover:bg-candy-yellow text-candy-ink shadow-[2.5px_2.5px_0_0_#2B2D42] hover:shadow-[1px_1px_0_0_#2B2D42] hover:translate-x-[1px] hover:translate-y-[1px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow z-50 cursor-pointer",
            "flex items-center justify-center",
          )}
          aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
        >
          <ArcadeChevronIcon
            size={14}
            className={cn(
              "transition-transform duration-300",
              collapsed && "rotate-180",
            )}
          />
        </button>

        {/* Sidebar Header */}
        <div
          className={cn(
            "flex items-center border-b-4 border-candy-ink h-16 shrink-0 transition-all duration-300 justify-center bg-white overflow-hidden",
            collapsed ? "px-1" : "px-3",
          )}
        >
          <Link
            href="/"
            className={cn(
              "flex items-center justify-center transition-all duration-300 select-none w-full text-center group",
              collapsed ? "flex-col gap-0.5" : "gap-1.5",
            )}
          >
            <span
              className={cn(
                "font-display font-black tracking-wider text-candy-pink transition-all duration-300 leading-none group-hover:scale-105",
                collapsed ? "text-xs tracking-tight" : "text-xl",
              )}
            >
              ARENA
            </span>
            <span
              className={cn(
                "font-display font-black tracking-wider text-candy-ink transition-all duration-300 leading-none group-hover:scale-105",
                collapsed ? "text-[9px] tracking-normal" : "text-xl",
              )}
            >
              OF 100
            </span>
          </Link>
        </div>

        {/* Navigation Section */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden no-scrollbar transition-all duration-300",
            collapsed ? "px-2 py-3 space-y-3" : "p-3.5 space-y-2",
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
                  "group relative flex items-center transition-all duration-200 border-3 border-candy-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow cursor-pointer",
                  collapsed
                    ? "w-12 h-12 justify-center p-0 mx-auto rounded-2xl"
                    : "gap-3 px-3.5 py-2.5 rounded-2xl",
                  isActive
                    ? "bg-candy-yellow text-candy-ink font-display font-black shadow-[4px_4px_0_0_#2B2D42] translate-x-[-1px] translate-y-[-1px]"
                    : "bg-white text-candy-ink hover:bg-candy-cloud hover:shadow-[2px_2px_0_0_#2B2D42] hover:translate-x-[1px] hover:translate-y-[1px]",
                )}
              >
                {/* Active left indicator notch */}
                {isActive && !collapsed && (
                  <span className="absolute -left-[3px] top-1/2 -translate-y-1/2 h-6 w-1.5 bg-candy-pink rounded-r-md border-r-2 border-candy-ink" />
                )}

                <Icon
                  size={collapsed ? 24 : 22}
                  isActive={isActive}
                  className={cn(
                    "transition-transform duration-200 shrink-0",
                    isActive ? "scale-105" : "group-hover:scale-110",
                  )}
                />

                {!collapsed && (
                  <span className="font-display font-bold text-sm tracking-wide transition-colors duration-200 truncate">
                    {t(item.key)}
                  </span>
                )}

                {/* Collapsed Tooltip */}
                {collapsed && (
                  <div className="absolute left-full ml-3 px-3 py-1.5 bg-white border-3 border-candy-ink rounded-xl text-xs font-display font-black text-candy-ink opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap shadow-[3px_3px_0_0_#2B2D42] z-50">
                    {t(item.key)}
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Language Switcher Section */}
        {!collapsed && (
          <div className="px-3.5 pb-2">
            <LanguageToggle className="w-full justify-center shadow-[2.5px_2.5px_0_0_#2B2D42]" />
          </div>
        )}

        {/* Sidebar Footer / User Profile Section */}
        <div
          className={cn(
            "border-t-4 border-candy-ink bg-white flex shrink-0 transition-all duration-300",
            collapsed ? "p-2.5 justify-center" : "p-3.5 items-center gap-3",
          )}
        >
          <div
            className="w-10 h-10 rounded-xl bg-white border-2 border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden shrink-0"
            data-testid="sidebar-avatar"
          >
            <SpriteFrame
              src={avatarOption.spritesheet}
              scale={0.18}
              width="35px"
              height="37px"
              frameClassName="w-10 h-10 rounded-xl border-0 shadow-none"
              skeletonSize="28px"
            />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-display text-sm font-black text-candy-ink truncate leading-tight">
                {displayName}
              </p>
              <p className="font-mono text-[10px] text-candy-ink/70 uppercase tracking-wider font-bold">
                {t(subtitleKey)}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* --- MOBILE ACTION BAR (TOP) --- */}
      <header className="md:hidden flex items-center justify-between px-4 h-16 bg-white border-b-4 border-candy-ink select-none z-30 w-full shrink-0">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-display font-black text-base tracking-wider text-candy-pink">
            ARENA OF 100
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <LanguageToggle showIcon={false} />
          <button
            ref={mobileToggleRef}
            type="button"
            onClick={() =>
              mobileOpen ? closeMobileMenu() : setMobileOpen(true)
            }
            className="p-2 rounded-xl bg-candy-cloud border-3 border-candy-ink hover:bg-candy-yellow text-candy-ink transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow shadow-[2px_2px_0_0_#2B2D42] cursor-pointer"
            aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
          >
            {mobileOpen ? (
              <ArcadeCloseIcon size={20} />
            ) : (
              <ArcadeMenuIcon size={20} />
            )}
          </button>
        </div>
      </header>

      {/* --- MOBILE NAV OVERLAY --- */}
      {mobileOpen && (
        /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
        <dialog
          ref={dialogRef}
          aria-modal="true"
          aria-label="Mobile navigation menu"
          className="md:hidden fixed inset-0 top-16 z-40 flex flex-col p-5 animate-fade-in border-t-4 border-candy-ink select-none w-full h-[calc(100vh-4rem)] max-w-none max-h-none m-0 bg-[#FFFDF5]"
          onClick={(e) => {
            if (e.target === dialogRef.current) {
              closeMobileMenu();
            }
          }}
          onClose={closeMobileMenu}
        >
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={closeMobileMenu}
            className="absolute inset-0 -z-10 cursor-default"
          />

          <div className="flex items-center justify-between pb-3 mb-2 border-b-2 border-candy-ink/20">
            <span className="font-display font-black text-sm tracking-wider text-candy-pink">
              ARENA OF 100
            </span>
            <button
              type="button"
              onClick={closeMobileMenu}
              className="p-1.5 rounded-xl bg-candy-cloud border-2 border-candy-ink hover:bg-candy-yellow text-candy-ink transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-candy-yellow shadow-[2px_2px_0_0_#2B2D42] cursor-pointer"
              aria-label={t("closeMenu")}
            >
              <ArcadeCloseIcon size={18} />
            </button>
          </div>

          <nav className="flex-1 space-y-2.5 overflow-y-auto no-scrollbar">
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
                  onClick={closeMobileMenu}
                  className={cn(
                    "flex items-center gap-3.5 p-3.5 rounded-2xl border-3 border-candy-ink transition-all duration-200 cursor-pointer",
                    isActive
                      ? "bg-candy-yellow text-candy-ink font-display font-black shadow-[4px_4px_0_0_#2B2D42]"
                      : "bg-white text-candy-ink hover:bg-candy-cloud hover:shadow-[2px_2px_0_0_#2B2D42]",
                  )}
                >
                  <Icon size={24} isActive={isActive} />
                  <span className="font-display font-bold text-base tracking-wide">
                    {t(item.key)}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t-4 border-candy-ink pt-4 mt-2 flex items-center gap-3 bg-white p-3.5 rounded-2xl border-3 shadow-[3px_3px_0_0_#2B2D42]">
            <div className="w-12 h-12 rounded-xl bg-white border-2 border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden shrink-0">
              <SpriteFrame
                src={avatarOption.spritesheet}
                scale={0.22}
                width="42px"
                height="45px"
                frameClassName="w-12 h-12 rounded-xl border-0 shadow-none"
                skeletonSize="32px"
              />
            </div>
            <div>
              <p className="font-display text-base font-black text-candy-ink">
                {displayName}
              </p>
              <p className="font-mono text-xs text-candy-ink/70 uppercase tracking-wider font-bold">
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
