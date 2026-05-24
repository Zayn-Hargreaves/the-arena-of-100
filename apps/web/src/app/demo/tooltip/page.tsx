"use client";

import React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

export default function TooltipDemoPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-12">
        <header>
          <h1 className="text-4xl font-bold text-on-background mb-2">
            Tooltip Component
          </h1>
          <p className="text-on-background/80">
            A demonstration of the custom Tooltip component built with Radix UI
            primitives.
          </p>
        </header>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-on-background">
            Basic Usage
          </h2>

          <div className="flex flex-wrap items-center gap-6 p-6 bg-surface-container rounded-lg">
            <Tooltip content="This is a top tooltip">
              <Button variant="primary">Top (default)</Button>
            </Tooltip>

            <Tooltip content="This is a right tooltip" side="right">
              <Button variant="secondary">Right</Button>
            </Tooltip>

            <Tooltip content="This is a bottom tooltip" side="bottom">
              <Button variant="ghost">Bottom</Button>
            </Tooltip>

            <Tooltip content="This is a left tooltip" side="left">
              <Button variant="icon">
                <Info className="w-5 h-5" />
              </Button>
            </Tooltip>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-on-background">
            Alignment Options
          </h2>

          <div className="flex flex-wrap items-center gap-6 p-6 bg-surface-container rounded-lg">
            <Tooltip content="Aligned to start" align="start">
              <Button variant="primary">Start Align</Button>
            </Tooltip>

            <Tooltip content="Aligned to center (default)" align="center">
              <Button variant="secondary">Center Align</Button>
            </Tooltip>

            <Tooltip content="Aligned to end" align="end">
              <Button variant="ghost">End Align</Button>
            </Tooltip>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-on-background">
            Custom Styling
          </h2>

          <div className="flex flex-wrap items-center gap-6 p-6 bg-surface-container rounded-lg">
            <Tooltip
              content="Custom styled tooltip"
              className="bg-primary text-on-primary border-primary-container"
            >
              <Button variant="primary">Custom Style</Button>
            </Tooltip>

            <Tooltip
              content="Large tooltip with more content"
              side="right"
              className="px-4 py-2 text-base"
            >
              <Button variant="secondary">Large Tooltip</Button>
            </Tooltip>
          </div>
        </section>
      </div>
    </div>
  );
}
