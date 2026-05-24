import React from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IconProps extends Omit<LucideProps, "ref"> {
  icon: React.ComponentType<LucideProps>;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  sm: "w-4 h-4", // 16px
  md: "w-5 h-5", // 20px
  lg: "w-6 h-6", // 24px
  xl: "w-8 h-8", // 32px
} as const;

export const Icon = React.forwardRef<SVGSVGElement, IconProps>(
  ({ icon: IconComponent, size = "md", className = "", ...props }, ref) => {
    const sizeClass = sizeClasses[size];
    const combinedClassName = cn(sizeClass, className);

    return <IconComponent ref={ref} className={combinedClassName} {...props} />;
  },
);

Icon.displayName = "Icon";
