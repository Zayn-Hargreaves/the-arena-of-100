# Design System — Arena of 100

> **Last Updated:** 2026-05-24
> **Methodology:** Atomic Design (Atoms → Molecules → Organisms → Templates → Pages)
> **Styling:** Hybrid (CSS variables + Tailwind CSS + `@apply` for patterns)
> **Accessibility Base:** Radix UI primitives
> **Source Spec:** `stitch_collaborative_design_workflow/arena_of_100/DESIGN.md`
> **Audit Reference:** `memory-bank/designAudit.md`

---

## 📋 LOAD-ON-DEMAND GUIDE (for AI agents with limited context)

> **Strategy:** Each section is self-contained. Load only what you need.

| When you're working on...          | Load these sections                                    | ~Tokens |
| ---------------------------------- | ------------------------------------------------------ | ------- |
| **Any component**                  | Quick Start + Design Tokens + that component's section | ~2K     |
| **A new atom (Button, Input...)**  | Quick Start + Tokens + Atom Catalog + CSS Layers       | ~3K     |
| **A new molecule (GlassPanel...)** | Quick Start + Tokens + Atom Catalog + Molecule Catalog | ~4K     |
| **A new organism (Sidebar...)**    | Quick Start + Tokens + Organism Catalog + Templates    | ~5K     |
| **A new page**                     | Quick Start + Tokens + Templates + Page Structure      | ~3K     |
| **CSS/tokens only**                | Design Tokens + CSS Layers                             | ~2K     |
| **Full system overview**           | Quick Start + Entire document                          | ~12K    |

### ⚡ Quick Start (always load first)

```yaml
Stack:
  base: Next.js 15 + React 19 + TypeScript
  styling: Tailwind CSS 3.4 + PostCSS
  accessibility: Radix UI primitives (Slot, Dialog, Tooltip, Toast, Toggle, Progress, Label)
  icons: lucide-react
  fonts: Space Grotesk (display), Inter (body), JetBrains Mono (mono)
  state: Zustand (client) + TanStack Query (server) + Socket.io (realtime)

Key Decisions:
  corners: Tailwind rounded defaults (rounded-sm → rounded-xl)
  background: #05060B (radial-gradient overlay)
  glass: bg-surface-dim/80 + backdrop-blur-xl + border-primary/30
  neon: theme() function, never hardcoded rgba
  edge opacity: 30% fixed (primary/30 or secondary/30)
  focus: focus-visible:ring-2 ring-secondary-fixed (visible, not suppressed)
  components: 5 states mandatory (default/hover/focus/active/disabled)
    + Loading/Empty/Error for data components
  motion: prefers-reduced-motion respected

File Structure: src/
  ├── styles/
  │   ├── tokens/          → colors.ts, typography.ts, spacing.ts, animations.ts
  │   ├── base.css         → @layer base
  │   ├── components.css   → @layer components (glass-panel, glow utils)
  │   └── utilities.css    → @layer utilities
  ├── components/
  │   ├── ui/              → Atoms (Button, Input, Avatar...) + Molecules (FormField, Toast...)
  │   ├── game/            → Game-specific organisms (AnswerTile, Timer, PlayerGrid...)
  │   ├── layout/          → Templates (GameShell, AppShell, AuthShell)
  │   └── overlay/         → Overlays (ReconnectOverlay, SpectatorOverlay, AFKWarning...)
  └── app/
  ├── (auth)/          → AuthShell → Landing
  ├── (game)/          → GameShell → Arena, Spectator, SuddenDeath
  └── (app)/           → AppShell  → Lobby, RoomConfig, Rankings, MatchSummary, Profile, Settings
```

---

## 🎨 DESIGN TOKENS

### Colors

**Palette:** Cyberpunk neon — Purple (Player) + Cyan (Tech) + Yellow (Alert) + Red (Danger)

| CSS Variable                  | Hex       | Role                                         | Tailwind Class                 |
| ----------------------------- | --------- | -------------------------------------------- | ------------------------------ |
| `--primary`                   | `#ecb2ff` | Player identity, CTA chính, streak, level-up | `text-primary`, `bg-primary`   |
| `--on-primary`                | `#2f0049` | Text on primary bg                           | `text-on-primary`              |
| `--primary-container`         | `#4a1d6a` | Container bg (subtle)                        | `bg-primary-container`         |
| `--on-primary-container`      | `#f3d9ff` | Text on primary container                    | `text-on-primary-container`    |
| `--secondary-fixed`           | `#7df4ff` | Text highlight, active indicator, progress   | `text-secondary-fixed`         |
| `--on-secondary-fixed`        | `#00363a` | Text on secondary-fixed bg                   | `text-on-secondary-fixed`      |
| `--secondary-container`       | `#00eefc` | Action button bg, border glow solid          | `bg-secondary-container`       |
| `--on-secondary-container`    | `#002022` | Text on secondary-container                  | `text-on-secondary-container`  |
| `--tertiary`                  | `#e9c400` | Timer <25%, warning, sudden death            | `text-tertiary`                |
| `--on-tertiary`               | `#3a3000` | Text on tertiary bg                          | `text-on-tertiary`             |
| `--error`                     | `#ffb4ab` | Eliminate, kick, kill switch                 | `text-error`                   |
| `--on-error`                  | `#690005` | Text on error bg                             | `text-on-error`                |
| `--background`                | `#05060B` | Page background                              | `bg-background`                |
| `--on-background`             | `#e4e1e6` | Body text on background                      | `text-on-background`           |
| `--surface-dim`               | `#12131c` | Glass panel bg (80% opacity)                 | `bg-surface-dim`               |
| `--surface-container`         | `#1a1b26` | Elevated surface                             | `bg-surface-container`         |
| `--surface-container-high`    | `#252640` | Higher elevation                             | `bg-surface-container-high`    |
| `--surface-container-highest` | `#30314b` | Highest elevation                            | `bg-surface-container-highest` |

**Usage rules:**

- Glass backgrounds: always `bg-surface-dim/80` (not `surface-container`)
- Borders: always `primary/30` or `secondary-fixed/30` (not other colors)
- Text glow: `secondary-fixed` for data, `primary` for player names
- Button solid bg: `secondary-container` for action, `primary` for primary CTA

### Typography

| Token            | Tailwind Class | Font Family    | Size | Usage                     |
| ---------------- | -------------- | -------------- | ---- | ------------------------- |
| `display-lg`     | `text-5xl`     | Space Grotesk  | 48px | Hero heading              |
| `display-sm`     | `text-4xl`     | Space Grotesk  | 36px | Page title                |
| `display-mobile` | `text-3xl`     | Space Grotesk  | 30px | Section heading mobile    |
| `headline-md`    | `text-2xl`     | Space Grotesk  | 24px | Card heading              |
| `headline-sm`    | `text-xl`      | Space Grotesk  | 20px | Sub-heading               |
| `body-lg`        | `text-lg`      | Inter          | 18px | Body large                |
| `body-md`        | `text-base`    | Inter          | 16px | Body default              |
| `body-sm`        | `text-sm`      | Inter          | 14px | Body small, label         |
| `label-caps`     | `text-xs`      | Inter          | 12px | Label uppercase           |
| `micro`          | `text-[10px]`  | JetBrains Mono | 10px | Stream data, micro labels |

**Font loading (next/font):**

```ts
// In root layout.tsx
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";

const displayFont = Space_Grotesk({
  subsets: ["latin", "vietnamese"],
  variable: "--font-display",
});
const bodyFont = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-body",
});
const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});
```

### Spacing

```typescript
// tailwind.config.ts extend
spacing: {
  'unit': '4px',
  'gutter': '16px',
  'margin-mobile': '20px',
  'margin-desktop': '40px',
  'section': '32px',
  'section-lg': '48px',
  'card-padding': '24px',
  'card-padding-sm': '16px',
  'icon-gap': '12px',
  'icon-gap-sm': '8px',
  'nav-height': '64px',
}
```

### Animations

| Name            | Duration       | Easing        | Usage                         |
| --------------- | -------------- | ------------- | ----------------------------- |
| `flicker`       | 150ms infinite | `steps(2)`    | Button hover, text glitch     |
| `pulse-warning` | 1s infinite    | `ease-in-out` | Timer <25%, sudden death ring |
| `shake`         | 400ms          | `ease-in-out` | Wrong answer feedback         |
| `slide-up`      | 300ms          | `ease-out`    | Component enter               |
| `fade-in`       | 200ms          | `ease-out`    | Opacity transition            |
| `shimmer`       | 2s infinite    | `linear`      | Skeleton loading              |

**CSS Variables:**

```css
:root {
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --duration-dramatic: 500ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 📐 CSS LAYERS

### `src/styles/base.css` — @layer base

```css
@layer base {
  body {
    @apply bg-background text-on-background font-body antialiased;
    background-image: radial-gradient(
      circle at 50% 50%,
      rgba(18, 20, 31, 0.5) 0%,
      #05060b 100%
    );
    background-attachment: fixed;
  }
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: theme("colors.surface-container-highest");
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: theme("colors.secondary-fixed");
  }
  *:focus-visible {
    @apply outline-none ring-2 ring-secondary-fixed ring-offset-2 ring-offset-background;
  }
}
```

### `src/styles/components.css` — @layer components

```css
@layer components {
  .glass-panel {
    background-color: theme("colors.surface-dim / 80%");
    backdrop-filter: blur(20px);
    border: 1px solid theme("colors.primary / 30%");
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
  }
  .glass-panel-secondary {
    background-color: theme("colors.surface-dim / 80%");
    backdrop-filter: blur(20px);
    border: 1px solid theme("colors.secondary-fixed / 30%");
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
  }
  .glow-primary {
    box-shadow: 0 0 20px theme("colors.primary / 30%");
  }
  .glow-secondary {
    box-shadow: 0 0 20px theme("colors.secondary-fixed / 30%");
  }
  .glow-tertiary {
    box-shadow: 0 0 25px theme("colors.tertiary / 40%");
  }
  .glow-error {
    box-shadow: 0 0 25px theme("colors.error / 40%");
  }
  .text-glow-cyan {
    text-shadow: 0 0 8px theme("colors.secondary-fixed / 80%");
  }
  .text-glow-purple {
    text-shadow: 0 0 8px theme("colors.primary / 80%");
  }
  .text-glow-gold {
    text-shadow: 0 0 8px theme("colors.tertiary / 80%");
  }
}
```

### `src/styles/utilities.css` — @layer utilities

```css
@layer utilities {
  .cursor-blink::after {
    content: "_";
    animation: blink 1s step-end infinite;
  }
  .scanlines {
    background: linear-gradient(
      to bottom,
      transparent 50%,
      rgba(0, 0, 0, 0.05) 50%
    );
    background-size: 100% 4px;
  }
}
```

### `src/app/globals.css` — Entry point

```css
@import "tailwindcss";
@import "../styles/base.css";
@import "../styles/components.css";
@import "../styles/utilities.css";
```

---

## 🧩 COMPONENT CATALOG

---

### TIER 1: ATOMS (`src/components/ui/`)

> **Rule:** Every atom must implement 5 states: default, hover, focus-visible, active, disabled.
> **Accessibility:** All atoms expose `className` for extension. Interactive atoms wrap Radix primitives.

---

#### 1. Button

| Property       | Detail                                                      |
| -------------- | ----------------------------------------------------------- |
| **File**       | `src/components/ui/button.tsx`                              |
| **Radix Base** | `Slot` (for `asChild` support)                              |
| **Variants**   | `action`, `primary`, `secondary`, `danger`, `ghost`, `icon` |
| **Sizes**      | `sm`, `md`, `lg`                                            |

**Variant specs:**

| Variant     | Background                  | Text                                  | Hover                                                                                           | Active                                 |
| ----------- | --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| `action`    | `bg-secondary-container`    | `text-on-secondary-container rounded` | `hover:brightness-110 hover:animate-flicker hover:shadow-[0_0_25px_var(--secondary-container)]` | `active:scale-95 active:brightness-90` |
| `primary`   | `bg-primary`                | `text-on-primary rounded-lg`          | `hover:brightness-110`                                                                          | `active:scale-95`                      |
| `secondary` | `bg-surface-container-high` | `text-secondary-fixed rounded-lg`     | `hover:bg-surface-container-highest`                                                            | `active:scale-95`                      |
| `danger`    | `bg-error`                  | `text-on-error rounded-lg`            | `hover:brightness-110`                                                                          | `active:scale-95`                      |
| `ghost`     | transparent                 | `text-on-background`                  | `hover:bg-surface-container/50`                                                                 | `active:bg-surface-container`          |
| `icon`      | transparent                 | `text-on-background`                  | `hover:bg-surface-container/50`                                                                 | `active:scale-90`                      |

**States (all variants):**

- `disabled`: `opacity-40 cursor-not-allowed pointer-events-none`
- `focus-visible`: inherited from base `*:focus-visible` (ring-2 ring-secondary-fixed)
- `loading`: shows `<Spinner size="sm" />` + disables interaction

```tsx
// Interface
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "action" | "primary" | "secondary" | "danger" | "ghost" | "icon";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  asChild?: boolean;
}
```

---

#### 2. Input

| Property       | Detail                                                  |
| -------------- | ------------------------------------------------------- |
| **File**       | `src/components/ui/input.tsx`                           |
| **Radix Base** | None (native input, but wrapped in FormField for label) |
| **Variants**   | `terminal`, `default`                                   |
| **Sizes**      | `sm`, `md`, `lg`                                        |

**Variant specs:**

| Variant    | Style                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `terminal` | `border-b-2 border-secondary-fixed/30 bg-transparent focus:border-secondary-fixed caret-secondary-fixed animate-pulse` |
| `default`  | `border border-primary/30 bg-surface-dim/50 rounded-lg focus:border-secondary-fixed`                                   |

```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "terminal" | "default";
  inputSize?: "sm" | "md" | "lg"; // renamed to avoid conflict with HTML size attr
}
```

---

#### 3. Avatar

| Property  | Detail                                             |
| --------- | -------------------------------------------------- |
| **File**  | `src/components/ui/avatar.tsx`                     |
| **Sizes** | `sm` (32px), `md` (48px), `lg` (64px), `xl` (96px) |

**3 render states:**

| State        | Condition                | Render                                                      |
| ------------ | ------------------------ | ----------------------------------------------------------- |
| **Image**    | `src` provided + loaded  | `<img>` with `mix-blend-luminosity opacity-80 rounded-full` |
| **Initials** | No `src` or image failed | `<div>` with 2-char initials, random bg from palette        |
| **Loading**  | `loading` prop true      | `<div>` with `animate-shimmer rounded-full`                 |

```tsx
interface AvatarProps {
  src?: string;
  name: string; // Used for initials fallback
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  className?: string;
}
```

---

#### 4. Badge

| Property     | Detail                                                |
| ------------ | ----------------------------------------------------- |
| **File**     | `src/components/ui/badge.tsx`                         |
| **Variants** | `online`, `eliminated`, `admin`, `warning`, `default` |

| Variant      | Style                                                       |
| ------------ | ----------------------------------------------------------- |
| `online`     | `bg-green-500/20 text-green-400 border-green-500/30`        |
| `eliminated` | `bg-error/20 text-error border-error/30`                    |
| `admin`      | `bg-primary/20 text-primary border-primary/30`              |
| `warning`    | `bg-tertiary/20 text-tertiary border-tertiary/30`           |
| `default`    | `bg-surface-container text-on-background border-primary/10` |

```tsx
interface BadgeProps {
  variant?: "online" | "eliminated" | "admin" | "warning" | "default";
  children: React.ReactNode;
  className?: string;
}
```

---

#### 5. Spinner

| Property  | Detail                                |
| --------- | ------------------------------------- |
| **File**  | `src/components/ui/spinner.tsx`       |
| **Sizes** | `sm` (16px), `md` (24px), `lg` (40px) |

```tsx
interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}
```

---

#### 6. Skeleton

| Property     | Detail                           |
| ------------ | -------------------------------- |
| **File**     | `src/components/ui/skeleton.tsx` |
| **Variants** | `text`, `circle`, `rect`         |

```tsx
interface SkeletonProps {
  variant?: "text" | "circle" | "rect";
  width?: string;
  height?: string;
  className?: string;
}
```

---

#### 7. Icon

| Property    | Detail                                             |
| ----------- | -------------------------------------------------- |
| **File**    | `src/components/ui/icon.tsx`                       |
| **Library** | `lucide-react`                                     |
| **Sizes**   | `sm` (16px), `md` (20px), `lg` (24px), `xl` (32px) |

```tsx
interface IconProps {
  icon: React.ElementType; // lucide-react icon component
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}
```

---

#### 8. Divider

| Property     | Detail                          |
| ------------ | ------------------------------- |
| **File**     | `src/components/ui/divider.tsx` |
| **Variants** | `horizontal`, `vertical`        |
| **Glow**     | boolean (uses `glow-primary`)   |

```tsx
interface DividerProps {
  orientation?: "horizontal" | "vertical";
  glow?: boolean;
  className?: string;
}
```

---

### TIER 2: MOLECULES (`src/components/ui/`)

> **Rule:** Molecules combine 2+ Atoms. Must handle `loading`, `empty`, and `error` states where applicable.

---

#### 9. GlassPanel

| Property     | Detail                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| **File**     | `src/components/ui/glass-panel.tsx`                                                                            |
| **Variants** | `default` (primary/30 border), `secondary` (secondary-fixed/30 border), `elevated` (surface-container-high bg) |
| **Glow**     | `none`, `primary`, `secondary`, `tertiary`, `error`                                                            |

```tsx
interface GlassPanelProps {
  variant?: "default" | "secondary" | "elevated";
  glow?: "none" | "primary" | "secondary" | "tertiary" | "error";
  children: React.ReactNode;
  className?: string;
}
```

---

#### 10. FormField

| Property       | Detail                             |
| -------------- | ---------------------------------- |
| **File**       | `src/components/ui/form-field.tsx` |
| **Atoms Used** | Input + Label                      |
| **States**     | default, error, disabled           |

```tsx
interface FormFieldProps {
  label: string; // REQUIRED — renders <label htmlFor={id}>
  id: string;
  error?: string;
  children: React.ReactNode; // Input component
  className?: string;
}
```

---

#### 11. Toast

| Property       | Detail                                      |
| -------------- | ------------------------------------------- |
| **File**       | `src/components/ui/toast.tsx`               |
| **Radix Base** | `Toast` + `ToastProvider` + `ToastViewport` |
| **Variants**   | `info`, `success`, `warning`, `error`       |

```tsx
// Usage via custom hook
const { toast } = useToast();
toast({ title: "Đã lưu!", variant: "success" });
```

**Provider setup in root layout:**

```tsx
<ToastProvider>
  {children}
  <ToastViewport className="fixed bottom-0 right-0 p-4 z-50" />
</ToastProvider>
```

---

#### 12. Tooltip

| Property       | Detail                                          |
| -------------- | ----------------------------------------------- |
| **File**       | `src/components/ui/tooltip.tsx`                 |
| **Radix Base** | `Tooltip` + `TooltipTrigger` + `TooltipContent` |

```tsx
<Tooltip content="Thông báo">
  <IconButton icon={Bell} aria-label="Thông báo" />
</Tooltip>
```

---

#### 13. IconButton

| Property       | Detail                                              |
| -------------- | --------------------------------------------------- |
| **File**       | `src/components/ui/icon-button.tsx`                 |
| **Atoms Used** | Button (variant="icon") + Icon + Tooltip (optional) |

```tsx
interface IconButtonProps {
  icon: React.ElementType;
  "aria-label": string; // REQUIRED for accessibility
  tooltip?: string; // Optional — wraps in Tooltip if provided
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "secondary";
  className?: string;
}
```

---

#### 14. PlayerBadge

| Property       | Detail                                 |
| -------------- | -------------------------------------- |
| **File**       | `src/components/game/player-badge.tsx` |
| **Atoms Used** | Avatar + Badge + Text                  |

```tsx
interface PlayerBadgeProps {
  name: string;
  avatar?: string;
  status?: "online" | "eliminated" | "spectating";
  isHost?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}
```

---

#### 15. AnswerTile

| Property       | Detail                                          |
| -------------- | ----------------------------------------------- |
| **File**       | `src/components/game/answer-tile.tsx`           |
| **Atoms Used** | GlassPanel + Text                               |
| **Radix Base** | `Toggle`                                        |
| **States**     | default, selected, correct, incorrect, disabled |

| State     | Style                                                              |
| --------- | ------------------------------------------------------------------ |
| default   | `glass-panel` + `hover:border-secondary-fixed/50`                  |
| selected  | `border-primary border-2 shadow-[0_0_20px_var(--primary)/40%]`     |
| correct   | `border-green-500 border-2 shadow-[0_0_20px_rgba(46,204,113,0.4)]` |
| incorrect | `border-error border-2 animate-shake`                              |
| disabled  | `opacity-40 pointer-events-none`                                   |

```tsx
interface AnswerTileProps {
  label: string; // "A", "B", "C", "D"
  text: string; // Answer text
  state?: "default" | "selected" | "correct" | "incorrect" | "disabled";
  onSelect?: () => void;
  disabled?: boolean;
}
```

---

#### 16. Timer

| Property       | Detail                          |
| -------------- | ------------------------------- |
| **File**       | `src/components/game/timer.tsx` |
| **Atoms Used** | Text (mono) + ProgressBar       |

| Condition   | Style                                                       |
| ----------- | ----------------------------------------------------------- |
| > 50% time  | `text-secondary-fixed`                                      |
| 25-50% time | `text-secondary-fixed`                                      |
| < 25% time  | `text-tertiary animate-pulse-warning glow-tertiary`         |
| < 5s        | `text-error animate-pulse-warning glow-error` + larger size |

```tsx
interface TimerProps {
  totalMs: number; // Total round duration
  remainingMs: number; // Remaining time
  size?: "sm" | "md" | "lg";
}
```

---

#### 17. ProgressBar

| Property       | Detail                           |
| -------------- | -------------------------------- |
| **File**       | `src/components/ui/progress.tsx` |
| **Radix Base** | `Progress`                       |

```tsx
interface ProgressBarProps {
  value: number; // 0-100
  variant?: "primary" | "secondary" | "tertiary" | "error";
  size?: "sm" | "md" | "lg";
  animated?: boolean;
  className?: string;
}
```

---

### TIER 3: ORGANISMS (`src/components/{layout,game,overlay}/`)

> **Rule:** Organisms are complete UI sections with independent state. Must handle loading, empty, error states.

---

#### 18. Sidebar

| Property        | Detail                                        |
| --------------- | --------------------------------------------- |
| **File**        | `src/components/layout/sidebar.tsx`           |
| **Width**       | `w-64` (desktop), full-width overlay (mobile) |
| **arria-label** | `"Điều hướng chính"`                          |

**Contents:**

- Logo + app name
- Nav links: Lobby, Rankings, Profile, Settings, Admin
- Player info footer (Avatar + name + status)
- Mobile: hamburger toggle, overlay on open

```tsx
// No props needed — reads from router + store
// Could accept: className for customization
```

---

#### 19. TopAppBar

| Property       | Detail                                                       |
| -------------- | ------------------------------------------------------------ |
| **File**       | `src/components/layout/top-app-bar.tsx`                      |
| **Height**     | `h-nav-height` (64px)                                        |
| **Visibility** | Mobile only (`md:hidden`)                                    |
| **Contents**   | Hamburger menu (opens Sidebar), page title, optional actions |

---

#### 20. PlayerGrid

| Property   | Detail                                                              |
| ---------- | ------------------------------------------------------------------- |
| **File**   | `src/components/game/player-grid.tsx`                               |
| **Layout** | Responsive grid: 10×10 (desktop), 5×20 (tablet), 3×~ (mobile)       |
| **States** | loading (skeleton grid), empty ("Chưa có người chơi..."), populated |

```tsx
interface PlayerGridProps {
  players: Player[];
  maxPlayers: number;
  loading?: boolean;
}
```

---

#### 21. AnswerGrid

| Property       | Detail                                                                |
| -------------- | --------------------------------------------------------------------- |
| **File**       | `src/components/game/answer-grid.tsx`                                 |
| **Layout**     | 2×2 grid (default), 2×3 (if 6 options)                                |
| **Atoms Used** | AnswerTile × 4 (or 6)                                                 |
| **States**     | active, disabled (after answering), revealed (show correct/incorrect) |

```tsx
interface AnswerGridProps {
  answers: { label: string; text: string }[];
  selectedAnswer?: string;
  correctAnswer?: string;
  disabled?: boolean;
  onSelect: (label: string) => void;
}
```

---

#### 22. QuestionCard

| Property     | Detail                                                          |
| ------------ | --------------------------------------------------------------- |
| **File**     | `src/components/game/question-card.tsx`                         |
| **Wrapper**  | GlassPanel (variant="elevated")                                 |
| **States**   | loading, active, fallback                                       |
| **Fallback** | "Câu hỏi gặp sự cố kỹ thuật. Đang chuyển sang câu tiếp theo..." |

```tsx
interface QuestionCardProps {
  questionNumber: number;
  totalQuestions: number;
  questionText?: string;
  category?: string;
  loading?: boolean;
  error?: boolean;
}
```

---

#### 23. Leaderboard

| Property   | Detail                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| **File**   | `src/components/game/leaderboard.tsx`                                   |
| **States** | loading (5 skeleton rows), empty ("Chưa có trận đấu nào..."), populated |

**Row format:** #[Rank] [Avatar] [Name] [Score] [Win rate]

Top 3 rows have special styling: gold/silver/bronze glow.

```tsx
interface LeaderboardProps {
  entries: LeaderboardEntry[];
  loading?: boolean;
  highlightUserId?: string; // Highlight current user's row
}
```

---

#### 24. MatchSummary

| Property     | Detail                                                                                  |
| ------------ | --------------------------------------------------------------------------------------- |
| **File**     | `src/components/game/match-summary.tsx`                                                 |
| **Sections** | Podium (top 3), Stats cards (# of players, duration, questions), Player standings table |
| **States**   | loading (podium skeleton + 3 stat card skeletons)                                       |

```tsx
interface MatchSummaryProps {
  matchData: MatchResult;
  loading?: boolean;
}
```

---

#### 25. Modal

| Property       | Detail                                                                             |
| -------------- | ---------------------------------------------------------------------------------- |
| **File**       | `src/components/ui/modal.tsx`                                                      |
| **Radix Base** | `Dialog` + `DialogTrigger` + `DialogContent` + `DialogTitle` + `DialogDescription` |
| **Wrapper**    | GlassPanel (variant="elevated", glow="secondary")                                  |

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

---

#### 26. ReconnectOverlay

| Property   | Detail                                                                                 |
| ---------- | -------------------------------------------------------------------------------------- |
| **File**   | `src/components/overlay/reconnect-overlay.tsx`                                         |
| **States** | connecting, syncing (show progress "3/12 events"), timeout (show retry + exit buttons) |

```tsx
interface ReconnectOverlayProps {
  state: "connecting" | "syncing" | "timeout";
  syncedEvents?: number;
  totalEvents?: number;
  onRetry?: () => void;
  onExit?: () => void;
}
```

---

#### 27. SpectatorOverlay

| Property     | Detail                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| **File**     | `src/components/overlay/spectator-overlay.tsx`                           |
| **Contents** | Footer bar "BẠN ĐANG XEM — 42 người đang xem", Emote panel (👏 😱 🔥 💀) |

```tsx
interface SpectatorOverlayProps {
  spectatorCount: number;
  onEmote: (emote: string) => void;
}
```

---

#### 28. AFKWarning

| Property  | Detail                                       |
| --------- | -------------------------------------------- |
| **File**  | `src/components/overlay/afk-warning.tsx`     |
| **Type**  | Countdown toast with action button           |
| **Timer** | 10s countdown → auto transition to spectator |

```tsx
interface AFKWarningProps {
  remainingSeconds: number;
  onContinue: () => void;
}
```

---

#### 29. ExitDialog

| Property     | Detail                                                     |
| ------------ | ---------------------------------------------------------- |
| **File**     | `src/components/overlay/exit-dialog.tsx`                   |
| **Base**     | Modal (see #25)                                            |
| **Contents** | "Rời trận đấu? Bạn sẽ không thể quay lại." + [Ở lại] [Rời] |

```tsx
interface ExitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}
```

---

#### 30. SettingsForm

| Property     | Detail                                                     |
| ------------ | ---------------------------------------------------------- |
| **File**     | `src/components/layout/settings-form.tsx`                  |
| **Sections** | Audio, Display (color blind mode), Language, Notifications |
| **States**   | loading, saved, error                                      |

```tsx
// Reads/writes via Zustand settings store
// Each field uses FormField
```

---

#### 31. RoomConfigForm

| Property   | Detail                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| **File**   | `src/components/game/room-config-form.tsx`                                          |
| **Fields** | Room name (Input terminal), Max players (select), Category (select), Private toggle |
| **States** | default, validating                                                                 |

```tsx
// Form fields: FormField wrapping Input/Select/Toggle
```

---

### TIER 4: TEMPLATES (`src/components/layout/`)

> **Rule:** Templates are layout shells. They define the page structure (sidebar, header, main area). Pages fill in the content.

---

#### 32. GameShell

| Property         | Detail                                                  |
| ---------------- | ------------------------------------------------------- |
| **File**         | `src/components/layout/game-shell.tsx`                  |
| **Layout**       | Fullscreen, no nav, centered game content               |
| **Uses**         | Arena, Spectator, SuddenDeath                           |
| **Key behavior** | Prevents accidental navigation (intercept browser back) |

```tsx
// Usage in layout.tsx:
// <GameShell>{children}</GameShell>
```

---

#### 33. AppShell

| Property      | Detail                                                         |
| ------------- | -------------------------------------------------------------- |
| **File**      | `src/components/layout/app-shell.tsx`                          |
| **Layout**    | Sidebar (w-64) + Main content area                             |
| **Mobile**    | TopAppBar + hamburger Sidebar overlay                          |
| **Uses**      | Lobby, Rankings, MatchSummary, Profile, Settings, Admin        |
| **Main area** | `max-w-[1280px] mx-auto px-margin-mobile md:px-margin-desktop` |
| **Skip link** | White-on-cyan, sr-only except on focus                         |

```tsx
// Renders: SkipLink > TopAppBar (mobile) > Sidebar > <main id="main-content">{children}</main>
```

---

#### 34. AuthShell

| Property       | Detail                                 |
| -------------- | -------------------------------------- |
| **File**       | `src/components/layout/auth-shell.tsx` |
| **Layout**     | Centered, minimal, full-height         |
| **Uses**       | Landing page                           |
| **Background** | Inherits body radial-gradient          |

```tsx
// <main className="min-h-screen flex flex-col items-center justify-center px-margin-mobile">
//   {children}
// </main>
```

---

## 📄 PAGE STRUCTURE

```
src/app/
├── layout.tsx                    ← Root: fonts, metadata, ToastProvider, skip-to-content
├── globals.css
│
├── (auth)/
│   ├── layout.tsx                ← AuthShell
│   └── page.tsx                  ← Landing (/)
│
├── (game)/
│   ├── layout.tsx                ← GameShell (fullscreen, intercept back nav)
│   ├── arena/[matchId]/page.tsx  ← Arena (quiz gameplay)
│   ├── spectate/[matchId]/page.tsx ← Spectator mode
│   └── sudden-death/[matchId]/page.tsx ← Tie-break UI
│
└── (app)/
    ├── layout.tsx                ← AppShell (sidebar + main)
    ├── lobby/[code]/page.tsx     ← Game Lobby (player grid, room config)
    ├── room-config/page.tsx      ← Create/configure room
    ├── rankings/page.tsx         ← Global leaderboard
    ├── match-summary/[id]/page.tsx ← Post-match results
    ├── profile/page.tsx          ← Player profile + match history
    ├── settings/page.tsx         ← Settings form
    └── admin/page.tsx            ← Admin console (not in DESIGN.md, placeholder)
```

---

## 🔄 IMPLEMENTATION PLAN

**Dependency graph** — must follow order. Each step lists blockers (other steps that must complete first).

| Step   | Task                                                                                      | Blockers                                         | ~Effort |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------ | ------- |
| **1**  | **Design Tokens** — Update tailwind.config.ts with all colors, fonts, spacing, animations | None                                             | M       |
| **2**  | **CSS Layers** — Create base.css, components.css, utilities.css, update globals.css       | 1                                                | S       |
| **3**  | **Root Layout** — next/font imports, ToastProvider, skip-to-content, metadata             | 2                                                | S       |
| **4**  | **Icon + Spinner** — Simple, no dependencies                                              | None                                             | S       |
| **5**  | **GlassPanel** — Core building block for all cards/panels                                 | 2                                                | S       |
| **6**  | **Skeleton** — Needed for loading states                                                  | 2                                                | S       |
| **7**  | **Button** — Radix Slot + all 6 variants + loading state                                  | 2, 4                                             | M       |
| **8**  | **Input** — Both variants (terminal + default)                                            | 2                                                | S       |
| **9**  | **Badge + Avatar** — 5 variants + 3 render states                                         | None                                             | M       |
| **10** | **FormField + Tooltip + Toast** — First molecules                                         | 2, 4, 7, 8                                       | M       |
| **11** | **Modal** — Radix Dialog + GlassPanel                                                     | 5, 7                                             | M       |
| **12** | **PlayerBadge + Timer + ProgressBar** — Game-specific molecules                           | 2, 5, 9                                          | M       |
| **13** | **AnswerTile** — GlassPanel + Toggle + 5 states                                           | 2, 5                                             | M       |
| **14** | **IconButton** — Button + Icon + Tooltip                                                  | 4, 7, 12 (Tooltip)                               | S       |
| **15** | **Sidebar + TopAppBar** — Navigation organisms                                            | 5, 7, 9, 14                                      | L       |
| **16** | **PlayerGrid + AnswerGrid + QuestionCard** — Game organisms                               | 5, 12 (AnswerTile), 13 (Timer)                   | L       |
| **17** | **Templates** — GameShell, AppShell, AuthShell                                            | 15                                               | L       |
| **18** | **Pages (auth)** — Landing                                                                | 7, 17 (AuthShell)                                | M       |
| **19** | **Pages (app)** — Lobby, Rankings, Profile, Settings                                      | 15, 16 (PlayerGrid), 17 (AppShell)               | L       |
| **20** | **Pages (game)** — Arena, Spectator, SuddenDeath                                          | 13, 16 (AnswerGrid/QuestionCard), 17 (GameShell) | XL      |
| **21** | **Overlay organisms** — ReconnectOverlay, SpectatorOverlay, AFKWarning, ExitDialog        | 5, 11 (Modal), 13 (Timer)                        | L       |
| **22** | **Leaderboard + MatchSummary** — Data-heavy organisms                                     | 5, 6, 9                                          | L       |
| **23** | **RoomConfigForm + SettingsForm** — Form organisms                                        | 5, 8, 10, 12 (Toggle)                            | M       |
| **24** | **Toast integration** — Wire useToast into stores for socket events                       | 10                                               | S       |
| **25** | **Remaining pages** — Admin, RoomConfig, MatchSummary                                     | 17, 22, 23, 24                                   | M       |

---

## 🔗 REFERENCES

| Document                                                      | Purpose                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `memory-bank/designAudit.md`                                  | Full audit of all 30 design decisions (resolved + pending)          |
| `stitch_collaborative_design_workflow/arena_of_100/DESIGN.md` | Original design spec (shape, color, typography, button/input rules) |
| `memory-bank/projectbrief.md`                                 | MVP feature list                                                    |
| `memory-bank/productContext.md`                               | User scenarios                                                      |
| `memory-bank/activeContext.md`                                | Current development context                                         |
| `apps/web/tailwind.config.ts`                                 | Current (placeholder) Tailwind config — will be replaced            |

---

## 📝 CONVENTIONS

1. **Never suppress focus rings** — Always visible for keyboard nav (`focus-visible:ring-2`).
2. **All form controls have labels** — Via `FormField` wrapper, `htmlFor` + `id` linked.
3. **All icon-only buttons have `aria-label`** — Enforced by `IconButton` component.
4. **Edge opacity is always 30%** — `primary/30` or `secondary-fixed/30`, never custom.
5. **Animations respect `prefers-reduced-motion`** — Handled in `base.css`.
6. **5 states for every interactive component** — default, hover, focus-visible, active, disabled.
7. **3 extra states for data components** — loading, empty, error.
8. **Glass panels use `bg-surface-dim/80`** — Not `surface-container` variants.
9. **Neon effects use `theme()` function** — Never hardcoded rgba.
10. **Skip-to-content link in every page** — In `AppShell` template.
