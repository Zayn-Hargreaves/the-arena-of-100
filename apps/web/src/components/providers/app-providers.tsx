"use client";

import React from "react";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip-provider";
import { createQueryClient } from "@/lib/query-client";
import { useSocketStore } from "@/stores/socket-store";

interface AppProvidersProps {
  children: React.ReactNode;
}

// On logout (username transitions from a value to null), remove the
// profile cache so the next authenticated user does not see stale data
// from the previous session.
function ProfileCacheInvalidator() {
  const queryClient = useQueryClient();
  const username = useSocketStore((state) => state.username);
  const previousUsernameRef = React.useRef<string | null>(username);

  React.useEffect(() => {
    const previous = previousUsernameRef.current;
    if (previous !== null && username === null) {
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
        <ProfileCacheInvalidator />
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
