"use client";

import React, { useState } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { ROOM_CATEGORY_OPTIONS, type RoomCategory } from "@arena/shared";
import { Sparkles, Globe, Lock, ShieldAlert, Cpu, Timer } from "lucide-react";

export default function CreateRoomPage() {
  const router = useRouter();
  const { createRoom } = useSocketStore();
  const [roomType, setRoomType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [timeLimit, setTimeLimit] = useState(15);
  const [maxPlayers, setMaxPlayers] = useState(100);
  const [category, setCategory] = useState<RoomCategory>("ALL");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const roomCode = await createRoom({
        roomType,
        timeLimit,
        maxPlayers,
        category,
      });
      router.push(`/lobby/${roomCode}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Không thể tạo phòng. Vui lòng thử lại.";
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <AppShellLayout>
      <div className="max-w-3xl mx-auto w-full space-y-8 pt-4 select-none animate-slide-up">
        {/* Header */}
        <div className="flex flex-col gap-2 text-center md:text-left">
          <h1 className="font-display font-black text-3xl md:text-4xl text-candy-ink tracking-wider uppercase drop-shadow-[0_4px_0_rgba(0,0,0,0.1)]">
            Thiết Lập Đấu Trường
          </h1>
          <p className="font-sans text-sm font-bold text-candy-ink/75 tracking-wide">
            Cấu hình các thông số phòng thi đấu sinh tử của riêng bạn
          </p>
        </div>

        {/* Configuration Panel */}
        <div className="jelly-card p-6 md:p-8 space-y-8 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] transition-all hover:translate-y-[-4px] hover:shadow-[12px_12px_0_0_#2B2D42]">
          {/* Room Visibility Type */}
          <div className="space-y-4">
            <label className="block font-display font-black text-base text-candy-ink uppercase tracking-wider">
              Chế Độ Hiển Thị
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setRoomType("PUBLIC")}
                className={`flex items-center gap-4 p-4 rounded-2xl border-[3.5px] border-candy-ink text-left transition-all duration-150 shadow-[4px_4px_0_0_#2B2D42] outline-none focus:outline-none ${
                  roomType === "PUBLIC"
                    ? "bg-candy-mint text-candy-ink translate-y-[-2px] shadow-[6px_6px_0_0_#2B2D42]"
                    : "bg-white text-candy-ink hover:translate-y-[-1px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#2B2D42]"
                }`}
              >
                <div
                  className={`p-2.5 rounded-xl border-[3px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] ${roomType === "PUBLIC" ? "bg-white text-candy-ink" : "bg-candy-cloud text-candy-ink"}`}
                >
                  <Globe className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h4 className="font-display font-black text-sm uppercase tracking-wide">
                    Công Khai (Public)
                  </h4>
                  <p className="text-xs font-medium opacity-80 mt-0.5">
                    Bất kỳ ai cũng có thể tìm thấy và tham gia.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRoomType("PRIVATE")}
                className={`flex items-center gap-4 p-4 rounded-2xl border-[3.5px] border-candy-ink text-left transition-all duration-150 shadow-[4px_4px_0_0_#2B2D42] outline-none focus:outline-none ${
                  roomType === "PRIVATE"
                    ? "bg-candy-pink text-candy-ink translate-y-[-2px] shadow-[6px_6px_0_0_#2B2D42]"
                    : "bg-white text-candy-ink hover:translate-y-[-1px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#2B2D42]"
                }`}
              >
                <div
                  className={`p-2.5 rounded-xl border-[3px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] ${roomType === "PRIVATE" ? "bg-white text-candy-ink" : "bg-candy-cloud text-candy-ink"}`}
                >
                  <Lock className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h4 className="font-display font-black text-sm uppercase tracking-wide">
                    Bảo Mật (Private)
                  </h4>
                  <p className="text-xs font-medium opacity-80 mt-0.5">
                    Chỉ tham gia được thông qua mã mời trực tiếp.
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Time Limit Picker */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="font-display font-black text-base text-candy-ink uppercase tracking-wider flex items-center gap-2">
                <Timer className="w-5 h-5 text-candy-pink stroke-[2.5]" />
                Thời Gian Suy Nghĩ
              </label>
              <span className="font-display font-black text-lg text-candy-pink border-2 border-candy-ink bg-white px-2.5 py-0.5 rounded-lg shadow-[2px_2px_0_0_#2B2D42]">
                {timeLimit} giây
              </span>
            </div>
            <div className="flex gap-3">
              {[10, 15, 20, 30].map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeLimit(t)}
                  className={`flex-1 py-3 rounded-2xl border-[3px] border-candy-ink font-display font-black text-sm transition-all duration-150 shadow-[3px_3px_0_0_#2B2D42] outline-none focus:outline-none ${
                    timeLimit === t
                      ? "bg-candy-yellow text-candy-ink translate-y-[-2px] shadow-[5px_5px_0_0_#2B2D42]"
                      : "bg-white text-candy-ink hover:translate-y-[-1px] hover:shadow-[4px_4px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42]"
                  }`}
                >
                  {t}s
                </button>
              ))}
            </div>
          </div>

          {/* Category Selector */}
          <div className="space-y-4">
            <label className="block font-display font-black text-base text-candy-ink uppercase tracking-wider">
              Chủ Đề Câu Hỏi
            </label>
            <div className="flex flex-wrap gap-3">
              {ROOM_CATEGORY_OPTIONS.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={`px-5 py-2.5 rounded-full border-[3px] border-candy-ink text-xs font-display font-black uppercase tracking-wider transition-all duration-150 shadow-[3px_3px_0_0_#2B2D42] outline-none focus:outline-none ${
                    category === cat.value
                      ? "bg-candy-blue text-white translate-y-[-2px] shadow-[5px_5px_0_0_#2B2D42]"
                      : "bg-white text-candy-ink hover:translate-y-[-1px] hover:shadow-[4px_4px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Max Players Counter */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="font-display font-black text-base text-candy-ink uppercase tracking-wider flex items-center gap-2">
                <Cpu className="w-5 h-5 text-candy-blue stroke-[2.5]" />
                Giới Hạn Đối Thủ
              </label>
              <span className="font-display font-black text-lg text-candy-blue border-2 border-candy-ink bg-white px-2.5 py-0.5 rounded-lg shadow-[2px_2px_0_0_#2B2D42]">
                {maxPlayers} Người
              </span>
            </div>
            <div className="flex gap-3">
              {[25, 50, 75, 100].map((num) => (
                <button
                  key={num}
                  onClick={() => setMaxPlayers(num)}
                  className={`flex-1 py-3 rounded-2xl border-[3px] border-candy-ink font-display font-black text-sm transition-all duration-150 shadow-[3px_3px_0_0_#2B2D42] outline-none focus:outline-none ${
                    maxPlayers === num
                      ? "bg-candy-blue text-white translate-y-[-2px] shadow-[5px_5px_0_0_#2B2D42]"
                      : "bg-white text-candy-ink hover:translate-y-[-1px] hover:shadow-[4px_4px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42]"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Warning notice */}
          <div className="flex gap-3 p-4 bg-[#FFF8E7] border-[3px] border-candy-ink rounded-2xl shadow-[4px_4px_0_0_#2B2D42]">
            <ShieldAlert className="w-5 h-5 shrink-0 text-candy-red mt-0.5 stroke-[2.5]" />
            <p className="text-xs font-semibold leading-relaxed text-candy-ink">
              <strong>Lưu ý:</strong> Một khi phòng đấu được khởi tạo, bạn sẽ là
              Chủ Phòng (Host) chịu trách nhiệm nhấn nút bắt đầu khi đủ người
              chơi. Trận đấu sinh tử sẽ ngay lập tức loại bỏ bất kỳ ai chọn sai
              hoặc hết thời gian!
            </p>
          </div>

          {/* Actions */}
          <div className="pt-4">
            {createError ? (
              <p className="mb-3 text-sm font-bold text-candy-red">
                {createError}
              </p>
            ) : null}
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full h-14 bg-candy-mint text-candy-ink border-[3.5px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[2px_2px_0_0_#2B2D42] transition-all font-display font-black text-base uppercase tracking-widest flex items-center justify-center cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-60 disabled:translate-y-0 disabled:shadow-[3px_3px_0_0_#2B2D42]"
            >
              <Sparkles className="w-5 h-5 mr-2 animate-pulse stroke-[2.5]" />
              {isCreating ? "Đang tạo phòng..." : "Khởi Chạy Đấu Trường"}
            </button>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
