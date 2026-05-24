# Tooltip Component

A customizable tooltip component built with Radix UI primitives, following the Arena of 100 design system.

## Installation

The component is automatically available after installing the required dependencies:

```bash
pnpm add @radix-ui/react-tooltip
```

## Usage

To use the Tooltip component, you need to wrap your application with the TooltipProvider:

```tsx
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  return (
    <TooltipProvider>
      {/* Your app content */}
      <Tooltip content="This is a tooltip">
        <button>Hover me</button>
      </Tooltip>
    </TooltipProvider>
  );
}
```

## Basic Example

```tsx
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export function TooltipDemo() {
  return (
    <TooltipProvider>
      <Tooltip content="This is a helpful tooltip">
        <Button variant="primary">Hover me</Button>
      </Tooltip>
    </TooltipProvider>
  );
}
```

## Props

### Tooltip

| Prop       | Type                                   | Default   | Description                                 |
| ---------- | -------------------------------------- | --------- | ------------------------------------------- |
| children   | ReactNode                              | required  | The trigger element                         |
| content    | ReactNode                              | required  | The tooltip content                         |
| side       | "top" \| "right" \| "bottom" \| "left" | "top"     | The side where the tooltip appears          |
| align      | "start" \| "center" \| "end"           | "center"  | The alignment of the tooltip                |
| sideOffset | number                                 | 4         | Distance in pixels from the trigger element |
| className  | string                                 | undefined | Additional CSS classes for customization    |

## Advanced Usage

You can also use the individual components for more control:

```tsx
import {
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  TooltipArrow,
  TooltipPrimitive,
} from "@/components/ui/tooltip";

export function CustomTooltip() {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root>
        <TooltipTrigger asChild>
          <button>Custom trigger</button>
        </TooltipTrigger>
        <TooltipPrimitive.Portal>
          <TooltipContent side="right" className="bg-primary text-on-primary">
            Custom styled tooltip
            <TooltipArrow className="fill-primary" />
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  );
}
```

## Styling

The tooltip uses the Arena of 100 design system colors:

- Background: `surface-container`
- Border: `surface-container-high`
- Text: `on-background`

You can customize the appearance by passing additional classes via the `className` prop.

## Accessibility

The tooltip follows WAI-ARIA guidelines:

- Properly manages focus
- Supports keyboard navigation
- Announces content to screen readers
- Respects reduced motion preferences

## Best Practices

1. Keep tooltip content concise and helpful
2. Use tooltips for supplementary information, not critical content
3. Ensure tooltips don't obscure important UI elements
4. Test tooltips on all screen sizes
5. Provide alternative ways to access tooltip content for touch devices
