import React from "react";
import { cn } from "@/lib/utils";
import { MiniGlyph } from "@/components/ui/mini-glyph";

interface PanelSectionProps {
  title: string;
  glyph: React.ComponentProps<typeof MiniGlyph>["variant"];
  children: React.ReactNode;
  className?: string;
}

export function PanelSection({
  title,
  glyph,
  children,
  className,
}: PanelSectionProps) {
  return (
    <div
      className={cn(
        "bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 space-y-5 rounded-3xl relative overflow-hidden",
        className,
      )}
    >
      <h3 className="bg-candy-mint border-b-[3px] border-candy-ink p-4 -mx-6 -mt-6 rounded-t-[21px] flex items-center gap-2 font-display font-black text-candy-ink uppercase tracking-wider text-sm leading-tight">
        <MiniGlyph variant={glyph} className="w-5 h-5 text-candy-ink" />
        {title}
      </h3>
      {children}
    </div>
  );
}
