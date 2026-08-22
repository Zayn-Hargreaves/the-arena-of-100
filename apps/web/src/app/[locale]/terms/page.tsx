import React from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { ScrollSvg } from "@/components/home/home-icons";
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
    title: `${t("termsTitle")} | Arena of 100`,
    description: t("termsSubtitle"),
  };
}

export default async function TermsPage({
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
      title: t("terms.section1Title"),
      desc: t("terms.section1Desc"),
      bgClass: "bg-[#FFF8E7]",
    },
    {
      title: t("terms.section2Title"),
      desc: t("terms.section2Desc"),
      bgClass: "bg-white",
    },
    {
      title: t("terms.section3Title"),
      desc: t("terms.section3Desc"),
      bgClass: "bg-white",
    },
    {
      title: t("terms.section4Title"),
      desc: t("terms.section4Desc"),
      bgClass: "bg-[#FFF0F5]",
    },
  ];

  return (
    <PolicyPageLayout
      badgeIcon={ScrollSvg}
      badgeLabel={t("badgeLabel")}
      badgeClassName="bg-candy-yellow text-candy-ink"
      title={t("termsTitle")}
      subtitle={t("termsSubtitle")}
      sections={sections}
      crossLink={{
        href: "/rules",
        label: `${t("antiCheatTitle")} →`,
      }}
      brandLabel={tHome("brand")}
      closeLabel={t("close")}
    />
  );
}
