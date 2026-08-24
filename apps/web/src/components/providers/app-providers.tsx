"use client";

import React from "react";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip-provider";
import { createQueryClient } from "@/lib/query-client";
import { useSocketStore } from "@/stores/socket-store";

import { SfxProvider } from "./sfx-provider";

interface AppProvidersProps {
  children: React.ReactNode;
}

// On any identity change (login, logout, role swap — including
// re-auth WITHOUT logout, which used to skip the invalidator),
// drop every `["profile", …]` cache entry so the next render does
// not see stale data from the previous session.
function ProfileCacheInvalidator() {
  const queryClient = useQueryClient();
  const username = useSocketStore((state) => state.username);
  const previousUsernameRef = React.useRef<string | null>(username);

  React.useEffect(() => {
    const previous = previousUsernameRef.current;
    if (previous !== username) {
      queryClient.removeQueries({ queryKey: ["profile"] });
    }
    previousUsernameRef.current = username;
  }, [username, queryClient]);

  return null;
}

export function AppProviders({ children }: Readonly<AppProvidersProps>) {
  const [queryClient] = React.useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SfxProvider>
          <ProfileCacheInvalidator />
          {children}
          <Toaster />
        </SfxProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
