import React from "react";
import { cn } from "@/lib/utils";

interface SvgIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

/**
 * Arcade Trophy Icon for Rankings Header and Champions
 */
export function TrophyArcadeSvg({
  className,
  size = 32,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="trophyGoldGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF275" />
          <stop offset="40%" stopColor="#FFD000" />
          <stop offset="100%" stopColor="#FF9900" />
        </linearGradient>
      </defs>
      {/* Cup Handles */}
      <path
        d="M6 8C3.5 8 3.5 14 6 16C8 17.5 10 17 10 17"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M26 8C28.5 8 28.5 14 26 16C24 17.5 22 17 22 17"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Trophy Cup Body */}
      <path
        d="M8 5H24V14C24 18.5 20.5 21 16 21C11.5 21 8 18.5 8 14V5Z"
        fill="url(#trophyGoldGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Stem */}
      <path
        d="M16 21V25"
        stroke="#2B2D42"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      {/* Pedestal Base */}
      <rect
        x="10"
        y="25"
        width="12"
        height="4"
        rx="2"
        fill="#FF7A00"
        stroke="#2B2D42"
        strokeWidth="2.2"
      />
      {/* Star on Cup */}
      <polygon
        points="16,9 17.2,12 20.5,12 18,13.8 19,17 16,15 13,17 14,13.8 11.5,12 14.8,12"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/**
 * Top 1 Crown Emblem with Gloss
 */
export function Top1CrownBadgeSvg({
  className,
  size = 28,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="top1CrownGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF777" />
          <stop offset="50%" stopColor="#FFD000" />
          <stop offset="100%" stopColor="#FF8800" />
        </linearGradient>
      </defs>
      {/* Crown base shape */}
      <path
        d="M4 23L3 9L10 16L16 5L22 16L29 9L28 23H4Z"
        fill="url(#top1CrownGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Rim band */}
      <rect
        x="3"
        y="21"
        width="26"
        height="6"
        rx="2.5"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      {/* Jewels */}
      <circle cx="10" cy="24" r="1.5" fill="#FFFFFF" />
      <circle cx="16" cy="24" r="1.8" fill="#FFF275" />
      <circle cx="22" cy="24" r="1.5" fill="#FFFFFF" />
      {/* Top gems */}
      <circle
        cx="3"
        cy="9"
        r="2"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="1.2"
      />
      <circle
        cx="16"
        cy="5"
        r="2.5"
        fill="#00D2D3"
        stroke="#2B2D42"
        strokeWidth="1.2"
      />
      <circle
        cx="29"
        cy="9"
        r="2"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/**
 * Top 2 Silver Medal Emblem
 */
export function Top2SilverBadgeSvg({
  className,
  size = 24,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="silverMedalGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#E2E8F0" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>
      </defs>
      {/* Ribbons */}
      <path
        d="M12 4L8 16L13 14"
        fill="#3B82F6"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M20 4L24 16L19 14"
        fill="#60A5FA"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      {/* Circular Medal */}
      <circle
        cx="16"
        cy="18"
        r="11"
        fill="url(#silverMedalGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
      />
      <circle
        cx="16"
        cy="18"
        r="8"
        stroke="#CBD5E1"
        strokeWidth="1.5"
        strokeDasharray="2 2"
      />
      {/* Text #2 */}
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fill="#1E293B"
        fontFamily="sans-serif"
        fontWeight="900"
        fontSize="12"
      >
        2
      </text>
    </svg>
  );
}

/**
 * Top 3 Bronze Medal Emblem
 */
export function Top3BronzeBadgeSvg({
  className,
  size = 24,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="bronzeMedalGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="40%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#92400E" />
        </linearGradient>
      </defs>
      {/* Ribbons */}
      <path
        d="M12 4L8 16L13 14"
        fill="#EF4444"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M20 4L24 16L19 14"
        fill="#F87171"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      {/* Circular Medal */}
      <circle
        cx="16"
        cy="18"
        r="11"
        fill="url(#bronzeMedalGrad)"
        stroke="#2B2D42"
        strokeWidth="2.5"
      />
      <circle
        cx="16"
        cy="18"
        r="8"
        stroke="#F59E0B"
        strokeWidth="1.5"
        strokeDasharray="2 2"
      />
      {/* Text #3 */}
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily="sans-serif"
        fontWeight="900"
        fontSize="12"
      >
        3
      </text>
    </svg>
  );
}

/**
 * Speedometer / Reaction Time Arcade Icon
 */
export function SpeedClockSvg({
  className,
  size = 16,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67E8F9" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <circle
        cx="10"
        cy="11"
        r="7.5"
        fill="url(#speedGrad)"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />
      {/* Stop button top */}
      <path
        d="M8 2.5H12"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10 2.5V4.5"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Dial needle pointing fast */}
      <path
        d="M10 11L13.5 7.5"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="10"
        cy="11"
        r="2"
        fill="#FFFFFF"
        stroke="#2B2D42"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/**
 * Bullseye / Accuracy Target Arcade Icon
 */
export function TargetAccuracySvg({
  className,
  size = 16,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      {/* Outer ring */}
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="#FFE4E6"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />
      {/* Middle ring */}
      <circle
        cx="10"
        cy="10"
        r="5"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="1.5"
      />
      {/* Inner bullseye */}
      <circle
        cx="10"
        cy="10"
        r="2.2"
        fill="#FFFFFF"
        stroke="#2B2D42"
        strokeWidth="1.2"
      />
      {/* Crosshairs */}
      <path
        d="M10 1V3M10 17V19M1 10H3M17 10H19"
        stroke="#2B2D42"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Weekly Calendar / Period Icon
 */
export function WeeklyPeriodSvg({
  className,
  size = 18,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="3"
        y="4"
        width="14"
        height="13"
        rx="3"
        fill="#CCFBF1"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />
      <path d="M3 8H17" stroke="#2B2D42" strokeWidth="1.8" />
      {/* Pins */}
      <path
        d="M6 2V5M14 2V5"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Trend line inside calendar */}
      <path
        d="M6 14L8.5 11.5L11 13.5L14 10"
        stroke="#0D9488"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * All-Time Infinity / Globe Icon
 */
export function AllTimePeriodSvg({
  className,
  size = 18,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="#FEF08A"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />
      <ellipse
        cx="10"
        cy="10"
        rx="3.5"
        ry="7.5"
        stroke="#2B2D42"
        strokeWidth="1.5"
      />
      <path d="M3 10H17" stroke="#2B2D42" strokeWidth="1.5" />
      <circle cx="7" cy="7" r="1" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * Flash Sparkle Star for Top 1 aura
 */
export function FlashStarSvg({
  className,
  size = 20,
  ...props
}: Readonly<SvgIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"
        fill="#FFD000"
        stroke="#2B2D42"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" fill="#FFFFFF" />
    </svg>
  );
}
