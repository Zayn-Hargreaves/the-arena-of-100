"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";

export interface LeaveMatchButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/** Full-width "leave match" CTA that opens the leave-confirmation modal. */
export const LeaveMatchButton: React.FC<LeaveMatchButtonProps> = ({
  onClick,
  disabled = false,
}) => {
  const t = useTranslations("Game");

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-12 bg-candy-red text-white border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center justify-center cursor-pointer transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={disabled}
    >
      <LogOut className="w-4 h-4 mr-2 stroke-[2.5]" />
      {t("leaveMatchButton")}
    </button>
  );
};

LeaveMatchButton.displayName = "LeaveMatchButton";
