"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import { API_URL } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  Server,
  Database,
  RefreshCw,
  Cpu,
  Activity,
  AlertTriangle,
  ShieldCheck,
  Terminal,
} from "lucide-react";

// ── Response Types (mirrors API) ───────────────────────────

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

type ServiceStatus = "loading" | "connected" | "disconnected" | "error";

export default function AdminPage() {
  const t = useTranslations("admin");
  const router = useRouter();
  const { toast } = useToast();
  const { accessToken, userRole } = useSocketStore();

  const [dbStatusState, setDbStatusState] = useState<ServiceStatus>("loading");
  const [redisStatusState, setRedisStatusState] =
    useState<ServiceStatus>("loading");
  const [seeding, setSeeding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [metrics, setMetrics] = useState({
    cpuUsage: 0,
    memoryUsageMb: 0,
    totalMemoryMb: 0,
    roomCount: 0,
  });

  useEffect(() => {
    const fetchMonitoring = async () => {
      try {
        const response = await fetch(`${API_URL}/health/monitoring`, {
          credentials: "include",
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
        const response = await fetch(`${API_URL}/health`, {
          credentials: "include",
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
  }, []);

  const handleSeedQuestions = async () => {
    setSeeding(true);
    try {
      const response = await fetch(`${API_URL}/admin/questions/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
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
      const response = await fetch(`${API_URL}/admin/system/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
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

  if (userRole !== "ADMIN") {
    return (
      <AppShellLayout>
        <div className="max-w-md mx-auto w-full text-center space-y-6 pt-12 select-none">
          <div className="bg-candy-red border-[3px] border-candy-ink rounded-3xl p-8 shadow-[6px_6px_0_0_#2B2D42] text-white space-y-4">
            <div className="flex justify-center">
              <AlertTriangle className="w-16 h-16 text-candy-yellow animate-bounce" />
            </div>
            <h1 className="font-display font-black text-2xl tracking-wider uppercase">
              ACCESS DENIED
            </h1>
            <p className="font-mono text-xs font-black uppercase text-white/95 leading-relaxed">
              You do not have administrative clearance to operate this terminal.
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all"
          >
            Return to Deck
          </button>
        </div>
      </AppShellLayout>
    );
  }

  return (
    <AppShellLayout>
      <div className="max-w-5xl mx-auto w-full space-y-8 pt-2 select-none">
        {/* Header Block */}
        <div className="relative bg-candy-red border-[3px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] overflow-hidden text-white flex flex-col md:flex-row items-center md:justify-between gap-6">
          <div className="absolute top-0 left-0 right-0 h-3 bg-white/20 z-0" />

          <div className="space-y-2 relative z-10 text-center md:text-left">
            <h1 className="font-display font-black text-3xl md:text-4xl tracking-wider uppercase flex items-center justify-center md:justify-start gap-3">
              <Terminal className="w-8 h-8 text-candy-yellow animate-pulse" />
              {t("title")}
            </h1>
            <p className="font-mono text-xs font-black uppercase text-white/90">
              {t("subtitle")}
            </p>
          </div>

          <span className="shrink-0 relative z-10 px-4 py-2 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl text-candy-ink font-display font-black text-xs shadow-[3px_3px_0_0_#000] uppercase tracking-wider">
            {t("rootAccess")}
          </span>
        </div>

        {/* Resources Metrics & Node statuses */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* CPU Metric Card */}
          <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-5 space-y-4 shadow-[4px_4px_0_0_#2B2D42]">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono font-black uppercase text-candy-ink flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-candy-red" />
                {t("cpuCoreLoad")}
              </span>
              <span className="font-mono font-black text-sm text-candy-red">
                {metrics.cpuUsage.toFixed(1)}%
              </span>
            </div>

            {/* Custom 3D Progress Bar */}
            <div className="w-full bg-candy-cloud h-5 rounded-xl border-[2.5px] border-candy-ink overflow-hidden p-0.5 shadow-inner">
              <div
                className="bg-candy-red border-r-[2px] border-candy-ink h-full rounded-lg shadow-[0_0_4px_rgba(0,0,0,0.15)]"
                style={{
                  width: `${Math.max(0, Math.min(100, metrics.cpuUsage))}%`,
                }}
              />
            </div>

            <span className="block font-mono text-[10px] font-black text-candy-ink/50 uppercase">
              {t("cpuCaption")}
            </span>
          </div>

          {/* Ram Metric Card */}
          <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-5 space-y-4 shadow-[4px_4px_0_0_#2B2D42]">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono font-black uppercase text-candy-ink flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-candy-blue" />
                {t("ramAllocation")}
              </span>
              <span className="font-mono font-black text-sm text-candy-blue">
                {metrics.memoryUsageMb} {t("units.mb")} / {metrics.totalMemoryMb || '?'} {t("units.mb")}
              </span>
            </div>

            {/* Custom 3D Progress Bar */}
            <div className="w-full bg-candy-cloud h-5 rounded-xl border-[2.5px] border-candy-ink overflow-hidden p-0.5 shadow-inner">
              <div
                className="bg-candy-blue border-r-[2px] border-candy-ink h-full rounded-lg shadow-[0_0_4px_rgba(0,0,0,0.15)]"
                style={{
                  width: `${Math.max(0, Math.min(100, ((metrics.memoryUsageMb / (metrics.totalMemoryMb || 1024)) * 100)))}%`,
                }}
              />
            </div>

            <span className="block font-mono text-[10px] font-black text-candy-ink/50 uppercase">
              {t("ramCaption")}
            </span>
          </div>

          {/* Database Connections */}
          <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-5 space-y-4 shadow-[4px_4px_0_0_#2B2D42]">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono font-black uppercase text-candy-ink flex items-center gap-1.5">
                <Database className="w-4 h-4 text-candy-mint" />
                {t("activeLobbies")}
              </span>
              <span className="font-mono font-black text-sm text-candy-mint">
                {metrics.roomCount} {t("units.rooms")}
              </span>
            </div>

            {/* Custom 3D Progress Bar */}
            <div className="w-full bg-candy-cloud h-5 rounded-xl border-[2.5px] border-candy-ink overflow-hidden p-0.5 shadow-inner">
              <div
                className="bg-candy-mint border-r-[2px] border-candy-ink h-full rounded-lg shadow-[0_0_4px_rgba(0,0,0,0.15)]"
                style={{
                  width: `${Math.max(0, Math.min(100, metrics.roomCount))}%`,
                }}
              />
            </div>

            <span className="block font-mono text-[10px] font-black text-candy-ink/50 uppercase">
              {t("lobbiesCaption")}
            </span>
          </div>
        </div>

        {/* Database & Infrastructure operations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* DB Administration */}
          <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-6 space-y-6 shadow-[6px_6px_0_0_#2B2D42]">
            <h3 className="font-display font-black text-base text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-3">
              <Database className="w-5 h-5 text-candy-blue" />
              {t("dbAdministrationTitle")}
            </h3>

            {/* DB status bar */}
            <div className="flex justify-between items-center p-4 bg-candy-cloud rounded-2xl border-[2.5px] border-candy-ink shadow-[2.5px_2.5px_0_0_#000]">
              <span className="text-xs font-mono font-black text-candy-ink/80 uppercase">
                {t("prismaStatusLabel")}
              </span>
              <span className="px-3 py-1 rounded-xl bg-candy-mint border-[2.5px] border-candy-ink text-white text-xs font-mono font-black shadow-[2px_2px_0_0_#000]">
                {t(`status.${dbStatusState}`)}
              </span>
            </div>

            {/* Actions */}
            <div className="space-y-4">
              <button
                disabled={seeding}
                onClick={handleSeedQuestions}
                className="w-full flex items-center justify-center h-12 bg-candy-yellow border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                <RefreshCw
                  className={`w-4 h-4 mr-3 shrink-0 ${seeding && "animate-spin"}`}
                />
                {seeding ? t("syncingQuestions") : t("syncQuestions")}
              </button>

              <button
                onClick={() => alert(t("alerts.migrationsUpToDate"))}
                className="w-full flex items-center justify-center h-12 bg-white border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase text-candy-ink shadow-[4px_4px_0_0_#000] hover:bg-candy-cloud active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all"
              >
                <ShieldCheck className="w-4 h-4 mr-2 text-candy-mint shrink-0" />
                {t("checkMigrations")}
              </button>
            </div>
          </div>

          {/* Redis Server Operations */}
          <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-6 space-y-6 shadow-[6px_6px_0_0_#2B2D42]">
            <h3 className="font-display font-black text-base text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-3">
              <Server className="w-5 h-5 text-candy-red" />
              {t("redisOperationsTitle")}
            </h3>

            {/* Redis status bar */}
            <div className="flex justify-between items-center p-4 bg-candy-cloud rounded-2xl border-[2.5px] border-candy-ink shadow-[2.5px_2.5px_0_0_#000]">
              <span className="text-xs font-mono font-black text-candy-ink/80 uppercase">
                {t("redisStatusLabel")}
              </span>
              <span className="px-3 py-1 rounded-xl bg-candy-mint border-[2.5px] border-candy-ink text-white text-xs font-mono font-black shadow-[2px_2px_0_0_#000]">
                {t(`status.${redisStatusState}`)}
              </span>
            </div>

            {/* Actions */}
            <div className="space-y-4">
              <button
                disabled={resetting}
                onClick={handleResetSystem}
                className="w-full flex items-center justify-center h-12 bg-candy-red border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase text-white shadow-[4px_4px_0_0_#000] hover:bg-red-600 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#000] transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {resetting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-3 animate-spin shrink-0" />
                    RESETTING SYSTEM...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 mr-3 animate-pulse shrink-0" />
                    {t("resetActiveLobbies")}
                  </>
                )}
              </button>

              <div className="p-4 bg-candy-red/5 border-[2.5px] border-candy-ink rounded-2xl shadow-[2.5px_2.5px_0_0_#000]">
                <p className="text-[11px] leading-relaxed text-candy-ink font-mono font-black uppercase">
                  {t("warning")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Modal
        open={showResetModal}
        onOpenChange={setShowResetModal}
        title="Confirm Reset"
        description={t("alerts.resetConfirm")}
      >
        <div className="flex gap-3 mt-4">
          <Button
            variant="danger"
            onClick={performResetSystem}
            className="flex-1"
          >
            Confirm
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShowResetModal(false)}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </Modal>
    </AppShellLayout>
  );
}
