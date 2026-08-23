"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import { apiFetch } from "@/lib/api";
import { ApiError, apiSendJson } from "@/lib/api-client";
import { AdminAccessDenied } from "@/components/admin/admin-access-denied";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminMetricsGrid } from "@/components/admin/admin-metrics-grid";
import {
  AdminServiceStatus,
  type ServiceStatus,
} from "@/components/admin/admin-service-status";
import { AdminKillSwitch } from "@/components/admin/admin-kill-switch";
import { AdminDangerZone } from "@/components/admin/admin-danger-zone";
import { AdminConfirmModals } from "@/components/admin/admin-confirm-modals";

interface MonitoringResponse {
  cpuUsage?: number;
  memoryUsageMb?: number;
  totalMemoryMb?: number;
  roomCount?: number;
}

interface HealthCheckResponse {
  services?: {
    database?: { status?: string };
    redis?: { status?: string };
  };
}

export default function AdminPage() {
  const t = useTranslations("admin");
  const tTerminate = useTranslations("admin.terminateRoom");
  const tAccessDenied = useTranslations("admin.accessDenied");
  const { toast } = useToast();
  const { accessToken, userRole } = useSocketStore();

  const [dbStatusState, setDbStatusState] = useState<ServiceStatus>("loading");
  const [redisStatusState, setRedisStatusState] =
    useState<ServiceStatus>("loading");
  const [seeding, setSeeding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [terminateRoomId, setTerminateRoomId] = useState("");
  const [terminateMessage, setTerminateMessage] = useState("");
  const [terminating, setTerminating] = useState(false);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [metrics, setMetrics] = useState({
    cpuUsage: 0,
    memoryUsageMb: 0,
    totalMemoryMb: 0,
    roomCount: 0,
  });

  useEffect(() => {
    const fetchMonitoring = async () => {
      try {
        const response = await apiFetch("/api/v1/health/monitoring", {
          credentials: "include",
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });

        if (!response.ok) return;
        const data = (await response.json()) as MonitoringResponse;

        setMetrics({
          cpuUsage: data.cpuUsage ?? 0,
          memoryUsageMb: data.memoryUsageMb ?? 0,
          totalMemoryMb: data.totalMemoryMb ?? 0,
          roomCount: data.roomCount ?? 0,
        });
      } catch {
        // Keep default values if monitoring endpoint is unavailable.
      }
    };

    const fetchHealth = async () => {
      setDbStatusState("loading");
      setRedisStatusState("loading");

      try {
        const response = await apiFetch("/api/v1/health", {
          credentials: "include",
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });

        if (!response.ok) {
          setDbStatusState("error");
          setRedisStatusState("error");
          return;
        }

        const data = (await response.json()) as HealthCheckResponse;

        const dbStatus = data.services?.database?.status;
        const redisStatus = data.services?.redis?.status;

        setDbStatusState(
          dbStatus === "connected" || dbStatus === "disconnected"
            ? dbStatus
            : "error",
        );
        setRedisStatusState(
          redisStatus === "connected" || redisStatus === "disconnected"
            ? redisStatus
            : "error",
        );
      } catch {
        setDbStatusState("error");
        setRedisStatusState("error");
      }
    };

    void Promise.all([fetchMonitoring(), fetchHealth()]);
  }, [accessToken]);

  const handleSeedQuestions = async () => {
    setSeeding(true);
    try {
      const response = await apiFetch("/api/v1/admin/questions/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to sync questions");
      }

      toast({
        title: "Database Seed Successful",
        description: t("alerts.seedSuccess"),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An error occurred during synchronization";
      toast({
        title: "Sync Failed",
        description: message,
        variant: "error",
      });
    } finally {
      setSeeding(false);
    }
  };

  const handleResetSystem = async () => {
    setShowResetModal(true);
  };

  const performResetSystem = async () => {
    setShowResetModal(false);
    setResetting(true);
    try {
      const response = await apiFetch("/api/v1/admin/system/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to reset system");
      }

      toast({
        title: "System Reset Successful",
        description: t("alerts.resetSuccess"),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An error occurred during reset";
      toast({
        title: "Reset Failed",
        description: message,
        variant: "error",
      });
    } finally {
      setResetting(false);
    }
  };

  const handleTerminateRoomClick = () => {
    if (!terminateRoomId.trim()) {
      toast({
        title: tTerminate("errors.roomIdRequired"),
        variant: "error",
      });
      return;
    }
    setShowTerminateModal(true);
  };

  const performTerminateRoom = async () => {
    const trimmedRoomId = terminateRoomId.trim();
    setShowTerminateModal(false);

    setTerminating(true);
    try {
      const response = await apiSendJson<{
        success: boolean;
        partial?: boolean;
        cleanupError?: string;
        roomId: string;
        matchId: string | null;
        message: string;
      }>(
        `/api/v1/admin/rooms/${encodeURIComponent(trimmedRoomId)}/terminate`,
        "POST",
        {
          message: terminateMessage.trim() || undefined,
        },
        accessToken ?? undefined,
      );

      if (response.partial) {
        toast({
          title: tTerminate("partialTitle"),
          description: tTerminate("partialDescription", {
            error: response.cleanupError ?? "unknown",
          }),
        });
      } else {
        toast({
          title: tTerminate("success"),
        });
        setTerminateRoomId("");
        setTerminateMessage("");
      }
    } catch (error) {
      const isRateLimited = error instanceof ApiError && error.status === 429;
      toast({
        title: isRateLimited
          ? tTerminate("errors.rateLimited")
          : "Terminate Failed",
        description:
          error instanceof Error
            ? error.message
            : "An error occurred during termination",
        variant: "error",
      });
    } finally {
      setTerminating(false);
    }
  };

  if (userRole !== "ADMIN") {
    return (
      <AdminAccessDenied
        title={tAccessDenied("title")}
        description={tAccessDenied("consoleDescription")}
        returnHomeLabel={tAccessDenied("returnHome")}
      />
    );
  }

  return (
    <AppShellLayout>
      <div className="max-w-5xl mx-auto w-full space-y-8 pt-2 select-none">
        <AdminHeader />

        <AdminMetricsGrid metrics={metrics} />

        <AdminServiceStatus
          dbStatusState={dbStatusState}
          redisStatusState={redisStatusState}
        />

        <AdminKillSwitch
          terminateRoomId={terminateRoomId}
          setTerminateRoomId={setTerminateRoomId}
          terminateMessage={terminateMessage}
          setTerminateMessage={setTerminateMessage}
          terminating={terminating}
          onTerminateClick={handleTerminateRoomClick}
        />

        <AdminDangerZone
          seeding={seeding}
          resetting={resetting}
          onSeedQuestions={handleSeedQuestions}
          onResetSystem={handleResetSystem}
        />

        <AdminConfirmModals
          showResetModal={showResetModal}
          setShowResetModal={setShowResetModal}
          resetting={resetting}
          onPerformReset={performResetSystem}
          showTerminateModal={showTerminateModal}
          setShowTerminateModal={setShowTerminateModal}
          terminating={terminating}
          terminateRoomId={terminateRoomId}
          terminateMessage={terminateMessage}
          onPerformTerminate={performTerminateRoom}
        />
      </div>
    </AppShellLayout>
  );
}
