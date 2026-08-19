import React from "react";
import { cn } from "@/lib/utils";

export interface SidebarIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
  isActive?: boolean;
}

/**
 * Daily Challenge Arcade Calendar Icon
 * Chunky desk calendar with binding rings, candy-pink top banner, and star badge
 */
export function DailyCalendarIcon({
  className,
  size = 24,
  isActive = false,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-200", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="calBodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFDF5" />
          <stop offset="100%" stopColor={isActive ? "#FFEAA7" : "#F1F2F6"} />
        </linearGradient>
        <linearGradient id="calTopGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FF6B81" />
          <stop offset="100%" stopColor="#FF4757" />
        </linearGradient>
        <linearGradient id="calStarGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFEAA7" />
          <stop offset="100%" stopColor="#FDCB6E" />
        </linearGradient>
      </defs>

      {/* Calendar Card Body */}
      <rect
        x="4"
        y="7"
        width="24"
        height="21"
        rx="5"
        fill="url(#calBodyGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Calendar Header Band */}
      <path
        d="M4 12C4 9.23858 6.23858 7 9 7H23C25.7614 7 28 9.23858 28 12V13H4V12Z"
        fill="url(#calTopGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Spiral Binder Rings */}
      <rect x="9" y="3.5" width="2.8" height="6" rx="1.4" fill="#2B2D42" />
      <rect x="20.2" y="3.5" width="2.8" height="6" rx="1.4" fill="#2B2D42" />

      {/* Center Star / Daily Badge */}
      <path
        d="M16 16.2L17.3 19.3L20.5 19.6L18 21.8L18.8 25L16 23.2L13.2 25L14 21.8L11.5 19.6L14.7 19.3L16 16.2Z"
        fill="url(#calStarGrad)"
        stroke="#2B2D42"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Create Room Arcade Ticket / Portal Icon
 * Chunky game pass / portal with a bold plus badge
 */
export function CreateRoomIcon({
  className,
  size = 24,
  isActive: _isActive = false,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-200", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="createTicketGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#55EFC4" />
          <stop offset="100%" stopColor="#00B894" />
        </linearGradient>
        <linearGradient id="plusBadgeGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF275" />
          <stop offset="100%" stopColor="#FFAA00" />
        </linearGradient>
      </defs>

      {/* Arcade Door / Ticket Body */}
      <rect
        x="4"
        y="5"
        width="24"
        height="22"
        rx="5"
        fill="url(#createTicketGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Ticket Cutout Notches */}
      <circle
        cx="4"
        cy="16"
        r="3"
        fill="white"
        stroke="#2B2D42"
        strokeWidth="2.2"
      />
      <circle
        cx="28"
        cy="16"
        r="3"
        fill="white"
        stroke="#2B2D42"
        strokeWidth="2.2"
      />

      {/* Center Plus Circle Badge */}
      <circle
        cx="16"
        cy="16"
        r="6.5"
        fill="url(#plusBadgeGrad)"
        stroke="#2B2D42"
        strokeWidth="2"
      />

      {/* Chunky Plus Cross */}
      <path
        d="M16 12.5V19.5M12.5 16H19.5"
        stroke="#2B2D42"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Rankings Arcade Golden Trophy Icon
 * 3D-styled chunky gold trophy with handles & star
 */
export function RankingsTrophyIcon({
  className,
  size = 24,
  isActive: _isActive = false,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-200", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="trophyGoldGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF566" />
          <stop offset="50%" stopColor="#FFC800" />
          <stop offset="100%" stopColor="#FF9000" />
        </linearGradient>
        <linearGradient id="trophyBaseGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A29BFE" />
          <stop offset="100%" stopColor="#6C5CE7" />
        </linearGradient>
      </defs>

      {/* Left Handle */}
      <path
        d="M9 9H6C4.5 9 4 10.5 4 12.5C4 15.5 6 17 9 17"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Right Handle */}
      <path
        d="M23 9H26C27.5 9 28 10.5 28 12.5C28 15.5 26 17 23 17"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Main Cup Body */}
      <path
        d="M8 6H24V14C24 18.5 20.5 21 16 21C11.5 21 8 18.5 8 14V6Z"
        fill="url(#trophyGoldGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Star Emblem on Cup */}
      <path
        d="M16 9.5L17 12L19.5 12.2L17.5 13.8L18.2 16.2L16 14.8L13.8 16.2L14.5 13.8L12.5 12.2L15 12L16 9.5Z"
        fill="#FFFFFF"
        stroke="#2B2D42"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* Trophy Stem */}
      <path
        d="M14 21V24H18V21"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
        fill="#FFC800"
      />

      {/* Trophy Base Pedestal */}
      <rect
        x="10"
        y="24"
        width="12"
        height="5"
        rx="2.5"
        fill="url(#trophyBaseGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Settings Arcade Cog / Gear Icon
 * Chunky 6-tooth gear with round center axle
 */
export function SettingsCogIcon({
  className,
  size = 24,
  isActive: _isActive = false,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-200", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="gearBodyGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#74B9FF" />
          <stop offset="100%" stopColor="#0984E3" />
        </linearGradient>
      </defs>

      {/* 6-Teeth Chunky Mechanical Gear */}
      <path
        d="M13.5 3H18.5L19.5 6.5C20.8 7 21.9 7.7 22.9 8.6L26.5 7.2L29.5 11.2L27.2 14.2C27.4 14.8 27.5 15.4 27.5 16C27.5 16.6 27.4 17.2 27.2 17.8L29.5 20.8L26.5 24.8L22.9 23.4C21.9 24.3 20.8 25 19.5 25.5L18.5 29H13.5L12.5 25.5C11.2 25 10.1 24.3 9.1 23.4L5.5 24.8L2.5 20.8L4.8 17.8C4.6 17.2 4.5 16.6 4.5 16C4.5 15.4 4.6 14.8 4.8 14.2L2.5 11.2L5.5 7.2L9.1 8.6C10.1 7.7 11.2 7 12.5 6.5L13.5 3Z"
        fill="url(#gearBodyGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Center Axle Circle Hole */}
      <circle
        cx="16"
        cy="16"
        r="4.5"
        fill="#FFFDF5"
        stroke="#2B2D42"
        strokeWidth="2.4"
      />
    </svg>
  );
}

/**
 * Profile Fighter Pass ID Icon
 * Chunky fighter badge with portrait head and rank stripes
 */
export function ProfileCardIcon({
  className,
  size = 24,
  isActive: _isActive = false,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-200", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="profileCardGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FD79A8" />
          <stop offset="100%" stopColor="#E84393" />
        </linearGradient>
      </defs>

      {/* Card Base */}
      <rect
        x="4"
        y="5"
        width="24"
        height="22"
        rx="5"
        fill="url(#profileCardGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Lanyard / Clip Hole */}
      <rect x="13.5" y="6.8" width="5" height="2" rx="1" fill="#2B2D42" />

      {/* Head Avatar */}
      <circle
        cx="16"
        cy="14"
        r="3.5"
        fill="#FFFDF5"
        stroke="#2B2D42"
        strokeWidth="2"
      />

      {/* Shoulder Silhouette */}
      <path
        d="M10 22.5C10 19.5 12.8 18.5 16 18.5C19.2 18.5 22 19.5 22 22.5"
        stroke="#2B2D42"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="#FFFDF5"
      />
    </svg>
  );
}

/**
 * Admin Sheriff Shield Icon
 * Arcade star shield badge
 */
export function AdminShieldIcon({
  className,
  size = 24,
  isActive: _isActive = false,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-200", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="shieldAdminGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A29BFE" />
          <stop offset="100%" stopColor="#6C5CE7" />
        </linearGradient>
        <linearGradient id="starAdminGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFEAA7" />
          <stop offset="100%" stopColor="#FDCB6E" />
        </linearGradient>
      </defs>

      {/* Shield Outline Body */}
      <path
        d="M16 3L5 7V16C5 22.5 9.5 27.5 16 29C22.5 27.5 27 22.5 27 16V7L16 3Z"
        fill="url(#shieldAdminGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Center 5-point Star */}
      <path
        d="M16 10L17.8 13.9L22 14.4L18.8 17.3L19.8 21.5L16 19.3L12.2 21.5L13.2 17.3L10 14.4L14.2 13.9L16 10Z"
        fill="url(#starAdminGrad)"
        stroke="#2B2D42"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Arcade Chevron Icon (Sidebar Toggle)
 */
export function ArcadeChevronIcon({
  className,
  size = 18,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M14.5 6L8.5 12L14.5 18"
        stroke="#2B2D42"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Arcade Menu Hamburger Icon
 */
export function ArcadeMenuIcon({
  className,
  size = 22,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M4 6.5H20M4 12H20M4 17.5H20"
        stroke="#2B2D42"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Arcade Close (X) Icon
 */
export function ArcadeCloseIcon({
  className,
  size = 22,
  ...props
}: Readonly<SidebarIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M6 6L18 18M18 6L6 18"
        stroke="#2B2D42"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
