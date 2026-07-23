"use client";

import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip-provider";
import { createQueryClient } from "@/lib/query-client";

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: Readonly<AppProvidersProps>) {
  const [queryClient] = React.useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
