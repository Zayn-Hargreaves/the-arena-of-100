"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";
import { RoomStatus } from "@arena/shared";

interface LobbyHeaderProps {
  roomStatus: RoomStatus;
  onLeave: () => Promise<void> | void;
}

export const LobbyHeader: React.FC<LobbyHeaderProps> = ({
  roomStatus,
  onLeave,
}) => {
  const lobbyHeading =
    roomStatus === RoomStatus.COUNTDOWN
      ? "ĐANG ĐẾM NGƯỢC"
      : roomStatus === RoomStatus.STARTING
        ? "ĐANG KHỞI TẠO TRẬN"
        : roomStatus === RoomStatus.IN_GAME
          ? "TRẬN ĐẤU ĐANG DIỄN RA"
          : "PHÒNG CHỜ";

  const lobbySubLabel =
    roomStatus === RoomStatus.COUNTDOWN
      ? "Chuẩn bị vào trận"
      : roomStatus === RoomStatus.STARTING
        ? "Server đang tạo match"
        : roomStatus === RoomStatus.IN_GAME
          ? "Đang chuyển vào game"
          : "Đang chờ trận đấu";

  // Navigation is owned by the parent (LobbyPage) which performs the actual
  // leave + router.push inside the leave-confirmation modal's onConfirm.
  // Calling router.push here would bypass leaveRoom/cleanup entirely.
  const handleBack = () => {
    onLeave();
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <button
        onClick={handleBack}
        className="flex items-center gap-2 px-4 py-2 border-[3px] border-candy-ink bg-white text-candy-ink font-display font-black text-xs uppercase rounded-xl hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1.5px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none"
      >
        <ArrowLeft className="w-4 h-4 mr-1 stroke-[2.5]" />
        Quay lại cài đặt
      </button>

      <div className="flex items-center gap-3">
        <button
          onClick={onLeave}
          className="px-4 py-2 border-[3px] border-candy-ink bg-candy-red text-white font-display font-black text-xs uppercase rounded-xl hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1.5px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none"
        >
          Rời phòng
        </button>
        <div className="text-right">
          <span className="font-display font-black text-[10px] text-candy-pink uppercase tracking-wider block">
            {lobbySubLabel}
          </span>
          <h2 className="font-display font-black text-2xl tracking-wide uppercase text-candy-ink drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
            {lobbyHeading}
          </h2>
        </div>
      </div>
    </div>
  );
};
