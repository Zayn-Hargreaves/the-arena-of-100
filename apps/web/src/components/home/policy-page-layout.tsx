import React from "react";
import { Link } from "@/i18n/routing";
import {
  SparkleSmallSvg,
  ArrowRightSvg,
  type IconProps,
} from "@/components/home/home-icons";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { cn } from "@/lib/utils";

export interface PolicySection {
  title: string;
  desc: string;
  bgClass: string;
}

export interface PolicyPageLayoutProps {
  badgeIcon: React.ComponentType<IconProps>;
  badgeLabel: string;
  badgeClassName?: string;
  title: string;
  subtitle: string;
  sections: PolicySection[];
  crossLink: {
    href: string;
    label: string;
  };
  brandLabel: string;
  closeLabel: string;
}

export function PolicyPageLayout({
  badgeIcon: BadgeIcon,
  badgeLabel,
  badgeClassName = "bg-candy-yellow text-candy-ink",
  title,
  subtitle,
  sections,
  crossLink,
  brandLabel,
  closeLabel,
}: Readonly<PolicyPageLayoutProps>) {
  return (
    <main className="text-candy-ink min-h-screen flex flex-col font-sans selection:bg-candy-pink selection:text-white relative overflow-x-hidden antialiased py-8 px-4 md:px-8">
      {/* Header Bar */}
      <div className="max-w-4xl mx-auto w-full flex justify-between items-center mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border-3 border-candy-ink rounded-2xl font-display font-black text-xs uppercase shadow-[3px_3px_0_0_#2B2D42] hover:bg-candy-yellow transition-all"
        >
          <span className="rotate-180 inline-block">
            <ArrowRightSvg size={16} />
          </span>
          <span>{brandLabel}</span>
        </Link>

        <LanguageToggle />
      </div>

      {/* Main Container */}
      <div className="max-w-4xl mx-auto w-full bg-white border-4 border-candy-ink rounded-3xl p-6 md:p-10 shadow-[8px_8px_0_0_#2B2D42]">
        <div className="border-b-4 border-dashed border-candy-ink/20 pb-6 mb-8">
          <div
            className={cn(
              "inline-flex items-center gap-2 font-display text-xs px-3.5 py-1.5 border-3 border-candy-ink rounded-full shadow-[2px_2px_0_0_#2B2D42] mb-3 select-none",
              badgeClassName,
            )}
          >
            <BadgeIcon size={18} aria-hidden="true" />
            <span className="font-black uppercase tracking-wider">
              {badgeLabel}
            </span>
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl text-candy-ink uppercase tracking-tight">
            {title}
          </h1>
          <p className="font-body text-sm md:text-base text-candy-ink/80 font-semibold mt-2">
            {subtitle}
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((sec, i) => (
            <div
              key={i}
              className={cn(
                "p-5 rounded-2xl border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42]",
                sec.bgClass,
              )}
            >
              <h2 className="font-display font-black text-base uppercase text-candy-ink flex items-center gap-2 mb-2">
                <SparkleSmallSvg size={18} />
                {sec.title}
              </h2>
              <p className="font-body text-sm leading-relaxed text-candy-ink/85 font-medium">
                {sec.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t-3 border-candy-ink flex justify-between items-center">
          <Link
            href={crossLink.href}
            className="font-display text-xs font-black uppercase text-candy-blue hover:underline"
          >
            {crossLink.label}
          </Link>

          <Link
            href="/"
            className="px-6 py-3 bg-candy-mint hover:bg-candy-mint/90 text-white border-3 border-candy-ink rounded-2xl font-display font-black text-xs uppercase shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] transition-all"
          >
            {closeLabel}
          </Link>
        </div>
      </div>
    </main>
  );
}
