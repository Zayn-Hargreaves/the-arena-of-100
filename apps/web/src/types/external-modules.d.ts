declare module "canvas-confetti" {
  export type ConfettiLauncher = (
    options?: Record<string, unknown>,
  ) => Promise<unknown>;

  export type ConfettiInstance = ConfettiLauncher & {
    reset?: () => void;
  };

  export function create(
    canvas: HTMLCanvasElement,
    options?: Record<string, unknown>,
  ): ConfettiInstance;
}

declare module "@tanstack/react-virtual" {
  export interface VirtualItem {
    key: string | number;
    index: number;
    start: number;
  }

  export interface Virtualizer {
    getVirtualItems(): VirtualItem[];
    getTotalSize(): number;
  }

  export function useVirtualizer(options: {
    count: number;
    getScrollElement: () => Element | null;
    estimateSize: () => number;
    overscan?: number;
    enabled?: boolean;
  }): Virtualizer;
}
