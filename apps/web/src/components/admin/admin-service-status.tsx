import React from "react";
import { useTranslations } from "next-intl";
import { Database, Server } from "lucide-react";

export type ServiceStatus = "loading" | "connected" | "disconnected" | "error";

const STATUS_KEY_MAP = {
  loading: "status.loading",
  connected: "status.connected",
  disconnected: "status.disconnected",
  error: "status.error",
} as const;

interface ServiceStatusCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  title: string;
  subtitle: string;
  description: string;
  status: ServiceStatus;
}

function ServiceStatusCard({
  icon: Icon,
  iconColor = "text-candy-ink",
  title,
  subtitle,
  description,
  status,
}: ServiceStatusCardProps) {
  const t = useTranslations("admin");

  return (
    <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-6 shadow-[5px_5px_0_0_#2B2D42] space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-candy-cloud rounded-2xl border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#000]">
            <Icon className={`w-6 h-6 ${iconColor}`} />
          </div>
          <div>
            <h2 className="font-display font-black text-lg text-candy-ink uppercase">
              {title}
            </h2>
            <span className="font-mono text-[10px] font-black text-candy-ink/60 uppercase">
              {subtitle}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-candy-cloud px-3 py-1.5 rounded-full border-2 border-candy-ink">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              status === "connected"
                ? "bg-candy-mint animate-pulse"
                : status === "loading"
                  ? "bg-candy-yellow animate-ping"
                  : "bg-candy-red"
            }`}
          />
          <span className="font-mono font-black text-xs uppercase text-candy-ink">
            {t(STATUS_KEY_MAP[status])}
          </span>
        </div>
      </div>

      <p className="font-mono text-xs font-bold text-candy-ink/80 bg-[#FFF8E7] p-3 rounded-xl border border-candy-ink/10">
        {description}
      </p>
    </div>
  );
}

interface AdminServiceStatusProps {
  dbStatusState: ServiceStatus;
  redisStatusState: ServiceStatus;
}

export function AdminServiceStatus({
  dbStatusState,
  redisStatusState,
}: AdminServiceStatusProps) {
  const t = useTranslations("admin");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <ServiceStatusCard
        icon={Database}
        iconColor="text-candy-ink"
        title={t("postgresql")}
        subtitle={t("primaryDatabase")}
        description={t("pgDescription")}
        status={dbStatusState}
      />
      <ServiceStatusCard
        icon={Server}
        iconColor="text-candy-red"
        title={t("redis")}
        subtitle={t("cacheAndPubsub")}
        description={t("redisDescription")}
        status={redisStatusState}
      />
    </div>
  );
}
