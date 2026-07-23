import React from "react";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SpriteFrameProps {
  src?: string;
  scale: number;
  width: string;
  height: string;
  frameClassName?: string;
  skeletonSize?: string;
  row?: number;
}

export function SpriteFrame({
  src,
  scale,
  width,
  height,
  frameClassName,
  skeletonSize = "72px",
  row = 0,
}: Readonly<SpriteFrameProps>) {
  return (
    <div
      className={cn(
        "bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center overflow-hidden",
        frameClassName,
      )}
    >
      {src ? (
        <AnimatedSprite
          src={src}
          row={row}
          scale={scale}
          width={width}
          height={height}
        />
      ) : (
        <Skeleton variant="circle" width={skeletonSize} height={skeletonSize} />
      )}
    </div>
  );
}
