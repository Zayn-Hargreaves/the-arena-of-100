# Guide to Identifying When to Use "use client"

## When to Use "use client"

### 1. Using React Hooks

```tsx
// Needs "use client"
import { useState, useEffect, useRef } from "react";

function MyComponent() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // side effect
  }, []);

  return <div>{count}</div>;
}
```

### 2. Event Handlers (onClick, onChange, etc.)

```tsx
// Needs "use client"
function Button() {
  const handleClick = () => {
    console.log("Clicked!");
  };

  return <button onClick={handleClick}>Click me</button>;
}
```

### 3. Using Browser APIs

```tsx
// Needs "use client"
function WindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div>
      Window size: {size.width} x {size.height}
    </div>
  );
}
```

### 4. Using third-party libraries that depend on client-side APIs

```tsx
// Needs "use client" - Radix UI components
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

function Tooltip() {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger>Hover me</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Content>Tooltip content</TooltipPrimitive.Content>
    </TooltipPrimitive.Root>
  );
}

// Needs "use client" - Framer Motion
import { motion } from "framer-motion";

function AnimatedDiv() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      Hello
    </motion.div>
  );
}
```

### 5. Using useSearchParams, useRouter in Next.js

```tsx
// Needs "use client"
import { useSearchParams, useRouter } from "next/navigation";

function SearchComponent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleSearch = (query: string) => {
    router.push(`/search?q=${query}`);
  };

  return <div>Search: {searchParams.get("q")}</div>;
}
```

## When NOT to Use "use client"

### 1. Components that only render simple UI

```tsx
// Does not need "use client"
function Badge({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: string;
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
```

### 2. Components that only receive props and render

```tsx
// Does not need "use client"
function Card({ title, content }: { title: string; content: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p>{content}</p>
    </div>
  );
}
```

### 3. Components that accept Server Components as children

```tsx
// Does not need "use client" - even though it receives children from Server Components
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      <header>Header</header>
      <main>{children}</main>
      <footer>Footer</footer>
    </div>
  );
}
```

## Quick Check Method

1. **Check imports**: If you see imports from `@radix-ui/*`, `framer-motion`, `react-hook-form`, etc. → Needs "use client"
2. **Check hooks**: If you see `useState`, `useEffect`, `useRef`, etc. → Needs "use client"
3. **Check event handlers**: If you see `onClick`, `onChange`, `onSubmit`, etc. → Needs "use client"
4. **Check browser APIs**: If you see `window`, `document`, `localStorage` → Needs "use client"
5. **Check Next.js client hooks**: If you see `useSearchParams`, `useRouter`, `usePathname` → Needs "use client"

## Important Notes

- `"use client"` is a directive for the **entire file/module**, not individual components
- When a file has `"use client"`, all exports from that file are considered Client Components
- If a Server Component needs to import a specific component from a mixed file, consider separating that component into its own file with `"use client"`
