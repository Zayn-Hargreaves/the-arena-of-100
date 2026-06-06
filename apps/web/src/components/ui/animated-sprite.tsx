"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface AnimatedSpriteProps extends React.HTMLAttributes<HTMLDivElement> {
  src: string;
  row?: number;
  columns?: number;
  rows?: number;
  rowFramesPerSheet?: number[];
  speed?: number;
  scale?: number;
  mirror?: boolean;
  width?: string;
  height?: string;
}

const defaultRowFramesPerSheet = [6, 8, 8, 4, 5, 8, 6, 6, 6]; // Frame count per row for Melbit/Codex spritesheets
const BASE_WIDTH = 192;
const BASE_HEIGHT = 208;

export const AnimatedSprite: React.FC<AnimatedSpriteProps> = ({
  src,
  row = 0,
  columns = 8,
  rows = 9,
  rowFramesPerSheet = defaultRowFramesPerSheet,
  speed = 120,
  scale = 1.0,
  mirror = false,
  width = "192px",
  height = "208px",
  className,
  ...props
}) => {
  const [frame, setFrame] = useState(0);
  const activeRow = Math.max(0, Math.min(row, rows - 1));

  const cols = Math.max(1, rowFramesPerSheet[activeRow] ?? columns);

  useEffect(() => {
    setFrame(0);

    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % cols);
    }, speed);

    return () => clearInterval(timer);
  }, [cols, speed, src]);

  // Compute background positions from provided sprite-sheet layout
  const xPercent = columns > 1 ? (frame / (columns - 1)) * 100 : 0;
  const yPercent = rows > 1 ? (activeRow / (rows - 1)) * 100 : 0;

  const transform = mirror ? "scaleX(-1)" : "scaleX(1)";
  const innerWidth = BASE_WIDTH * scale;
  const innerHeight = BASE_HEIGHT * scale;

  return (
    <div
      className={cn(
        "inline-block vertical-middle overflow-hidden select-none",
        className,
      )}
      style={{ width, height }}
      {...props}
    >
      <div className="w-full h-full flex items-center justify-center overflow-hidden">
        <div
          style={{
            width: `${innerWidth}px`,
            height: `${innerHeight}px`,
            flexShrink: 0,
            backgroundImage: `url('${src}')`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${columns * 100}% ${rows * 100}%`,
            backgroundPosition: `${xPercent}% ${yPercent}%`,
            transform,
            transformOrigin: "center center",
            imageRendering: "pixelated",
          }}
        />
      </div>
    </div>
  );
};

AnimatedSprite.displayName = "AnimatedSprite";
