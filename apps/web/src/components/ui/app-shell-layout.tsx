"use client";

import React, { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { useSocketStore } from "@/stores/socket-store";
import { cn } from "@/lib/utils";

interface AppShellLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export const AppShellLayout: React.FC<AppShellLayoutProps> = ({
  children,
  className = "",
}) => {
  const { username, connect, isConnected } = useSocketStore();

  // Proactively connect to WebSocket on layout mount if not connected
  useEffect(() => {
    if (!isConnected) {
      void connect().catch((error) => {
        console.error(
          "Failed to connect websocket from AppShellLayout:",
          error,
        );
      });
    }
  }, [connect, isConnected]);

  return (
    <div className="flex flex-col md:flex-row min-h-screen md:h-screen md:max-h-screen bg-gradient-to-br from-pink-50 via-blue-50 to-indigo-50 text-candy-ink overflow-hidden relative font-sans antialiased">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-3 focus:rounded-2xl focus:bg-white focus:text-candy-ink focus:border-[3px] focus:border-candy-ink focus:shadow-[4px_4px_0_0_#2B2D42] focus:font-display focus:font-black focus:text-xs focus:uppercase"
      >
        Skip to main content
      </a>

      {/* Sidebar Section */}
      <Sidebar nickname={username || "Player"} />

      {/* Main Content Area */}
      <main
        id="main-content"
        className={cn(
          "flex-1 flex flex-col min-h-0 w-full overflow-y-auto z-20 relative p-4 md:p-8 md:pt-6",
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
};

AppShellLayout.displayName = "AppShellLayout";
