# Toast Component

The Toast component provides feedback to users about operations or events in the application. It uses Radix UI primitives for accessibility and follows the design system guidelines.

## Installation

The Toast component requires the following dependencies:

```bash
pnpm add @radix-ui/react-toast class-variance-authority
```

## Setup

1. Add the Toaster component to your root layout:

```tsx
// app/layout.tsx
import { Toaster } from "@/components/ui/toaster";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
```

## Usage

Use the `useToast` hook to trigger toasts:

```tsx
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export function MyComponent() {
  const { toast } = useToast();

  const handleClick = () => {
    toast({
      title: "Đã lưu!",
      description: "Thông tin của bạn đã được lưu thành công.",
      variant: "success",
    });
  };

  return <Button onClick={handleClick}>Save</Button>;
}
```

## Variants

The Toast component supports 4 variants:

- `info` (default)
- `success`
- `warning`
- `error`

## Props

### Toast Props

| Prop        | Type                                        | Description                               |
| ----------- | ------------------------------------------- | ----------------------------------------- |
| title       | React.ReactNode                             | The title of the toast                    |
| description | React.ReactNode                             | The description of the toast              |
| variant     | "info" \| "success" \| "warning" \| "error" | The style variant of the toast            |
| action      | ToastActionElement                          | An action element to display in the toast |

## Customization

You can customize the toast through the `className` prop:

```tsx
toast({
  title: "Custom Toast",
  className: "bg-primary text-on-primary",
});
```

## Accessibility

The Toast component follows WAI-ARIA standards:

- Proper keyboard navigation
- Screen reader support
- Focus management
- Swipe gestures for touch devices
