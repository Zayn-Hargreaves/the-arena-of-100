# Component API Reference

## Phase 2 Components

### Icon

```tsx
interface IconProps extends Omit<LucideProps, "ref"> {
  icon: React.ComponentType<LucideProps>;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}
```

### Spinner

```tsx
interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}
```

### Skeleton

```tsx
interface SkeletonProps {
  variant?: "text" | "circle" | "rect";
  width?: string;
  height?: string;
  className?: string;
}
```

### GlassPanel

```tsx
interface GlassPanelProps {
  variant?: "default" | "secondary" | "elevated";
  glow?: "none" | "primary" | "secondary" | "tertiary" | "error";
  children: React.ReactNode;
  className?: string;
}
```

### Divider

```tsx
interface DividerProps {
  orientation?: "horizontal" | "vertical";
  glow?: boolean;
  className?: string;
}
```

## Phase 3 Components

### Button

```tsx
interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  variant?: "action" | "primary" | "secondary" | "danger" | "ghost" | "icon";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ComponentType<{ className?: string }>;
  rightIcon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}
```

### Input

```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "terminal" | "default";
  inputSize?: "sm" | "md" | "lg";
  error?: boolean;
  success?: boolean;
  errorMessage?: string;
  label?: string;
  fullWidth?: boolean;
}
```

### Badge

```tsx
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "online" | "eliminated" | "admin" | "warning" | "default";
  size?: "sm" | "md" | "lg";
  glow?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}
```

### Avatar

```tsx
interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  status?: "online" | "eliminated" | "offline";
  glow?: "primary" | "secondary" | "tertiary" | "error" | "none";
}
```

## Phase 4 Components

### Modal

```tsx
interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}
```

### Toast

```tsx
type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

// Sub-components:
// - ToastProvider (from Radix)
// - ToastViewport
// - Toast (variant?: "info" | "success" | "warning" | "error")
// - ToastTitle
// - ToastDescription
// - ToastClose
// - ToastAction
```

### Tooltip

```tsx
interface TooltipProps {
  children: React.ReactElement;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  avoidCollisions?: boolean;
  className?: string;
}

// Sub-components:
// - TooltipTrigger (from Radix)
// - TooltipContent (from Radix)
// - TooltipArrow (from Radix)
```

### FormField

```tsx
interface FormFieldProps {
  label: string;
  id: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}
```
