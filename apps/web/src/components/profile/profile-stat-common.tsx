"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MessageCard } from "@/components/ui/message-card";
import { Spinner } from "@/components/ui/spinner";

export function StatValue({
  isLoading,
  value,
}: Readonly<{
  isLoading: boolean;
  value: string | number;
}>) {
  if (isLoading) {
    return <Spinner size="sm" className="text-current" />;
  }
  return <>{value}</>;
}

export function QueryErrorCard({
  onRetry,
}: Readonly<{
  onRetry: () => void;
}>) {
  const t = useTranslations("profile");
  return (
    <MessageCard
      message={t("error.loadFailed")}
      actionLabel={t("error.retry")}
      onAction={onRetry}
      tone="error"
    />
  );
}
