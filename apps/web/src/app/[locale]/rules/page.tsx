import React from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { ShieldCheckSvg } from "@/components/home/home-icons";
import { PolicyPageLayout } from "@/components/home/policy-page-layout";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: "policies" });

  return {
    title: `${t("antiCheatTitle")} | Arena of 100`,
    description: t("antiCheatSubtitle"),
  };
}

export default async function RulesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "policies" });
  const tHome = await getTranslations({ locale, namespace: "HomePage" });

  const sections = [
    {
      title: t("antiCheat.section1Title"),
      desc: t("antiCheat.section1Desc"),
      bgClass: "bg-[#E0F2FE]",
    },
    {
      title: t("antiCheat.section2Title"),
      desc: t("antiCheat.section2Desc"),
      bgClass: "bg-white",
    },
    {
      title: t("antiCheat.section3Title"),
      desc: t("antiCheat.section3Desc"),
      bgClass: "bg-[#FFF8E7]",
    },
    {
      title: t("antiCheat.section4Title"),
      desc: t("antiCheat.section4Desc"),
      bgClass: "bg-[#FFE5EC]",
    },
  ];

  return (
    <PolicyPageLayout
      badgeIcon={ShieldCheckSvg}
      badgeLabel={t("badgeLabel")}
      badgeClassName="bg-candy-mint text-white"
      title={t("antiCheatTitle")}
      subtitle={t("antiCheatSubtitle")}
      sections={sections}
      crossLink={{
        href: "/terms",
        label: `← ${t("termsTitle")}`,
      }}
      brandLabel={tHome("brand")}
      closeLabel={t("close")}
    />
  );
}
