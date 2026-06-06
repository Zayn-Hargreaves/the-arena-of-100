"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { AlertCircle } from "lucide-react";

interface LeaveMatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const LeaveMatchModal: React.FC<LeaveMatchModalProps> = ({
  open,
  onOpenChange,
  onConfirm,
}) => {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Rời trận đấu?"
      description="Bạn có chắc chắn muốn rời trận đấu này? Hành động này đồng nghĩa với việc bạn chấp nhận thua và sẽ không thể quay lại trận."
      closeLabel="Đóng"
    >
      <div className="flex flex-col gap-4 mt-4">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-candy-cloud border-[3px] border-candy-ink">
          <AlertCircle className="w-5 h-5 text-candy-yellow shrink-0 mt-0.5 stroke-[2.5]" />
          <p className="text-sm font-semibold leading-relaxed text-candy-ink">
            Tiến trình của bạn trong trận đấu này sẽ bị mất và bạn sẽ bị loại
            khỏi bảng xếp hạng.
          </p>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-5 py-2.5 border-[3px] border-candy-ink bg-white text-candy-ink font-display font-black text-xs uppercase rounded-xl hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1.5px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none"
          >
            Hủy
          </button>
          <button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className="px-5 py-2.5 border-[3px] border-candy-ink bg-candy-red text-white font-display font-black text-xs uppercase rounded-xl hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1.5px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none"
          >
            Xác nhận rời trận
          </button>
        </div>
      </div>
    </Modal>
  );
};
