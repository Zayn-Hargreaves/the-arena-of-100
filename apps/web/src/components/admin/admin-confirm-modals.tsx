import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Skull } from "lucide-react";

interface AdminConfirmModalsProps {
  showResetModal: boolean;
  setShowResetModal: (show: boolean) => void;
  resetting: boolean;
  onPerformReset: () => void;
  showTerminateModal: boolean;
  setShowTerminateModal: (show: boolean) => void;
  terminating: boolean;
  terminateRoomId: string;
  terminateMessage: string;
  onPerformTerminate: () => void;
}

export function AdminConfirmModals({
  showResetModal,
  setShowResetModal,
  resetting,
  onPerformReset,
  showTerminateModal,
  setShowTerminateModal,
  terminating,
  terminateRoomId,
  terminateMessage,
  onPerformTerminate,
}: AdminConfirmModalsProps) {
  const t = useTranslations("admin");
  const tTerminate = useTranslations("admin.terminateRoom");

  return (
    <>
      {/* Reset Confirmation Modal */}
      <Modal
        open={showResetModal}
        onOpenChange={setShowResetModal}
        title={t("resetModalTitle")}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-candy-red">
            <AlertTriangle className="w-8 h-8 shrink-0" />
            <p className="font-mono text-sm font-bold">
              {t("resetModalWarning")}
            </p>
          </div>
          <p className="font-mono text-xs text-candy-ink/70">
            {t("resetModalDetails")}
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-candy-ink/10">
            <Button
              variant="secondary"
              onClick={() => setShowResetModal(false)}
              disabled={resetting}
            >
              {t("cancelBtn")}
            </Button>
            <Button
              variant="danger"
              onClick={onPerformReset}
              disabled={resetting}
            >
              {resetting ? t("resetting") : t("confirmResetBtn")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Terminate Room Confirmation Modal */}
      <Modal
        open={showTerminateModal}
        onOpenChange={setShowTerminateModal}
        title={tTerminate("confirmModalTitle")}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-candy-red">
            <Skull className="w-8 h-8 shrink-0" />
            <p className="font-mono text-sm font-bold">
              {tTerminate("confirmModalWarning", {
                roomId: terminateRoomId.trim(),
              })}
            </p>
          </div>
          <p className="font-mono text-xs text-candy-ink/70">
            {tTerminate("confirmModalDetails")}
          </p>
          {terminateMessage.trim() && (
            <div className="bg-[#FFF8E7] border border-candy-ink/20 rounded-xl p-3">
              <span className="block font-mono text-[10px] font-black uppercase text-candy-ink/60">
                {tTerminate("confirmModalMessagePreview")}
              </span>
              <p className="font-mono text-xs text-candy-ink font-bold mt-1">
                &ldquo;{terminateMessage.trim()}&rdquo;
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t border-candy-ink/10">
            <Button
              variant="secondary"
              onClick={() => setShowTerminateModal(false)}
              disabled={terminating}
            >
              {t("cancelBtn")}
            </Button>
            <Button
              variant="danger"
              onClick={onPerformTerminate}
              disabled={terminating}
            >
              {terminating ? tTerminate("submitting") : tTerminate("submit")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
