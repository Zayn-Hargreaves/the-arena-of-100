import React from "react";
import { cn } from "@/lib/utils";

export interface ProfileIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

// ============================================================
// Shared Candy Palette Color Tokens
// ============================================================
const CANDY = {
  ink: "#2B2D42",
  yellow: "#FFE45E",
  yellowGold: "#FFD166",
  pink: "#FF4370",
  pinkSoft: "#FF6B8B",
  blue: "#70D6FF",
  blueDeep: "#0984E3",
  mint: "#06D6A0",
  cloud: "#FFFDF5",
} as const;

interface ProfileIconWrapperProps extends ProfileIconProps {
  viewBox: string;
  defaultSize?: number;
  children: React.ReactNode;
}

function ProfileIconWrapper({
  viewBox,
  defaultSize = 24,
  size,
  className,
  children,
  ...props
}: Readonly<ProfileIconWrapperProps>) {
  const iconSize = size ?? defaultSize;
  return (
    <svg
      viewBox={viewBox}
      width={iconSize}
      height={iconSize}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * Profile Fighter Pass Hero Badge SVG
 */
export function ProfileHeroBadgeSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={28} {...props}>
      <rect
        x="4"
        y="4"
        width="24"
        height="24"
        rx="6"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="2.5"
      />
      <path
        d="M9 10H23M9 16H18M9 22H15"
        stroke={CANDY.ink}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle
        cx="21.5"
        cy="19.5"
        r="4.5"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="2"
      />
      <path
        d="M21.5 17L22.2 18.5L23.8 18.7L22.6 19.8L22.9 21.4L21.5 20.6L20.1 21.4L20.4 19.8L19.2 18.7L20.8 18.5L21.5 17Z"
        fill={CANDY.cloud}
      />
    </ProfileIconWrapper>
  );
}

/**
 * Golden Victory Trophy SVG
 */
export function ProfileTrophySvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={28} {...props}>
      {/* Handles */}
      <path
        d="M7 8H4C3 8 2 9 2 11C2 14 4.5 15.5 7 15.5"
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M25 8H28C29 8 30 9 30 11C30 14 27.5 15.5 25 15.5"
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Main Cup */}
      <path
        d="M7 5H25V13C25 17.5 21.5 20 16 20C10.5 20 7 17.5 7 13V5Z"
        fill={CANDY.yellowGold}
        stroke={CANDY.ink}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Cup Highlight */}
      <path
        d="M10 8V12C10 14.5 12 16.5 15 17"
        stroke={CANDY.cloud}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Star Emblem */}
      <path
        d="M16 8.5L17 10.8L19.5 11L17.6 12.6L18.2 15L16 13.7L13.8 15L14.4 12.6L12.5 11L15 10.8L16 8.5Z"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="1"
      />
      {/* Stem */}
      <path
        d="M13.5 20V23H18.5V20"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="2.2"
      />
      {/* Base */}
      <rect
        x="9"
        y="23"
        width="14"
        height="5"
        rx="2"
        fill={CANDY.blue}
        stroke={CANDY.ink}
        strokeWidth="2.4"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Crossed Swords (Attack Class) SVG
 */
export function SwordsClashSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={24} {...props}>
      {/* Sword 1: Top-Left to Bottom-Right */}
      <path
        d="M6 6L18 18L16 20L4 8L6 6Z"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M3 11L9 5"
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M18 18L23 23M21 25L25 21"
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle
        cx="24.5"
        cy="24.5"
        r="1.5"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="1.5"
      />

      {/* Sword 2: Top-Right to Bottom-Left */}
      <path
        d="M26 6L14 18L16 20L28 8L26 6Z"
        fill={CANDY.pinkSoft}
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M29 11L23 5"
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M14 18L9 23M11 25L7 21"
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle
        cx="7.5"
        cy="24.5"
        r="1.5"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="1.5"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Guardian Shield (Defense Class) SVG
 */
export function ShieldGuardianSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={24} {...props}>
      <path
        d="M16 3L5 7V16C5 22.5 9.5 27.5 16 29C22.5 27.5 27 22.5 27 16V7L16 3Z"
        fill={CANDY.blue}
        stroke={CANDY.ink}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Inner Shield Layer */}
      <path
        d="M16 6.5L8.5 9.5V16C8.5 20.8 11.8 24.5 16 25.8C20.2 24.5 23.5 20.8 23.5 16V9.5L16 6.5Z"
        fill={CANDY.blueDeep}
        stroke={CANDY.ink}
        strokeWidth="1.8"
      />
      {/* Center Defense Cross/Star */}
      <path
        d="M16 11V21M11 16H21"
        stroke={CANDY.cloud}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Flame Streak Daily Challenge SVG
 */
export function FlameStreakSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={24} {...props}>
      {/* Outer Flame */}
      <path
        d="M16 2C16 2 20 7 20 12C20 13.2 19.6 14.3 19 15.2C21 16.5 25 19.5 25 24C25 27.5 21.5 29.5 16 29.5C10.5 29.5 7 27.5 7 24C7 19.8 11 16 13 14C13.5 10 16 2 16 2Z"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* Mid Flame */}
      <path
        d="M16 11C16 11 19 14.5 19 18C19 21.5 17.5 24.5 16 26.5C14.5 24.5 13 21.5 13 18C13 15.5 15 12.5 16 11Z"
        fill={CANDY.yellowGold}
        stroke={CANDY.ink}
        strokeWidth="1.8"
      />
      {/* Core Spark */}
      <path
        d="M16 19C16 19 17.2 20.8 17.2 22C17.2 23.2 16.6 24.5 16 25C15.4 24.5 14.8 23.2 14.8 22C14.8 20.8 16 19 16 19Z"
        fill={CANDY.cloud}
      />
    </ProfileIconWrapper>
  );
}

/**
 * Strategic Cards Deck SVG
 */
export function CardsDeckSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={24} {...props}>
      {/* Back Card */}
      <rect
        x="6"
        y="5"
        width="14"
        height="20"
        rx="3"
        transform="rotate(-12 6 5)"
        fill={CANDY.blue}
        stroke={CANDY.ink}
        strokeWidth="2"
      />
      {/* Front Card */}
      <rect
        x="12"
        y="6"
        width="15"
        height="21"
        rx="3.5"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="2.4"
      />
      {/* Card Emblem Star */}
      <circle
        cx="19.5"
        cy="16.5"
        r="4"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="1.8"
      />
      <path
        d="M19.5 14L20 15.5L21.5 15.7L20.3 16.8L20.7 18.2L19.5 17.5L18.3 18.2L18.7 16.8L17.5 15.7L19 15.5L19.5 14Z"
        fill={CANDY.cloud}
      />
    </ProfileIconWrapper>
  );
}

/**
 * Lightning Speed (Average Response Time) SVG
 */
export function LightningSpeedSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={24} {...props}>
      <path
        d="M18 2L6 16H15L13 30L26 14H17L20 2H18Z"
        fill={CANDY.mint}
        stroke={CANDY.ink}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M15 7L9 14H14L13 22"
        stroke={CANDY.cloud}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Accuracy Target (Accuracy Rate) SVG
 */
export function AccuracyTargetSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={24} {...props}>
      {/* Outer Ring */}
      <circle
        cx="16"
        cy="16"
        r="12"
        fill={CANDY.cloud}
        stroke={CANDY.ink}
        strokeWidth="2.4"
      />
      {/* Mid Ring */}
      <circle
        cx="16"
        cy="16"
        r="8"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="2"
      />
      {/* Bullseye */}
      <circle
        cx="16"
        cy="16"
        r="3.5"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="1.8"
      />
      {/* Crosshairs */}
      <path
        d="M16 2V7M16 25V30M2 16H7M25 16H30"
        stroke={CANDY.ink}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Crown Gold (Won / Top 1 Winner) SVG
 */
export function CrownGoldSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={20} {...props}>
      <path
        d="M3 18L4.5 8L9 12L12 5L15 12L19.5 8L21 18H3Z"
        fill={CANDY.yellowGold}
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="4.5" cy="7" r="1.5" fill={CANDY.pink} />
      <circle cx="12" cy="4" r="1.5" fill={CANDY.mint} />
      <circle cx="19.5" cy="7" r="1.5" fill={CANDY.blue} />
      <rect
        x="4"
        y="17"
        width="16"
        height="3"
        rx="1.5"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="1.5"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Skull Defeat (Eliminated Match) SVG
 */
export function SkullDefeatSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={18} {...props}>
      <path
        d="M6 10C6 6.5 8.7 4 12 4C15.3 4 18 6.5 18 10C18 12.8 16.5 14.8 15 15.5V18H9V15.5C7.5 14.8 6 12.8 6 10Z"
        fill={CANDY.pinkSoft}
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="10" r="1.5" fill={CANDY.ink} />
      <circle cx="14.5" cy="10" r="1.5" fill={CANDY.ink} />
      <path
        d="M10 15V18M12 15V18M14 15V18"
        stroke={CANDY.ink}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Flag Abandon (Abandoned Match) SVG
 */
export function FlagAbandonSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={18} {...props}>
      <path
        d="M5 21V4M5 4L18 8L5 13"
        stroke={CANDY.ink}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={CANDY.yellow}
      />
    </ProfileIconWrapper>
  );
}

/**
 * Copy Clipboard SVG
 */
export function CopyClipboardSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={16} {...props}>
      <rect
        x="8"
        y="7"
        width="12"
        height="14"
        rx="3"
        fill={CANDY.cloud}
        stroke={CANDY.ink}
        strokeWidth="2"
      />
      <path
        d="M5 16H4C3.4 16 3 15.6 3 15V4C3 3.4 3.4 3 4 3H13C13.6 3 14 3.4 14 4V6"
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Checkmark Svg
 */
export function CheckmarkCheckSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={16} {...props}>
      <path
        d="M5 13L9 17L19 7"
        stroke={CANDY.mint}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Edit Avatar Brush / Sparkle SVG
 */
export function EditAvatarSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={18} {...props}>
      <path
        d="M4 20L9 19L19.5 8.5C20.3 7.7 20.3 6.3 19.5 5.5L18.5 4.5C17.7 3.7 16.3 3.7 15.5 4.5L5 15L4 20Z"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14 6L18 10" stroke={CANDY.ink} strokeWidth="2" />
      <circle cx="6" cy="18" r="1" fill={CANDY.pink} />
    </ProfileIconWrapper>
  );
}

/**
 * Trend Growth Arrow SVG
 */
export function TrendGrowthSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={20} {...props}>
      <path
        d="M3 18L9 11L14 15L21 6"
        stroke={CANDY.ink}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 6H21V12"
        stroke={CANDY.ink}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Medal Ribbon SVG
 */
export function MedalRibbonSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 32 32" defaultSize={24} {...props}>
      {/* Ribbons */}
      <path
        d="M10 16L7 28L12 25L16 28L16 18"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M22 16L25 28L20 25L16 28L16 18"
        fill={CANDY.pinkSoft}
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Medal Center Disc */}
      <circle
        cx="16"
        cy="12"
        r="8"
        fill={CANDY.yellowGold}
        stroke={CANDY.ink}
        strokeWidth="2.4"
      />
      <circle
        cx="16"
        cy="12"
        r="5"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="1.5"
      />
      <path
        d="M16 9.5L16.8 11.2L18.5 11.4L17.2 12.5L17.6 14.2L16 13.3L14.4 14.2L14.8 12.5L13.5 11.4L15.2 11.2L16 9.5Z"
        fill={CANDY.pink}
      />
    </ProfileIconWrapper>
  );
}

/**
 * Match Duration Clock Timer SVG
 */
export function ClockTimerSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={14} {...props}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="2.2"
      />
      <path
        d="M12 7V12L15.5 14"
        stroke={CANDY.ink}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Players Multi Group SVG
 */
export function PlayersGroupSvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 24 24" defaultSize={14} {...props}>
      <circle
        cx="9"
        cy="8"
        r="3.5"
        fill={CANDY.blue}
        stroke={CANDY.ink}
        strokeWidth="2"
      />
      <circle
        cx="17"
        cy="9"
        r="2.8"
        fill={CANDY.yellowGold}
        stroke={CANDY.ink}
        strokeWidth="1.8"
      />
      <path
        d="M3.5 19C3.5 15.5 6 14 9 14C12 14 14.5 15.5 14.5 19"
        stroke={CANDY.ink}
        strokeWidth="2"
        strokeLinecap="round"
        fill={CANDY.mint}
      />
      <path
        d="M15 14.5C16.2 14.8 18 15.8 18.5 18"
        stroke={CANDY.ink}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}

/**
 * Retro Arcade Gamepad Empty State SVG
 */
export function RetroGamepadEmptySvg(props: Readonly<ProfileIconProps>) {
  return (
    <ProfileIconWrapper viewBox="0 0 64 64" defaultSize={64} {...props}>
      <rect
        x="8"
        y="16"
        width="48"
        height="32"
        rx="12"
        fill={CANDY.yellow}
        stroke={CANDY.ink}
        strokeWidth="3.5"
      />
      {/* D-Pad */}
      <path
        d="M18 32H28M23 27V37"
        stroke={CANDY.ink}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* Arcade buttons */}
      <circle
        cx="41"
        cy="28"
        r="3.5"
        fill={CANDY.pink}
        stroke={CANDY.ink}
        strokeWidth="2"
      />
      <circle
        cx="48"
        cy="35"
        r="3.5"
        fill={CANDY.mint}
        stroke={CANDY.ink}
        strokeWidth="2"
      />
      <circle
        cx="36"
        cy="37"
        r="2.5"
        fill={CANDY.blue}
        stroke={CANDY.ink}
        strokeWidth="1.8"
      />
      {/* Cord */}
      <path
        d="M32 16V10C32 6 36 6 36 10"
        stroke={CANDY.ink}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </ProfileIconWrapper>
  );
}
