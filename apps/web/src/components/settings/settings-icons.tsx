import React from "react";
import { cn } from "@/lib/utils";

export interface SettingsIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

/**
 * Settings Gear Svg - Neo-brutalist candy gear
 */
export function SettingsHeroGearSvg({
  className,
  size = 32,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="2.5"
      />
      <circle
        cx="16"
        cy="16"
        r="4.5"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="2.2"
      />
      <path
        d="M16 2.5V5.5M16 26.5V29.5M2.5 16H5.5M26.5 16H29.5M6.5 6.5L8.7 8.7M23.3 23.3L25.5 25.5M6.5 25.5L8.7 23.3M23.3 8.7L25.5 6.5"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="14.5" cy="14.5" r="1.2" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * User Profile Badge Svg
 */
export function UserBadgeSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <circle
        cx="12"
        cy="8"
        r="4.5"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M4 20C4 16.5 7.5 14.5 12 14.5C16.5 14.5 20 16.5 20 20"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
        fill="#70D6FF"
      />
      <circle cx="10.5" cy="6.5" r="1" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * Sound Volume Svg
 */
export function VolumeHighSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
        d="M3 9.5H7L12 5V19L7 14.5H3V9.5Z"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 8.5C16.8 9.8 17.5 11 17.5 12C17.5 13 16.8 14.2 15.5 15.5"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M18.5 5.5C20.8 7.8 22 10 22 12C22 14 20.8 16.2 18.5 18.5"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Sound Mute Svg
 */
export function VolumeMuteSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
        d="M3 9.5H7L12 5V19L7 14.5H3V9.5Z"
        fill="#A0A5B5"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M16 9L21 15M21 9L16 15"
        stroke="#FF4370"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Music Note Svg
 */
export function MusicNoteSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <circle
        cx="7"
        cy="17"
        r="3.5"
        fill="#FFD166"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <circle
        cx="17"
        cy="14"
        r="3.5"
        fill="#06D6A0"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M10.5 17V7.5L20.5 4.5V14"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10.5 10.5L20.5 7.5"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Gamepad / Controller Svg
 */
export function GamepadSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <rect
        x="3"
        y="6"
        width="18"
        height="12"
        rx="6"
        fill="#70D6FF"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      {/* D-Pad */}
      <path
        d="M6 12H10M8 10V14"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Action buttons */}
      <circle cx="15.5" cy="10.5" r="1" fill="#FF4370" />
      <circle cx="17.5" cy="13.5" r="1" fill="#FFE45E" />
    </svg>
  );
}

/**
 * Keyboard Svg
 */
export function KeyboardSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="3"
        fill="#FFF9E6"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <rect x="5.5" y="8" width="2" height="2" rx="0.5" fill="#2B2D42" />
      <rect x="9.5" y="8" width="2" height="2" rx="0.5" fill="#2B2D42" />
      <rect x="13.5" y="8" width="2" height="2" rx="0.5" fill="#2B2D42" />
      <rect x="17.5" y="8" width="2" height="2" rx="0.5" fill="#2B2D42" />
      <rect x="7" y="14" width="10" height="2" rx="0.5" fill="#FF4370" />
    </svg>
  );
}

/**
 * Palette / Theme Svg
 */
export function PaletteSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
        d="M12 3C7 3 3 7 3 12C3 16.5 6.5 20 11 20C12.5 20 13.5 19 13.5 17.5C13.5 16.8 13.2 16.2 12.8 15.7C12.4 15.2 12.2 14.6 12.2 14C12.2 12.6 13.4 11.5 14.8 11.5H16.5C19 11.5 21 9.5 21 7C21 4.8 17 3 12 3Z"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <circle cx="7.5" cy="9.5" r="1.5" fill="#FF4370" />
      <circle cx="11" cy="7" r="1.5" fill="#06D6A0" />
      <circle cx="15.5" cy="7.5" r="1.5" fill="#70D6FF" />
    </svg>
  );
}

/**
 * Sparkles Candy Svg
 */
export function SparklesCandySvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
        d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z"
        fill="#FFD166"
        stroke="#2B2D42"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M18 16L19 19L22 20L19 21L18 24L17 21L14 20L17 19L18 16Z"
        fill="#FF4370"
      />
    </svg>
  );
}

/**
 * Globe / Language Svg
 */
export function GlobeSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="#70D6FF"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M3.5 12H20.5M12 3C14.5 6 16 9 16 12C16 15 14.5 18 12 21C9.5 18 8 15 8 12C8 9 9.5 6 12 3Z"
        stroke="#2B2D42"
        strokeWidth="1.8"
        fill="none"
      />
    </svg>
  );
}

/**
 * Reset Rotate Svg
 */
export function ResetRotateSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
        d="M4 12A8 8 0 1 1 6.5 17.5L3.5 18"
        stroke="#2B2D42"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M4 7V12H9"
        stroke="#2B2D42"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Trash Can Svg
 */
export function TrashCanSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
        d="M5 7H19M10 11V16M14 11V16M6 7L7.5 19.5C7.6 20.3 8.3 21 9.1 21H14.9C15.7 21 16.4 20.3 16.5 19.5L18 7M9 7V4.5C9 4 9.5 3.5 10 3.5H14C14.5 3.5 15 4 15 4.5V7"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Checkmark Badge Svg
 */
export function CheckmarkBadgeSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="#06D6A0"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M8 12L11 15L16 9"
        stroke="#2B2D42"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * System / Sliders Svg
 */
export function SlidersConfigSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
        d="M4 7H12M16 7H20M4 17H8M12 17H20M4 12H16M20 12H20"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="14"
        cy="7"
        r="2"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />
      <circle
        cx="18"
        cy="12"
        r="2"
        fill="#FFE45E"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />
      <circle
        cx="10"
        cy="17"
        r="2"
        fill="#06D6A0"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />
    </svg>
  );
}

/**
 * Bell / Notification / Vibrate Svg
 */
export function VibrateHapticSvg({
  className,
  size = 24,
  ...props
}: Readonly<SettingsIconProps>) {
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
      <rect
        x="8"
        y="4"
        width="8"
        height="16"
        rx="2.5"
        fill="#FFF9E6"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <path
        d="M4 8C3 10 3 14 4 16M20 8C21 10 21 14 20 16"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.5" r="1" fill="#2B2D42" />
    </svg>
  );
}
