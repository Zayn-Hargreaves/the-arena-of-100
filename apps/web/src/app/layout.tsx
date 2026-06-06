import { Bungee, Fredoka, Gaegu, JetBrains_Mono } from "next/font/google";
import { getLocale } from "next-intl/server";
import "./globals.css";

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${displayFont.variable} ${sansFont.variable} ${handFont.variable} ${monoFont.variable}`}
    >
      <body className="min-h-screen bg-background antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
