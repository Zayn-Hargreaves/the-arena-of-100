"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ProfessorMood } from "./professor-roast-engine";

export type ProfessorAvatarSize = "sm" | "md" | "lg" | "xl";

export interface ProfessorAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  mood?: ProfessorMood;
  size?: ProfessorAvatarSize;
  showNameplate?: boolean;
  animated?: boolean;
}

const SIZE_MAP: Record<ProfessorAvatarSize, string> = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-36 h-36",
  xl: "w-48 h-48",
};

export const ProfessorAvatar: React.FC<ProfessorAvatarProps> = ({
  mood = "idle",
  size = "md",
  showNameplate = false,
  animated = true,
  className,
  ...props
}) => {
  const t = useTranslations("Professor");

  return (
    <div
      className={cn(
        "relative flex flex-col items-center select-none",
        className,
      )}
      {...props}
    >
      {/* Mood Effect FX Overlay (Vector SVG Graphics) */}
      {mood === "proud_cheer" && (
        <div className="absolute -top-3 -right-2 w-6 h-6 animate-bounce pointer-events-none z-20">
          <svg viewBox="0 0 24 24" className="w-full h-full" fill="none">
            <path
              d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"
              fill="#FFD000"
              stroke="#2B2D42"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
      {mood === "proud_cheer" && (
        <div className="absolute -top-2 -left-2 w-5 h-5 animate-pulse pointer-events-none z-20">
          <svg viewBox="0 0 24 24" className="w-full h-full" fill="none">
            <polygon
              points="12,2 15,8.5 22,9.5 17,14.5 18.5,21.5 12,18 5.5,21.5 7,14.5 2,9.5 9,8.5"
              fill="#FF85A2"
              stroke="#2B2D42"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
      {mood === "ticking_panic" && (
        <div className="absolute -top-2 right-1 w-5 h-5 animate-bounce pointer-events-none z-20">
          <svg viewBox="0 0 24 24" className="w-full h-full" fill="none">
            <path
              d="M12 3C12 3 6 11 6 15.5C6 18.8 8.7 21.5 12 21.5C15.3 21.5 18 18.8 18 15.5C18 11 12 3 12 3Z"
              fill="#38BDF8"
              stroke="#2B2D42"
              strokeWidth="2"
            />
          </svg>
        </div>
      )}
      {mood === "angry_roast" && (
        <div className="absolute -top-3 left-1 w-6 h-6 animate-bounce pointer-events-none z-20">
          <svg viewBox="0 0 24 24" className="w-full h-full" fill="none">
            <path
              d="M5 8C9 8 9 4 9 4M15 4C15 4 15 8 19 8M19 16C15 16 15 20 15 20M9 20C9 20 9 16 5 16"
              stroke="#EF4444"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}

      {/* Main Dr. Labo (Brain Genius) Character Vector Animation */}
      <div
        className={cn(
          SIZE_MAP[size],
          "relative flex items-center justify-center filter drop-shadow-[0_4px_6px_rgba(0,0,0,0.18)]",
          animated && mood === "ticking_panic" && "drlabo-panic",
          animated && mood === "proud_cheer" && "drlabo-cheer",
          animated &&
            mood !== "ticking_panic" &&
            mood !== "proud_cheer" &&
            "drlabo-animated-body",
        )}
      >
        <svg
          viewBox="0 0 120 120"
          className="w-full h-full overflow-visible"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          focusable="false"
        >
          {/* Shadow */}
          <ellipse
            cx="60"
            cy="115"
            rx="38"
            ry="6"
            fill="#000000"
            fillOpacity="0.2"
          />

          {/* Academic Robe / Gown Body (Navy Blue) */}
          <path
            d="M26 114C24 92 36 84 60 84C84 84 96 92 94 114H26Z"
            fill="#1E293B"
            stroke="#2B2D42"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />

          {/* Robe Collar & White Shirt V */}
          <path
            d="M48 84L60 102L72 84"
            fill="#FFFFFF"
            stroke="#2B2D42"
            strokeWidth="3"
            strokeLinejoin="round"
          />

          {/* Bright Red Necktie */}
          <polygon
            points="55,90 65,90 60,104"
            fill="#EF4444"
            stroke="#2B2D42"
            strokeWidth="2"
          />
          <circle
            cx="60"
            cy="90"
            r="3"
            fill="#DC2626"
            stroke="#2B2D42"
            strokeWidth="1.5"
          />

          {/* Left Arm holding Clipboard */}
          <g transform="translate(80, 80)">
            {/* Clipboard board */}
            <rect
              x="0"
              y="0"
              width="24"
              height="30"
              rx="3"
              fill="#D97706"
              stroke="#2B2D42"
              strokeWidth="2.5"
              transform="rotate(12)"
            />
            {/* Paper sheet */}
            <rect
              x="3"
              y="4"
              width="18"
              height="22"
              rx="1.5"
              fill="#FFFFFF"
              stroke="#2B2D42"
              strokeWidth="1.5"
              transform="rotate(12)"
            />
            {/* Gold Clip */}
            <rect
              x="8"
              y="-2"
              width="8"
              height="5"
              rx="1"
              fill="#F59E0B"
              stroke="#2B2D42"
              strokeWidth="1.5"
              transform="rotate(12)"
            />
            {/* Hand */}
            <circle
              cx="6"
              cy="18"
              r="5"
              fill="#FFE2CD"
              stroke="#2B2D42"
              strokeWidth="2.5"
            />
          </g>

          {/* Right Arm & Pointer Stick (Animated waving) */}
          <g className={animated ? "drlabo-animated-pointer" : ""}>
            {/* Hand sleeve */}
            <path
              d="M32 94C24 94 20 86 24 80"
              stroke="#1E293B"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Hand */}
            <circle
              cx="22"
              cy="78"
              r="5"
              fill="#FFE2CD"
              stroke="#2B2D42"
              strokeWidth="2.5"
            />
            {/* Pointer Stick (Silver wand with gold tip) */}
            <line
              x1="22"
              y1="78"
              x2="10"
              y2="28"
              stroke="#94A3B8"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle
              cx="10"
              cy="28"
              r="3.5"
              fill="#F59E0B"
              stroke="#2B2D42"
              strokeWidth="2"
            />
          </g>

          {/* Ears */}
          <circle
            cx="27"
            cy="58"
            r="6.5"
            fill="#FFE2CD"
            stroke="#2B2D42"
            strokeWidth="3"
          />
          <circle
            cx="93"
            cy="58"
            r="6.5"
            fill="#FFE2CD"
            stroke="#2B2D42"
            strokeWidth="3"
          />

          {/* Head & Face Base */}
          <path
            d="M30 56C30 38 42 28 60 28C78 28 90 38 90 56C90 72 78 80 60 80C42 80 30 72 30 56Z"
            fill={mood === "angry_roast" ? "#FECDD3" : "#FFE2CD"}
            stroke="#2B2D42"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />

          {/* Fluffy White Hair Tufts on Sides */}
          <path
            d="M26 56C18 52 16 38 26 34C20 28 30 24 38 28"
            fill="#FFFFFF"
            stroke="#2B2D42"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M94 56C102 52 104 38 94 34C100 28 90 24 82 28"
            fill="#FFFFFF"
            stroke="#2B2D42"
            strokeWidth="3"
            strokeLinejoin="round"
          />

          {/* Pointed White Goatee Beard (Classic Dr. Labo feature!) */}
          <path
            d="M50 72L60 92L70 72Z"
            fill="#FFFFFF"
            stroke="#2B2D42"
            strokeWidth="3"
            strokeLinejoin="round"
          />

          {/* Eyebrows (White & Bushy above spectacles) */}
          {mood === "angry_roast" ? (
            <>
              <line
                x1="38"
                y1="42"
                x2="52"
                y2="47"
                stroke="#2B2D42"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              <line
                x1="82"
                y1="42"
                x2="68"
                y2="47"
                stroke="#2B2D42"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
            </>
          ) : mood === "shocked" || mood === "ticking_panic" ? (
            <>
              <path
                d="M38 40C44 36 48 36 52 40"
                stroke="#2B2D42"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M82 40C76 36 72 36 68 40"
                stroke="#2B2D42"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </>
          ) : (
            <>
              <path
                d="M36 42C42 38 48 38 52 42"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M36 42C42 38 48 38 52 42"
                stroke="#2B2D42"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M84 42C78 38 72 38 68 42"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M84 42C78 38 72 38 68 42"
                stroke="#2B2D42"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </>
          )}

          {/* Glasses Frame & Bridge */}
          <line
            x1="52"
            y1="52"
            x2="68"
            y2={mood === "shocked" ? "56" : "52"}
            stroke="#2B2D42"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Left Glass Oval */}
          <ellipse
            cx="44"
            cy="52"
            rx="11"
            ry="10"
            fill="#E0F2FE"
            fillOpacity="0.8"
            stroke="#2B2D42"
            strokeWidth="3.5"
          />
          {/* Right Glass Oval */}
          <ellipse
            cx="76"
            cy={mood === "shocked" ? "56" : "52"}
            rx="11"
            ry="10"
            fill="#E0F2FE"
            fillOpacity="0.8"
            stroke="#2B2D42"
            strokeWidth="3.5"
          />

          {/* Eyes behind Glasses (with animated blinking!) */}
          <g className={animated ? "drlabo-animated-eyes" : ""}>
            {mood === "shocked" || mood === "ticking_panic" ? (
              <>
                <circle cx="44" cy="52" r="5" fill="#2B2D42" />
                <circle cx="43" cy="50" r="1.5" fill="#FFFFFF" />
                <circle cx="76" cy="56" r="5" fill="#2B2D42" />
                <circle cx="75" cy="54" r="1.5" fill="#FFFFFF" />
              </>
            ) : mood === "proud_cheer" ? (
              <>
                <path
                  d="M39 53C42 49 46 49 49 53"
                  stroke="#2B2D42"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <path
                  d="M71 53C74 49 78 49 81 53"
                  stroke="#2B2D42"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              </>
            ) : (
              <>
                <circle cx="44" cy="52" r="4.2" fill="#2B2D42" />
                <circle cx="42.5" cy="50.5" r="1.5" fill="#FFFFFF" />
                <circle cx="76" cy="52" r="4.2" fill="#2B2D42" />
                <circle cx="74.5" cy="50.5" r="1.5" fill="#FFFFFF" />
              </>
            )}
          </g>

          {/* Glasses Lens Glint */}
          <path
            d="M38 46L46 50"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M70 46L78 50"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Big Pink Bulbous Nose (Key Dr. Labo feature!) */}
          <ellipse
            cx="60"
            cy="55"
            rx="8"
            ry="7"
            fill="#FB7185"
            stroke="#2B2D42"
            strokeWidth="3"
          />
          {/* Nose shine */}
          <ellipse cx="58" cy="53" rx="2.5" ry="1.5" fill="#FFFFFF" />

          {/* Big Bushy Curved White Mustache */}
          <path
            d="M60 62C52 56 36 58 32 68C42 70 52 65 60 69C68 65 78 70 88 68C84 58 68 56 60 62Z"
            fill="#FFFFFF"
            stroke="#2B2D42"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />

          {/* Animated Mouth */}
          <g className={animated ? "drlabo-animated-mouth" : ""}>
            {mood === "shocked" || mood === "ticking_panic" ? (
              <ellipse
                cx="60"
                cy="74"
                rx="6"
                ry="5"
                fill="#991B1B"
                stroke="#2B2D42"
                strokeWidth="2"
              />
            ) : mood === "proud_cheer" ? (
              <path
                d="M54 71C56 76 64 76 66 71"
                stroke="#2B2D42"
                strokeWidth="3"
                strokeLinecap="round"
              />
            ) : mood === "angry_roast" ? (
              <path
                d="M52 75C56 72 64 72 68 75"
                stroke="#2B2D42"
                strokeWidth="3"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M55 72C58 74 62 74 65 72"
                stroke="#2B2D42"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            )}
          </g>

          {/* Iconic Graduation Mortarboard Academic Cap (Mũ Cử Nhân Dr. Labo!) */}
          <g>
            {/* Cap Skull base */}
            <path
              d="M36 28C36 24 46 22 60 22C74 22 84 24 84 28V32H36V28Z"
              fill="#1E293B"
              stroke="#2B2D42"
              strokeWidth="3"
            />
            {/* Diamond Mortarboard Top Plate */}
            <polygon
              points="60,4 104,18 60,30 16,18"
              fill="#0F172A"
              stroke="#2B2D42"
              strokeWidth="3.5"
              strokeLinejoin="round"
            />
            {/* Center Button on Cap */}
            <circle
              cx="60"
              cy="17"
              r="3.5"
              fill="#F59E0B"
              stroke="#2B2D42"
              strokeWidth="2"
            />

            {/* Swinging Gold Tassel */}
            <g className={animated ? "drlabo-animated-tassel" : ""}>
              <path
                d="M60 17C66 16 75 16 75 24V38"
                stroke="#F59E0B"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
              {/* Tassel Fringe */}
              <rect
                x="72"
                y="38"
                width="6"
                height="8"
                rx="1.5"
                fill="#F59E0B"
                stroke="#2B2D42"
                strokeWidth="1.5"
              />
            </g>
          </g>
        </svg>
      </div>

      {/* Character Nameplate */}
      {showNameplate && (
        <div className="mt-1 bg-candy-yellow text-candy-ink border-[2px] border-candy-ink px-2.5 py-0.5 rounded-md font-display font-black text-[10px] uppercase tracking-wider shadow-[2px_2px_0_0_#2B2D42]">
          {t("name")}
        </div>
      )}
    </div>
  );
};

ProfessorAvatar.displayName = "ProfessorAvatar";
