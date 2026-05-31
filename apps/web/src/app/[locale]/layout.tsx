import type { Metadata } from "next";
import { Bungee, Fredoka, Gaegu, JetBrains_Mono } from "next/font/google";
import "../globals.css";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip-provider";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

const displayFont = Bungee({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  preload: false,
});

const sansFont = Fredoka({
  subsets: ["latin"],
  variable: "--font-sans",
  preload: false,
});

const handFont = Gaegu({
  weight: ["300", "400", "700"],
  subsets: ["latin"],
  variable: "--font-hand",
  preload: false,
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const t = await getTranslations({ locale });

  return {
    title: `Arena of 100 - ${t("HomePage.subtitle")}`,
    description: t("HomePage.subtitle"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Ensure that the incoming locale is valid
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${displayFont.variable} ${sansFont.variable} ${handFont.variable} ${monoFont.variable}`}
    >
      <body className="min-h-screen bg-background antialiased font-sans">
        <NextIntlClientProvider messages={messages}>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
