# Frontend Enterprise Follow-ups

> Created: 2026-06-06  
> Purpose: track remaining frontend quality work for the next PR after Step 5 rewire.

---

## What was completed in this PR

- Replaced `/profile` and `/rankings` mock data with real APIs.
- Added avatar persistence UI in `/settings`.
- Introduced reusable atomic UI pieces:
  - `mini-glyph.tsx`
  - `dashboard-section-title.tsx`
  - `message-card.tsx`
  - `sprite-frame.tsx`
  - `panel-section.tsx`
- Reduced `lucide-react` usage in the newly touched surfaces by replacing repeated icons with inline SVG glyphs.
- Added `skip-to-main-content` support in `AppShellLayout`.
- Added scoped audit scripts for `apps/web/src`.

---

## Recommended next PR scope

### 1. Shared UI audit cleanup

Target files:

- `apps/web/src/components/ui/divider.tsx`
- `apps/web/src/components/ui/spinner.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/toast.tsx`
- `apps/web/src/components/ui/glass-panel.tsx`

Goals:

- Increase tap targets where interactive.
- Add clearer typography defaults (`leading-*`, optional fluid sizing where meaningful).
- Decide whether `glass-panel` should remain in the system or be deprecated in favor of a stricter panel primitive.

### 2. Home page quality pass

Target file:

- `apps/web/src/app/[locale]/page.tsx`

Goals:

- Add proper `htmlFor`/`id` pairing for the room-code input label.
- Reduce icon-lib usage in the hero/control surface.
- Review button sizing and spacing for a cleaner enterprise-style baseline.
- Consider extracting the avatar selector on the home page into its own atomic component.

### 3. Not-found surfaces consistency pass

Target files:

- `apps/web/src/app/not-found.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`

Goals:

- Add explicit skip-link handling or align with global shell expectations.
- Normalize typography and CTA sizing.
- Replace decorative repeated SVG snippets with shared primitives if worth it.

### 4. Game/Lobby atomic sweep

Target files:

- `apps/web/src/app/[locale]/game/[matchId]/page.tsx`
- `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`
- `apps/web/src/components/game/player-grid.tsx`

Goals:

- Reduce duplicate avatar/sprite framing code.
- Apply the same anti-slop SVG strategy to repeated status/info glyphs.
- Review layout rhythm and touch-target consistency.

### 5. Audit tooling hardening

Current status:

- `audit:ux` and `audit:a11y` were scoped down to `apps/web/src`.
- False positives were reduced, but the scripts are still heuristic-heavy.

Next improvements:

- Only require skip links on actual shell/page entry files.
- Separate "design heuristics" from "blocking accessibility issues".
- Emit machine-readable grouped output (true issue / heuristic / false-positive-prone rule).

---

## Suggested order for the next PR

1. Home page accessibility + atomic extraction
2. Shared UI primitives cleanup
3. Game/Lobby sweep
4. Final audit-tool refinement

---

## Definition of done for the next PR

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/web lint`
- `pnpm --filter @arena/web typecheck`
- `pnpm --filter @arena/web audit:ux` reviewed manually
- `pnpm --filter @arena/web audit:a11y` reviewed manually

Audit scripts are advisory, not release blockers, until false positives are reduced further.
