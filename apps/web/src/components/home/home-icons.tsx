import React from "react";
import { cn } from "@/lib/utils";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

function getGradientId(
  prefix: string,
  explicitId?: string,
  instanceId?: string,
): string {
  if (explicitId) return `${prefix}-${explicitId}`;
  if (instanceId) return `${prefix}-${instanceId}`;
  return prefix;
}

/**
 * Candy Svg Icon - wrapped juicy candy (Candy Crush style)
 */
export function CandySvg({
  className,
  size = 64,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const pinkGradId = getGradientId("candyPinkGrad", id, autoId);
  const yellowGradId = getGradientId("candyYellowGrad", id, autoId);

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("drop-shadow-[3px_3px_0_#2B2D42]", className)}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={pinkGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF94B4" />
          <stop offset="100%" stopColor="#FF4370" />
        </linearGradient>
        <linearGradient id={yellowGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF275" />
          <stop offset="100%" stopColor="#FFAA00" />
        </linearGradient>
      </defs>
      {/* Left Wrapper Twist */}
      <path
        d="M8 20L20 28L8 36L12 28L8 20Z"
        fill={`url(#${yellowGradId})`}
        stroke="#2B2D42"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* Right Wrapper Twist */}
      <path
        d="M56 20L44 28L56 36L52 28L56 20Z"
        fill={`url(#${yellowGradId})`}
        stroke="#2B2D42"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* Candy Body */}
      <rect
        x="16"
        y="16"
        width="32"
        height="24"
        rx="12"
        fill={`url(#${pinkGradId})`}
        stroke="#2B2D42"
        strokeWidth="3.5"
      />
      {/* Candy Stripes */}
      <path
        d="M26 17C28 21 28 35 26 39"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M34 17C36 21 36 35 34 39"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Glossy Top Highlight */}
      <ellipse cx="24" cy="21" rx="4" ry="2" fill="#FFFFFF" opacity="0.8" />
    </svg>
  );
}

/**
 * Donut Svg Icon - colorful frosted donut
 */
export function DonutSvg({
  className,
  size = 64,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const doughGradId = getGradientId("donutDough", id, autoId);
  const frostingGradId = getGradientId("donutFrosting", id, autoId);

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("drop-shadow-[3px_3px_0_#2B2D42]", className)}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={doughGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD382" />
          <stop offset="100%" stopColor="#E59830" />
        </linearGradient>
        <linearGradient id={frostingGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF9EC0" />
          <stop offset="100%" stopColor="#FF5588" />
        </linearGradient>
      </defs>
      {/* Donut Base Dough */}
      <circle
        cx="32"
        cy="32"
        r="24"
        fill={`url(#${doughGradId})`}
        stroke="#2B2D42"
        strokeWidth="3.5"
      />
      {/* Pink Frosting */}
      <path
        d="M32 10C44 10 54 20 54 32C54 35 50 37 47 35C44 33 42 36 41 39C40 42 36 43 34 41C31 39 28 43 25 43C22 43 20 40 18 41C15 42 12 39 12 36C10 33 10 32 10 32C10 20 20 10 32 10Z"
        fill={`url(#${frostingGradId})`}
        stroke="#2B2D42"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Donut Center Hole */}
      <circle
        cx="32"
        cy="32"
        r="8.5"
        fill="#FFF9E6"
        stroke="#2B2D42"
        strokeWidth="3.5"
      />
      {/* Sprinkles */}
      <path
        d="M22 19L26 21"
        stroke="#2EC4B6"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M38 17L42 19"
        stroke="#FFD000"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M44 27L47 30"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M18 29L21 31"
        stroke="#FFD000"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M28 39L31 38"
        stroke="#2EC4B6"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Star Svg Icon - bold arcade star
 */
export function StarSvg({
  className,
  size = 64,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const starGradId = getGradientId("starGrad", id, autoId);

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("drop-shadow-[3px_3px_0_#2B2D42]", className)}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={starGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF275" />
          <stop offset="100%" stopColor="#FFAA00" />
        </linearGradient>
      </defs>
      <path
        d="M32 6L39.5 22.5L57 24.5L44 36.5L47.5 54L32 45L16.5 54L20 36.5L7 24.5L24.5 22.5L32 6Z"
        fill={`url(#${starGradId})`}
        stroke="#2B2D42"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="28" cy="23" r="3.5" fill="#FFFFFF" opacity="0.9" />
    </svg>
  );
}

/**
 * Balloon Svg Icon - festive candy balloon
 */
export function BalloonSvg({
  className,
  size = 64,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const balloonGradId = getGradientId("balloonGrad", id, autoId);

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("drop-shadow-[3px_3px_0_#2B2D42]", className)}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={balloonGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF85A2" />
          <stop offset="100%" stopColor="#EF476F" />
        </linearGradient>
      </defs>
      <path
        d="M32 48C30 52 34 56 32 60"
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <polygon
        points="29,48 35,48 32,44"
        fill="#EF476F"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <ellipse
        cx="32"
        cy="26"
        rx="20"
        ry="22"
        fill={`url(#${balloonGradId})`}
        stroke="#2B2D42"
        strokeWidth="3.5"
      />
      <path
        d="M22 14C26 10 32 10 36 12"
        stroke="#FFFFFF"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

/**
 * Sparkle Svg Icon - 4-pointed neon sparkle
 */
export function SparkleSvg({
  className,
  size = 48,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("drop-shadow-[2px_2px_0_#2B2D42]", className)}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M24 4C24 15 33 24 44 24C33 24 24 33 24 44C24 33 15 24 4 24C15 24 24 15 24 4Z"
        fill="#FFD000"
        stroke="#2B2D42"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="3.5" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * Crown Svg Icon - Juicy 3D Royal Gold Crown (Candy Crush / Subway Surfers Style)
 */
export function CrownSvg({
  className,
  size = 64,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const crownGoldId = getGradientId("crownGold", id, autoId);
  const gemRedId = getGradientId("gemRed", id, autoId);
  const gemCyanId = getGradientId("gemCyan", id, autoId);

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("drop-shadow-[3px_3px_0_#2B2D42]", className)}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={crownGoldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF47D" />
          <stop offset="35%" stopColor="#FFD000" />
          <stop offset="100%" stopColor="#FF9000" />
        </linearGradient>
        <linearGradient id={gemRedId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF85A2" />
          <stop offset="100%" stopColor="#E60039" />
        </linearGradient>
        <linearGradient id={gemCyanId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#80FFDB" />
          <stop offset="100%" stopColor="#00B4D8" />
        </linearGradient>
      </defs>

      {/* Main Crown Geometry */}
      <path
        d="M8 48L6 20L20 32L32 10L44 32L58 20L56 48H8Z"
        fill={`url(#${crownGoldId})`}
        stroke="#2B2D42"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      {/* Bottom Rim Bar */}
      <rect
        x="6"
        y="44"
        width="52"
        height="10"
        rx="4"
        fill="#FF7A00"
        stroke="#2B2D42"
        strokeWidth="3.5"
      />

      {/* Peak Jewels */}
      <circle
        cx="6"
        cy="19"
        r="4"
        fill={`url(#${gemRedId})`}
        stroke="#2B2D42"
        strokeWidth="2.5"
      />
      <circle
        cx="32"
        cy="9"
        r="5"
        fill={`url(#${gemCyanId})`}
        stroke="#2B2D42"
        strokeWidth="2.5"
      />
      <circle
        cx="58"
        cy="19"
        r="4"
        fill={`url(#${gemRedId})`}
        stroke="#2B2D42"
        strokeWidth="2.5"
      />

      {/* Rim Inset Jewels */}
      <circle
        cx="20"
        cy="49"
        r="2.5"
        fill={`url(#${gemCyanId})`}
        stroke="#2B2D42"
        strokeWidth="1.5"
      />
      <circle
        cx="32"
        cy="49"
        r="3"
        fill="#FFFFFF"
        stroke="#2B2D42"
        strokeWidth="1.5"
      />
      <circle
        cx="44"
        cy="49"
        r="2.5"
        fill={`url(#${gemCyanId})`}
        stroke="#2B2D42"
        strokeWidth="1.5"
      />

      {/* Gloss Highlight Arc */}
      <path
        d="M14 46C20 45 44 45 50 46"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

/**
 * Flame Svg Icon - Juicy Candy Flame Streak (Subway Surfers Multiplier / Candy Crush Style)
 */
export function FlameSvg({
  className,
  size = 24,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const flameOuterId = getGradientId("flameOuter", id, autoId);
  const flameInnerId = getGradientId("flameInner", id, autoId);

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={flameOuterId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF4D4D" />
          <stop offset="50%" stopColor="#FF7A00" />
          <stop offset="100%" stopColor="#FFB800" />
        </linearGradient>
        <linearGradient id={flameInnerId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF777" />
          <stop offset="100%" stopColor="#FFD000" />
        </linearGradient>
      </defs>

      {/* Outer Fire Body */}
      <path
        d="M16 2C19 6 26 10 26 18C26 24 21.5 28 16 28C10.5 28 6 24 6 18C6 13 10 9 12 7C12 9 13.5 11 15 11C13.5 8.5 14 5.5 16 2Z"
        fill={`url(#${flameOuterId})`}
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Inner Core Flame */}
      <path
        d="M16 14C18 16 20 18 20 21C20 23.5 18 25 16 25C14 25 12 23.5 12 21C12 19 14 17 16 14Z"
        fill={`url(#${flameInnerId})`}
      />

      {/* Gloss Dot */}
      <ellipse cx="14" cy="18" rx="1.5" ry="3" fill="#FFFFFF" opacity="0.8" />
    </svg>
  );
}

/**
 * Gamepad Svg Icon - Arcade Controller (Subway Surfers Neo-Brutalist Style)
 */
export function GamepadSvg({
  className,
  size = 24,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const padGradId = getGradientId("padGrad", id, autoId);

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={padGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFDF6" />
          <stop offset="100%" stopColor="#EAE5D9" />
        </linearGradient>
      </defs>
      <rect
        x="3"
        y="7"
        width="26"
        height="18"
        rx="8"
        fill={`url(#${padGradId})`}
        stroke="#2B2D42"
        strokeWidth="2.8"
      />
      {/* D-pad Plus */}
      <path
        d="M8 16H14M11 13V19"
        stroke="#2B2D42"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      {/* Action Buttons */}
      <circle
        cx="20"
        cy="17.5"
        r="2"
        fill="#FF4370"
        stroke="#2B2D42"
        strokeWidth="1.5"
      />
      <circle
        cx="23.5"
        cy="14"
        r="2"
        fill="#00D2D3"
        stroke="#2B2D42"
        strokeWidth="1.5"
      />
      {/* Gloss Line */}
      <path
        d="M9 10H23"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Smiley Svg Icon - playful wink/grin face
 */
export function SmileySvg({
  className,
  size = 18,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle
        cx="10"
        cy="10"
        r="8.5"
        fill="#FFD000"
        stroke="#2B2D42"
        strokeWidth="2"
      />
      <circle cx="7" cy="8" r="1.2" fill="#2B2D42" />
      <circle cx="13" cy="8" r="1.2" fill="#2B2D42" />
      <path
        d="M6.5 12C7.5 14 12.5 14 13.5 12"
        stroke="#2B2D42"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * BombSvg - 3D Cartoon Candy Bomb with burning spark (Candy Crush / Royale knockout style)
 */
export function BombSvg({
  className,
  size = 24,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const bombBodyId = getGradientId("bombBody", id, autoId);
  const fuseSparkId = getGradientId("fuseSpark", id, autoId);

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={bombBodyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A4E69" />
          <stop offset="50%" stopColor="#22223B" />
          <stop offset="100%" stopColor="#1E1F30" />
        </linearGradient>
        <linearGradient id={fuseSparkId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF275" />
          <stop offset="100%" stopColor="#FF4D4D" />
        </linearGradient>
      </defs>

      {/* Burning Spark at tip */}
      <path
        d="M24 3L25.5 6L28.5 7.5L25.5 9L24 12L22.5 9L19.5 7.5L22.5 6L24 3Z"
        fill={`url(#${fuseSparkId})`}
      />
      <circle cx="24" cy="7.5" r="1.5" fill="#FFFFFF" />

      {/* Fuse rope */}
      <path
        d="M17 12C19 9 21 8 23 8"
        stroke="#D4A373"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Fuse Cap / Neck */}
      <rect
        x="13"
        y="10"
        width="6"
        height="3.5"
        rx="1.5"
        fill="#FFD000"
        stroke="#2B2D42"
        strokeWidth="1.8"
      />

      {/* Bomb Main Sphere */}
      <circle
        cx="16"
        cy="20"
        r="10"
        fill={`url(#${bombBodyId})`}
        stroke="#2B2D42"
        strokeWidth="2.5"
      />

      {/* Gloss Arc Highlight */}
      <path
        d="M11 15C13 13 16 13 18 14"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

/**
 * SparkleSmall Svg Icon - small sparkle star for badges
 */
export function SparkleSmallSvg({
  className,
  size = 16,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M8 1C8 4.5 11.5 8 15 8C11.5 8 8 11.5 8 15C8 11.5 4.5 8 1 8C4.5 8 8 4.5 8 1Z"
        fill="#FFD000"
        stroke="#2B2D42"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * UserCheck Svg Icon
 */
export function UserCheckSvg({
  className,
  size = 20,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  );
}

/**
 * ArrowRight Svg Icon
 */
export function ArrowRightSvg({
  className,
  size = 20,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/**
 * Zap Svg Icon - 3D lightning bolt
 */
export function ZapSvg({
  className,
  size = 16,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const zapGradId = getGradientId("zapGrad", id, autoId);

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={zapGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF566" />
          <stop offset="100%" stopColor="#FF9900" />
        </linearGradient>
      </defs>
      <polygon
        points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
        fill={`url(#${zapGradId})`}
        stroke="#2B2D42"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * ShieldCheck Svg Icon - 3D Candy Blue Shield
 */
export function ShieldCheckSvg({
  className,
  size = 24,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const shieldGradId = getGradientId("shieldGrad", id, autoId);

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={shieldGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <path
        d="M12 2L4 5V11C4 16.5 7.5 21 12 22C16.5 21 20 16.5 20 11V5L12 2Z"
        fill={`url(#${shieldGradId})`}
        stroke="#2B2D42"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="m8.5 11.5 2.5 2.5 5-5"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * SettingsGear Svg Icon - 3D Arcade Cog / Gear with clear center axle hole
 */
export function SettingsGearSvg({
  className,
  size = 22,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const gearGradId = getGradientId("gearGrad", id, autoId);

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        <linearGradient id={gearGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF475" />
          <stop offset="50%" stopColor="#FFC800" />
          <stop offset="100%" stopColor="#FF8800" />
        </linearGradient>
      </defs>

      {/* 3D Gear Body with 6 prominent teeth */}
      <path
        d="M13.5 2H18.5L19.5 6.2C20.7 6.7 21.8 7.3 22.8 8.1L26.8 6.4L29.8 10.4L27 13.7C27.2 14.5 27.3 15.2 27.3 16C27.3 16.8 27.2 17.5 27 18.3L29.8 21.6L26.8 25.6L22.8 23.9C21.8 24.7 20.7 25.3 19.5 25.8L18.5 30H13.5L12.5 25.8C11.3 25.3 10.2 24.7 9.2 23.9L5.2 25.6L2.2 21.6L5 18.3C4.8 17.5 4.7 16.8 4.7 16C4.7 15.2 4.8 14.5 5 13.7L2.2 10.4L5.2 6.4L9.2 8.1C10.2 7.3 11.3 6.7 12.5 6.2L13.5 2Z"
        fill={`url(#${gearGradId})`}
        stroke="#2B2D42"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />

      {/* Center Gear Hub / Axle Hole */}
      <circle
        cx="16"
        cy="16"
        r="5.5"
        fill="#2B2D42"
        stroke="#2B2D42"
        strokeWidth="1"
      />

      {/* Inner Hole Cutout */}
      <circle cx="16" cy="16" r="3.8" fill="#FFF8E7" />

      {/* Top Gloss Arc */}
      <path
        d="M11 7C13 5.5 19 5.5 21 7"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

/**
 * Swords Svg Icon - High-Quality 3D Clash Swords (Clash Royale / Brawl Stars Arcade Style)
 */
export function SwordsSvg({
  className,
  size = 24,
  id,
  ...props
}: Readonly<IconProps>) {
  const autoId = React.useId();
  const bladeLightId = getGradientId("bladeLight", id, autoId);
  const bladeDarkId = getGradientId("bladeDark", id, autoId);
  const goldHiltId = getGradientId("goldHilt", id, autoId);

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      id={id}
      {...props}
    >
      <defs>
        {/* Blade Highlight Side (Left) */}
        <linearGradient id={bladeLightId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E2E8F0" />
        </linearGradient>
        {/* Blade Shade Side (Right) */}
        <linearGradient id={bladeDarkId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#CBD5E1" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>
        {/* Golden Crossguard & Pommel */}
        <linearGradient id={goldHiltId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF566" />
          <stop offset="50%" stopColor="#FFC800" />
          <stop offset="100%" stopColor="#FF9000" />
        </linearGradient>
      </defs>

      {/* Sword 1: Rotated -45deg (pointing up-right) */}
      <g transform="translate(16, 16) rotate(-45)">
        {/* Blade Outline & Fill */}
        <path
          d="M0 -14L-2.8 -10L-2.8 2.5L2.8 2.5L2.8 -10L0 -14Z"
          fill={`url(#${bladeDarkId})`}
          stroke="#2B2D42"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Blade Left Light Bevel */}
        <path
          d="M0 -13.5L-2 -9.5L-2 2.5L0 2.5L0 -13.5Z"
          fill={`url(#${bladeLightId})`}
        />

        {/* Golden Curved Crossguard */}
        <path
          d="M-6.5 2C-6.5 0.8 6.5 0.8 6.5 2L5.5 5.5C2 4.5 -2 4.5 -5.5 5.5L-6.5 2Z"
          fill={`url(#${goldHiltId})`}
          stroke="#2B2D42"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Center Guard Gem */}
        <circle cx="0" cy="3" r="1.2" fill="#FF4370" />

        {/* Handle Grip */}
        <rect
          x="-1.6"
          y="5.5"
          width="3.2"
          height="5.5"
          rx="1"
          fill="#475569"
          stroke="#2B2D42"
          strokeWidth="1.6"
        />

        {/* Golden Pommel */}
        <circle
          cx="0"
          cy="12"
          r="2.2"
          fill={`url(#${goldHiltId})`}
          stroke="#2B2D42"
          strokeWidth="1.6"
        />
      </g>

      {/* Sword 2: Rotated +45deg (pointing up-left) */}
      <g transform="translate(16, 16) rotate(45)">
        {/* Blade Outline & Fill */}
        <path
          d="M0 -14L-2.8 -10L-2.8 2.5L2.8 2.5L2.8 -10L0 -14Z"
          fill={`url(#${bladeDarkId})`}
          stroke="#2B2D42"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Blade Left Light Bevel */}
        <path
          d="M0 -13.5L-2 -9.5L-2 2.5L0 2.5L0 -13.5Z"
          fill={`url(#${bladeLightId})`}
        />

        {/* Golden Curved Crossguard */}
        <path
          d="M-6.5 2C-6.5 0.8 6.5 0.8 6.5 2L5.5 5.5C2 4.5 -2 4.5 -5.5 5.5L-6.5 2Z"
          fill={`url(#${goldHiltId})`}
          stroke="#2B2D42"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Center Guard Gem */}
        <circle cx="0" cy="3" r="1.2" fill="#FF4370" />

        {/* Handle Grip */}
        <rect
          x="-1.6"
          y="5.5"
          width="3.2"
          height="5.5"
          rx="1"
          fill="#475569"
          stroke="#2B2D42"
          strokeWidth="1.6"
        />

        {/* Golden Pommel */}
        <circle
          cx="0"
          cy="12"
          r="2.2"
          fill={`url(#${goldHiltId})`}
          stroke="#2B2D42"
          strokeWidth="1.6"
        />
      </g>

      {/* Central Clash Impact Sparkle */}
      <path
        d="M16 11.5Q16 16 11.5 16Q16 16 16 20.5Q16 16 20.5 16Q16 16 16 11.5Z"
        fill="#FFF275"
        stroke="#FF9900"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="1.5" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * Close Svg Icon
 */
export function CloseSvg({
  className,
  size = 20,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/**
 * Globe Svg Icon
 */
export function GlobeSvg({
  className,
  size = 20,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8" />
      <path d="M3.6 15h16.8" />
      <path d="M12 3a14.5 14.5 0 0 0 0 18" />
      <path d="M12 3a14.5 14.5 0 0 1 0 18" />
    </svg>
  );
}

/**
 * Scroll Svg Icon
 */
export function ScrollSvg({
  className,
  size = 24,
  ...props
}: Readonly<IconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-2H10a2 2 0 0 0-2 2v2Z" />
      <path d="M4 3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4v-2a2 2 0 0 1 2-2h9" />
      <path d="M8 7h7" />
      <path d="M8 11h5" />
    </svg>
  );
}
