import React from "react";
import { cn } from "@/lib/utils";
import { MiniGlyph } from "@/components/ui/mini-glyph";

interface DashboardSectionTitleProps {
  title: string;
  glyph: React.ComponentProps<typeof MiniGlyph>["variant"];
  className?: string;
}

export function DashboardSectionTitle({
  title,
  glyph,
  className,
}: Readonly<DashboardSectionTitleProps>) {
  return (
    <h3
      className={cn(
        "font-display font-black text-lg text-candy-ink uppercase tracking-wider flex items-center gap-2 leading-tight",
        className,
      )}
    >
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] text-candy-pink">
        <MiniGlyph variant={glyph} className="w-4 h-4" />
      </span>
      {title}
    </h3>
  );
}
