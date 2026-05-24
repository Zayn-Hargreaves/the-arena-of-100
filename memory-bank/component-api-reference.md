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
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "action" | "primary" | "secondary" | "danger" | "ghost" | "icon";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  asChild?: boolean;
}
```

### Input

```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "terminal" | "default";
  inputSize?: "sm" | "md" | "lg";
}
```

### Badge

```tsx
interface BadgeProps {
  variant?: "online" | "eliminated" | "admin" | "warning" | "default";
  children: React.ReactNode;
  className?: string;
}
```

### Avatar

```tsx
interface AvatarProps {
  src?: string;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  className?: string;
}
```
