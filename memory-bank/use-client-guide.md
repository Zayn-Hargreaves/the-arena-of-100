# Hướng dẫn nhận biết khi nào cần sử dụng "use client"

## Khi nào cần "use client"

### 1. Sử dụng React Hooks

```tsx
// Cần "use client"
import { useState, useEffect, useRef } from "react";

function MyComponent() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // side effect
  }, []);

  return <div>{count}</div>;
}
```

### 2. Event Handlers (onClick, onChange, v.v.)

```tsx
// Cần "use client"
function Button() {
  const handleClick = () => {
    console.log("Clicked!");
  };

  return <button onClick={handleClick}>Click me</button>;
}
```

### 3. Sử dụng Browser APIs

```tsx
// Cần "use client"
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

### 4. Sử dụng third-party libraries phụ thuộc client-side APIs

```tsx
// Cần "use client" - Radix UI components
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

function Tooltip() {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger>Hover me</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Content>Tooltip content</TooltipPrimitive.Content>
    </TooltipPrimitive.Root>
  );
}

// Cần "use client" - Framer Motion
import { motion } from "framer-motion";

function AnimatedDiv() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      Hello
    </motion.div>
  );
}
```

### 5. Sử dụng useSearchParams, useRouter trong Next.js

```tsx
// Cần "use client"
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

## Khi nào KHÔNG cần "use client"

### 1. Components chỉ render UI đơn giản

```tsx
// Không cần "use client"
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

### 2. Components chỉ nhận props và render

```tsx
// Không cần "use client"
function Card({ title, content }: { title: string; content: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p>{content}</p>
    </div>
  );
}
```

### 3. Components sử dụng Server Components như children

```tsx
// Không cần "use client" - dù nhận children từ Server Components
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

## Cách kiểm tra nhanh

1. **Kiểm tra imports**: Nếu thấy import từ `@radix-ui/*`, `framer-motion`, `react-hook-form`, v.v. → Cần "use client"
2. **Kiểm tra hooks**: Nếu thấy `useState`, `useEffect`, `useRef`, v.v. → Cần "use client"
3. **Kiểm tra event handlers**: Nếu thấy `onClick`, `onChange`, `onSubmit`, v.v. → Cần "use client"
4. **Kiểm tra browser APIs**: Nếu thấy `window`, `document`, `localStorage`, `fetch` → Cần "use client"
5. **Kiểm tra Next.js client hooks**: Nếu thấy `useSearchParams`, `useRouter`, `usePathname` → Cần "use client"

## Lưu ý quan trọng

- `"use client"` là directive cho **toàn bộ file/module**, không phải từng component riêng lẻ
- Khi một file có `"use client"`, tất cả exports từ file đó đều được coi là Client Components
- Nếu một Server Component cần import một component cụ thể từ file hỗn hợp, nên tách component đó ra file riêng với `"use client"`
