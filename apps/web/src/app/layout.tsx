import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arena of 100 - Game Đấu Trường 100",
  description: "Real-time multiplayer quiz battle royale game",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-arena-dark antialiased">{children}</body>
    </html>
  );
}
