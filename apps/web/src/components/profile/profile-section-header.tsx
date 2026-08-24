import React from "react";

export function ProfileSectionHeader({
  title,
  icon,
}: Readonly<{
  title: string;
  icon: React.ReactNode;
}>) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-2xl bg-white border-[2.5px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] flex items-center justify-center shrink-0">
        {icon}
      </div>
      <h3 className="font-display font-black text-xl md:text-2xl text-candy-ink uppercase tracking-wider">
        {title}
      </h3>
    </div>
  );
}
