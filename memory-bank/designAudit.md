# Design Audit — Arena of 100

> Audit của hệ thống design từ `stitch_collaborative_design_workflow/` (1 DESIGN.md + 9 code.html).
> Đã thống nhất hướng giải quyết với team. Các mục ✅ đã có quyết định, ⏳ sẽ xử lý khi migrate.

**Ngày audit:** 2026-05-23  
**Ngày resolve:** 2026-05-24  
**Số pages:** 9 (admin, arena, lobby, room-config, rankings, landing, match-summary, profile, settings)  
**Design Spec:** `stitch_collaborative_design_workflow/arena_of_100/DESIGN.md`

---

## CRITICAL — Spec vs Implementation Mismatch

### 1. ✅ Shape Language → Dùng Tailwind Defaults (Rounded)

| Trước                                                       | Sau                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| DESIGN.md nói "Strictly Sharp, 0px radius, clipped corners" | **Bỏ sharp, dùng Tailwind defaults.** Tailwind rounded tokens (`rounded-sm`, `rounded`, `rounded-lg`, `rounded-xl`) tối ưu và nhất quán hơn. |
| Code đã dùng rounded → giữ nguyên                           | DESIGN.md sẽ được update: xóa section "Shapes", thay bằng "Shape: Tailwind rounded defaults".                                                |

**Lý do:** Tailwind rounded mặc định cho UX hiện đại, dễ maintain, không cần custom chamfer CSS.

### 2. ✅ Background Color → `#05060B`

**Quyết định:** Dùng `#05060B` làm màu background chính.

| Token        | Giá trị cũ | Giá trị mới |
| ------------ | ---------- | ----------- |
| `background` | `#12131c`  | `#05060B`   |

Các token `surface-*` giữ nguyên để tạo hiệu ứng glass panel nổi trên nền tối.

### 3. ✅ Button Spec → Tuân Thủ DESIGN.md

| Rule từ DESIGN.md                                                                                            | Cách implement                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Action Buttons: Sharp-edged (giờ dùng `rounded`), solid `secondary-container` bg + `on-secondary-fixed` text | `<Button variant="action">` component                                                            |
| Hover: flicker animation + expand outer glow                                                                 | `hover:animate-flicker hover:shadow-[0_0_25px_var(--secondary-container)]`                       |
| Input Fields: Bottom-border only + blinking cursor                                                           | `<Input variant="terminal">` component với `border-b-2` + `caret-secondary-fixed animate-pulse`  |
| Answer Tiles: Glassmorphic, chọn → border thicken + đổi sang purple                                          | `<AnswerTile>` component với `data-[selected=true]:border-primary data-[selected=true]:border-2` |

---

## HIGH — Code Quality & Maintainability

### 4. ✅ Tailwind Config → Extract 1 File Khi Migrate

Khi migrate sang Next.js:

```
apps/web/
├── tailwind.config.ts          ← Single source of truth
├── src/app/
│   ├── globals.css             ← @tailwind base/components/utilities
│   └── layout.tsx
```

Tất cả design tokens (colors, fontFamily, fontSize, spacing, borderRadius) sẽ được định nghĩa 1 lần trong `tailwind.config.ts`.

### 5. ✅ Tailwind CDN → PostCSS Plugin

Khi migrate:

```bash
pnpm add -D tailwindcss @tailwindcss/postcss
```

Cấu hình `postcss.config.mjs` + import `@tailwindcss` trong `globals.css`.

### 6. ✅ Edge Treatment Opacity → 30% Cố Định

**Rule cứng:** Tất cả glass panel border dùng `primary/30` hoặc `secondary/30`.

```css
/* GlassPanel base */
border: 1px solid theme("colors.primary / 30%");

/* Variant tech */
border: 1px solid theme("colors.secondary-fixed / 30%");
```

Các page có opacity khác (10%, 20%, 50%) sẽ được sửa về 30%.

### 7. ✅ GlassPanel → Shared Component

```tsx
// apps/web/components/ui/GlassPanel.tsx
interface GlassPanelProps {
  variant?: "default" | "secondary" | "elevated";
  glow?: "none" | "primary" | "secondary" | "tertiary";
  children: React.ReactNode;
  className?: string;
}
```

CSS thống nhất:

- `bg-surface-dim/80 backdrop-blur-xl`
- `border border-primary/30` (default) hoặc `border-secondary-fixed/30` (secondary)
- `shadow-[0_4px_30px_rgba(0,0,0,0.5)]`

### 8. ✅ Neon Glow → theme() Function

Tất cả shadow dùng `theme()` thay vì hardcoded rgba:

```css
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
```

---

## MEDIUM — Accessibility

### 9. ✅ aria-\* Attributes → Xử Lý Trong Quá Trình Code

Mỗi component sẽ tự mang `aria-label` hoặc `aria-labelledby` phù hợp khi được tạo:

| Component                           | aria strategy                                           |
| ----------------------------------- | ------------------------------------------------------- |
| `<IconButton icon="notifications">` | Nhận `aria-label` từ props (VD: `"Thông báo"`)          |
| `<Sidebar>`                         | `aria-label="Điều hướng chính"`                         |
| `<PlayerGrid>`                      | `aria-label="Danh sách người chơi"`                     |
| `<Timer>`                           | `aria-live="polite"` + `aria-label="Thời gian còn lại"` |

### 10. ✅ Focus Styles → Theo Chuẩn Settings Page

**Quyết định:** Follow pattern của `settings_console` — pattern tốt nhất hiện tại:

```css
/* Base layer: tất cả interactive elements */
@layer base {
  *:focus-visible {
    @apply outline-none ring-2 ring-secondary-fixed ring-offset-2 ring-offset-background;
  }
}
```

**Không dùng** `focus:ring-0` (suppress focus ring như landing page). Focus ring phải luôn visible cho keyboard navigation.

### 11. ✅ Form Labels → Xử Lý Trong Base Components

Mỗi form component sẽ có `label` bắt buộc:

```tsx
<InputField label="Callsign" id="callsign" />
// → render: <label htmlFor="callsign">Callsign</label> + <input id="callsign" />

<ToggleField label="Color Blind Mode" id="colorblind" />
// → render: <label htmlFor="colorblind">Color Blind Mode</label> + <input type="checkbox" id="colorblind" />

<SelectField label="Ngôn ngữ" id="language" options={...} />
// → render: <label htmlFor="language">Ngôn ngữ</label> + <select id="language" />
```

### 12. ✅ Skip-to-Content Link → Thêm Vào Layout Gốc

Thêm skip link vào `layout.tsx`:

```tsx
// apps/web/src/app/layout.tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4
             focus:z-[100] focus:px-4 focus:py-2 focus:bg-secondary-container
             focus:text-on-secondary-container focus:rounded"
>
  Bỏ qua điều hướng
</a>
<main id="main-content">{children}</main>
```

---

## LOW — Visual Polish & Inconsistencies

### 13. ✅ Player Avatars → Placeholder System

**Quyết định:** Tạo `<Avatar>` component với 3 trạng thái:

1. **Có ảnh:** Hiển thị ảnh với `mix-blend-luminosity opacity-80`
2. **Không có ảnh:** Hiển thị initials (2 chữ cái) với màu nền ngẫu nhiên từ palette
3. **Đang load:** Skeleton shimmer

```tsx
<Avatar src={user.avatar} name="CyberNinja" size="md" />
// Render path:
// - src exists → <img> with cyberpunk filter
// - no src → <div> với chữ "CN"
// - loading → <div className="animate-shimmer">
```

### 14. ✅ Color Token Naming → Convention Rõ Ràng

**Gợi ý cách dùng token nhất quán:**

| Nhóm token           | Cách dùng                                      | Ví dụ                             |
| -------------------- | ---------------------------------------------- | --------------------------------- |
| `*-container`        | Background của component (button, badge, card) | `bg-primary-container`            |
| `on-*-container`     | Text/icon trên `*-container`                   | `text-on-primary-container`       |
| `*-fixed`            | Màu accent cố định (không thay đổi theo theme) | `text-secondary-fixed`            |
| `*-fixed-dim`        | Phiên bản mờ hơn của fixed                     | `bg-secondary-fixed-dim/20`       |
| `on-*-fixed`         | Text trên `*-fixed` background                 | `text-on-secondary-fixed`         |
| `on-*-fixed-variant` | Text variant trên fixed                        | `text-on-secondary-fixed-variant` |

**Vai trò semantic của từng màu:**

| Màu                                   | Vai trò        | Dùng cho                                     |
| ------------------------------------- | -------------- | -------------------------------------------- |
| `primary` (Electric Purple #ecb2ff)   | Hero/Player    | Player identity, CTA chính, streak, level-up |
| `secondary-fixed` (Neon Cyan #7df4ff) | Tech/Data      | Text highlight, active indicator, progress   |
| `secondary-container` (#00eefc)       | Tech solid     | Action button bg, border glow                |
| `tertiary` (Warning Yellow #e9c400)   | Alert/Critical | Timer <25%, warning, sudden death            |
| `error` (Red #ffb4ab)                 | Danger         | Eliminate, kick, kill switch                 |

**Mẹo:** Khi cần text nổi bật → dùng `secondary-fixed`. Khi cần button solid → dùng `secondary-container`.

### 15. ✅ Typography Scale → Follow Tailwind

**Quyết định:** Dùng font-size của Tailwind thay vì custom scale trong DESIGN.md.

| Tailwind class     | Kích thước               | Dùng cho                  |
| ------------------ | ------------------------ | ------------------------- |
| `text-5xl` (48px)  | = `display-lg`           | Hero heading              |
| `text-4xl` (36px)  | = `display-sm`           | Page title                |
| `text-3xl` (30px)  | = `display-mobile`       | Section heading mobile    |
| `text-2xl` (24px)  | = `headline-md`          | Card heading              |
| `text-xl` (20px)   | = `headline-sm`          | Sub-heading (thêm)        |
| `text-lg` (18px)   | = `body-lg`              | Body lớn                  |
| `text-base` (16px) | = `body-md`              | Body mặc định             |
| `text-sm` (14px)   | = `body-sm` / `label-md` | Body nhỏ, label (thêm)    |
| `text-xs` (12px)   | = `label-caps`           | Label uppercase           |
| `text-[10px]`      | —                        | Micro label (stream data) |

Font families:

- `font-display` → Space Grotesk (headings)
- `font-body` → Inter (nội dung)
- `font-mono` → JetBrains Mono (data, code, labels)

### 16. ✅ Spacing System → Bổ Sung

**Hệ thống spacing hoàn chỉnh:**

```typescript
// tailwind.config.ts spacing extension
spacing: {
  // Giữ từ DESIGN.md
  'unit': '4px',           // Tight readouts (stream data)
  'gutter': '16px',        // Grid gap
  'margin-mobile': '20px', // Mobile safe area
  'margin-desktop': '40px',// Desktop safe area

  // Bổ sung
  'section': '32px',       // Vertical gap giữa các section
  'section-lg': '48px',    // Vertical gap lớn (hero → content)
  'card-padding': '24px',  // Internal padding của card
  'card-padding-sm': '16px',// Internal padding của card nhỏ
  'icon-gap': '12px',      // Icon-to-text gap
  'icon-gap-sm': '8px',    // Icon-to-text tight
  'nav-height': '64px',    // TopAppBar & SideNav height
}
```

**Vertical rhythm:** Mọi section cách nhau `section` (32px) hoặc `section-lg` (48px).

### 17. ✅ Responsive Breakpoints → Document Rõ

**Breakpoint system (theo Tailwind defaults):**

| Prefix   | Min width | Dùng cho                             |
| -------- | --------- | ------------------------------------ |
| _(none)_ | 0px       | Mobile first (base)                  |
| `sm:`    | 640px     | Tablet portrait                      |
| `md:`    | 768px     | Tablet landscape / Sidebar xuất hiện |
| `lg:`    | 1024px    | Desktop nhỏ                          |
| `xl:`    | 1280px    | Desktop (max-width container)        |
| `2xl:`   | 1536px    | Desktop lớn                          |

**Quy tắc responsive:**

- Mobile: Single column, full width, `margin-mobile` (20px)
- Tablet: Có thể 2 columns, sidebar ẩn (hamburger menu)
- Desktop: Sidebar visible (w-64), content `max-w-[1280px]`, `margin-desktop` (40px)

### 18. ✅ Component States → Bổ Sung Design System

**Mỗi component phải có đủ 5 states:**

| State              | Quy tắc                 | Ví dụ button                                              |
| ------------------ | ----------------------- | --------------------------------------------------------- |
| **Default**        | Trạng thái nghỉ         | `bg-secondary-container text-on-secondary-container`      |
| **Hover**          | Visual feedback rõ ràng | `hover:brightness-110 hover:shadow-glow`                  |
| **Focus**          | Keyboard focus visible  | `focus-visible:ring-2 focus-visible:ring-secondary-fixed` |
| **Active/Pressed** | Đang được nhấn          | `active:scale-95 active:brightness-90`                    |
| **Disabled**       | Không thể tương tác     | `opacity-40 cursor-not-allowed pointer-events-none`       |

**States bổ sung cho data components:**

| State       | Dùng khi                       | Implementation                        |
| ----------- | ------------------------------ | ------------------------------------- |
| **Loading** | Data đang fetch                | `<Skeleton>` hoặc `<Spinner>` variant |
| **Empty**   | Không có data                  | Illustration + message + CTA (nếu có) |
| **Error**   | Fetch fail / socket disconnect | Error card + retry button             |

**Ví dụ Loading States:**

```
Button loading:  <Spinner size="sm" /> + "Đang xử lý..."
Card loading:    <Skeleton className="h-32 rounded-lg" />
Grid loading:    Grid gồm 10 <Skeleton /> items
Avatar loading:  <div className="animate-shimmer rounded-full" />
```

**Ví dụ Empty States:**

```
Player Grid empty:   "Chưa có người chơi nào. Chia sẻ mã phòng để mời bạn bè!"
Rankings empty:      "Chưa có trận đấu nào được ghi nhận. Tham gia Arena đầu tiên!"
Notifications empty: "Không có thông báo mới."
```

**Ví dụ Error States:**

```
Socket disconnect:   Toast "Mất kết nối. Đang thử lại..." + semi-transparent overlay
API fail:            ErrorCard "Không thể tải dữ liệu" + nút "Thử lại"
```

### 19. ✅ Animation Guidelines → Thống Nhất

**Timing & Easing toàn hệ thống:**

```css
@layer base {
  :root {
    --duration-fast: 150ms; /* Micro-interactions: hover, focus */
    --duration-normal: 200ms; /* Transitions: color, opacity */
    --duration-slow: 300ms; /* Layout changes: expand, collapse */
    --duration-dramatic: 500ms; /* Hero animations */

    --ease-default: cubic-bezier(0.4, 0, 0.2, 1); /* ease-in-out */
    --ease-out: cubic-bezier(0, 0, 0.2, 1); /* ease-out */
    --ease-in: cubic-bezier(0.4, 0, 1, 1); /* ease-in */
    --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1); /* overshoot */
  }

  /* Tôn trọng người dùng giảm chuyển động */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

**Các animation đã định nghĩa:**

| Animation               | Duration       | Easing      | Mô tả                          |
| ----------------------- | -------------- | ----------- | ------------------------------ |
| `animate-flicker`       | 150ms infinite | steps(2)    | Text/button flicker trên hover |
| `animate-pulse-warning` | 1s infinite    | ease-in-out | Timer ring pulse khi <25%      |
| `animate-shake`         | 400ms          | ease-in-out | Incorrect answer shake         |
| `animate-slide-up`      | 300ms          | ease-out    | Component enter                |
| `animate-fade-in`       | 200ms          | ease-out    | Opacity transition             |
| `animate-shimmer`       | 2s infinite    | linear      | Skeleton loading               |

### 20. ✅ Custom CSS → Unify Thành Global + Utilities

**Cấu trúc CSS khi migrate:**

```
apps/web/
├── src/app/
│   └── globals.css                  ← Global styles
├── styles/
│   ├── base.css                     ← @layer base (body, scrollbar, focus)
│   ├── components.css               ← @layer components (glass-panel, neon-glow)
│   └── utilities.css                ← @layer utilities (text-glow, cursor-blink)
```

**Global CSS (globals.css) — import từng layer:**

```css
@import "tailwindcss";

@import "../styles/base.css";
@import "../styles/components.css";
@import "../styles/utilities.css";
```

**`styles/base.css` — Background, scrollbar, focus:**

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

**`styles/components.css` — GlassPanel, NeonGlow, TextGlow:**

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

**`styles/utilities.css`:**

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

---

## CRITICAL — Missing Features (Chưa Có UI Prototype)

Các tính năng này nằm trong MVP theo `projectbrief.md` và `productContext.md` nhưng chưa có page HTML trong design system. Cần thiết kế khi code Next.js.

### 21. ❌ Spectator Mode — CRITICAL

> _projectbrief.md #5, #6 | productContext.md Scenario 3, 5_

Khi player bị loại hoặc join muộn → chuyển sang chế độ spectator. Chưa có UI nào.

**Cần thiết kế:**

- **Spectator overlay:** Semi-transparent footer bar hiển thị "BẠN ĐANG XEM" + số người chơi còn lại
- **Emote panel:** Row icon (👏, 😱, 🔥, 💀) để spectator tương tác, xuất hiện floating rồi fade
- **Spectator count:** "42 người đang xem" ở góc màn hình
- **Next match notification:** Toast "Trận tiếp theo bắt đầu sau 30s. Bạn sẽ tự động tham gia."

**Vị trí trong app:** `/spectate/[matchId]` — render chung page với game nhưng UI khác (không có answer buttons)

### 22. ❌ Reconnect Overlay — CRITICAL

> _projectbrief.md #14 | productContext.md Scenario 4_

Khi player mất kết nối, cần UI cho biết đang reconnect.

**Cần thiết kế:**

- **Overlay mờ:** Phủ toàn màn hình với `bg-background/80 backdrop-blur-xl`
- **Spinner + text:** Icon `sync` đang xoay + "ĐANG KẾT NỐI LẠI..."
- **Progress:** "Đồng bộ trạng thái... 3/12 events"
- **Timeout fallback:** Sau 10s → "Không thể kết nối. [Thử lại] [Thoát]"

### 23. ❌ Sudden Death / Tie-break — CRITICAL

> _projectbrief.md #12, #13_

Khi 2+ player cùng bị loại ở câu cuối, cần UI riêng cho tie-break.

**Cần thiết kế:**

- **Sudden Death banner:** "SUDDEN DEATH" với `text-tertiary` + pulse animation
- **Tie-break overlay:** So sánh response time giữa 2 player cuối cùng
- **Timer đặc biệt:** Nhanh hơn bình thường (8s thay vì 15s), màu tertiary glow mạnh hơn
- **Result:** "PLAYER_X thắng với 1.2s nhanh hơn"

### 24. ❌ Content Moderation Feedback — CRITICAL

> _projectbrief.md #1, #16 | productContext.md Scenario 11_

Khi nickname bị chặn hoặc user bị shadow ban, cần UI phản hồi.

**Cần thiết kế:**

- **Toast error:** "Tên không hợp lệ. Vui lòng chọn tên khác." với `border-error/50`
- **Shadow ban notification:** Toast màu tertiary "Tài khoản của bạn đang bị hạn chế."
- **Auto-assign name:** "Đã gán tên ngẫu nhiên: Player_8A3F" với animation

### 25. ❌ AFK Warning — CRITICAL

> _projectbrief.md #7 | productContext.md Scenario 6_

Player sắp bị kick vì không hoạt động, cần cảnh báo trước.

**Cần thiết kế:**

- **Toast countdown:** "Bạn sắp bị loại vì không hoạt động. [Tiếp tục chơi]" với timer đếm ngược 10s
- **Auto-spectator transition:** Chuyển mượt từ game → spectator mode với animation fade

---

## UX — Missing Edge Cases

### 26. ⚠️ Graceful Exit Confirmation

> _projectbrief.md #8_

Dialog xác nhận khi player rời game giữa chừng.

**Cần thiết kế:**

- **Modal:** "Rời trận đấu? Bạn sẽ không thể quay lại." + 2 nút [Ở lại] [Rời]
- **Mobile gesture:** Swipe down to exit (native feel)

### 27. ⚠️ Rematch CTA

> _projectbrief.md #15 | productContext.md Scenario 12_

Sau Match Summary, cần nút để chơi tiếp.

**Cần thiết kế:**

- **Match Summary footer:** 2 nút [Chơi lại] (cùng phòng) + [Phòng mới] (tạo phòng khác)
- **Auto-rematch countdown:** "Trận tiếp theo bắt đầu sau 15s..." nếu đủ người

### 28. ⚠️ Question Fallback UI

> _projectbrief.md #11 | productContext.md Scenario 9_

Khi câu hỏi bị lỗi (CDN down, encoding error).

**Cần thiết kế:**

- **Toast:** "Câu hỏi gặp sự cố kỹ thuật. Đang chuyển sang câu tiếp theo..." với icon `warning`
- **Skip animation:** Question card shrink + blur + slide out, câu mới slide in

### 29. ⚠️ Empty States Cho Từng Page

> _Đã đề cập ở #18 nhưng cần cụ thể cho từng page_

Mỗi page cần empty state riêng khi chưa có data:

| Page                        | Empty State Message                                                   |
| --------------------------- | --------------------------------------------------------------------- |
| Game Lobby (0 players)      | "Chưa có người chơi. Chia sẻ mã phòng **X7K-9P2** để mời bạn bè!"     |
| Rankings                    | "Chưa có trận đấu nào. Tham gia Arena đầu tiên để lên bảng xếp hạng!" |
| Match History (Profile)     | "Chưa có trận đấu nào. [Tham gia ngay]"                               |
| Admin Console (0 instances) | "Không có Arena instance nào đang chạy."                              |

### 30. ⚠️ Loading Skeletons Cho Data Pages

> _Đã đề cập ở #18 nhưng cần cụ thể_

| Page              | Loading State                                  |
| ----------------- | ---------------------------------------------- |
| Rankings          | 5 dòng skeleton với avatar circle + text lines |
| Lobby Player Grid | Grid 10×10 skeleton squares với shimmer        |
| Match Summary     | Podium skeleton + 3 stat card skeletons        |
| Profile Stats     | Radar chart skeleton + 4 stat card skeletons   |

---

## Tổng Kết: Tất Cả Đã Có Quyết Định

| Priority | #      | Vấn Đề                          | Quyết Định                                                   |
| -------- | ------ | ------------------------------- | ------------------------------------------------------------ |
| P0       | 1      | Shape language                  | ✅ Dùng Tailwind rounded defaults                            |
| P0       | 2      | Background color                | ✅ `#05060B`                                                 |
| P0       | 3      | Button/Input spec               | ✅ Tuân thủ DESIGN.md                                        |
| P1       | 4      | Tailwind config duplicate       | ✅ Extract 1 file `tailwind.config.ts`                       |
| P1       | 5      | Tailwind CDN                    | ✅ PostCSS plugin khi migrate                                |
| P1       | 6      | Edge opacity                    | ✅ 30% cố định (`primary/30` hoặc `secondary/30`)            |
| P1       | 7      | GlassPanel component            | ✅ `<GlassPanel variant="...">`                              |
| P1       | 8      | Neon glow hardcoded             | ✅ `theme()` function                                        |
| P2       | 9      | aria-\* attributes              | ✅ Xử lý trong quá trình code component                      |
| P2       | 10     | Focus styles                    | ✅ Theo chuẩn settings page (`focus-visible:ring-2`)         |
| P2       | 11     | Form labels                     | ✅ Xử lý trong base components                               |
| P2       | 12     | Skip-to-content                 | ✅ Thêm vào `layout.tsx`                                     |
| P3       | 13     | Avatar placeholder              | ✅ `<Avatar>` component (ảnh → initials → skeleton)          |
| P3       | 14     | Color token naming              | ✅ Document semantic roles cho từng nhóm token               |
| P3       | 15     | Typography scale                | ✅ Dùng Tailwind font-size defaults                          |
| P3       | 16     | Spacing system                  | ✅ Bổ sung section, card-padding, icon-gap                   |
| P3       | 17     | Responsive breakpoints          | ✅ Document Tailwind defaults                                |
| P3       | 18     | Component states                | ✅ Default/Hover/Focus/Active/Disabled + Loading/Empty/Error |
| P3       | 19     | Animation guidelines            | ✅ Timing + easing + `prefers-reduced-motion`                |
| P3       | 20     | CSS unification                 | ✅ Global `base/components/utilities` layers                 |
| **P0**   | **21** | **Spectator Mode UI**           | ⏳ Tạo page `/spectate/[matchId]` khi code Next.js           |
| **P0**   | **22** | **Reconnect Overlay**           | ⏳ Tạo `<ReconnectOverlay>` component                        |
| **P0**   | **23** | **Sudden Death / Tie-break UI** | ⏳ Tạo `<SuddenDeath>` + `<TieBreak>` components             |
| **P0**   | **24** | **Content Moderation Feedback** | ⏳ Toast component cho nickname blocked + shadow ban         |
| **P0**   | **25** | **AFK Warning**                 | ⏳ Toast countdown "Bạn sắp bị loại..."                      |
| P1       | 26     | Graceful Exit Confirmation      | ⏳ `<ExitDialog>` modal                                      |
| P1       | 27     | Rematch CTA                     | ⏳ Nút [Chơi lại] + [Phòng mới] trong Match Summary          |
| P1       | 28     | Question Fallback UI            | ⏳ Toast + skip animation                                    |
| P2       | 29     | Empty States từng page          | ⏳ Custom message cho từng data page                         |
| P2       | 30     | Loading Skeletons               | ⏳ Skeleton components cho Rankings, Lobby, Summary, Profile |

---

> **Status:** 1-20 ✅ Đã resolve. 21-30 ⏳ Sẽ xử lý khi code Next.js frontend.  
> **Design coverage:** 9/14 pages có prototype (64%). 5 pages thiếu (spectator, reconnect overlay, sudden death, moderation toast, AFK warning).  
> **Edge cases:** 5 UX gap (exit dialog, rematch, fallback, empty states, skeletons) sẽ được lấp khi build từng page.
