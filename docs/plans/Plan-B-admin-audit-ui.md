# Plan B — Admin Audit Panel UI

> Track độc lập (frontend). Chạy song song với A/C/D. Xem tổng quan: [Plan1.md](Plan1.md).
> Nguồn: `memory-bank/progress.md` → P1#3 (Optional). Backend đã xong, chỉ còn UI.

## Mục tiêu

Xây UI trong khu admin để xem/lọc/phân trang **audit events** của admin kill-switch (ai làm gì, khi nào). Backend đã cung cấp đầy đủ endpoint.

## Nền backend đã có (chỉ tiêu thụ, KHÔNG sửa)

- `apps/api/src/modules/admin/ops/admin-audit.ops.ts` — `appendAudit`, `getAuditEvents` (paginated).
- `apps/api/src/modules/admin/admin.controller.ts:108` — `@Get("audit-events")`.
- `apps/api/src/modules/admin/dto/get-audit-events.dto.ts` — query/response DTO **chỉ dùng cho controller side** (Zod schema + Swagger decoration); không phải nguồn type cho FE. **FE/BE shared types sống ở `@arena/shared`** (xem `packages/shared/src/audit.ts:24,35,57,73,82` — `KnownAuditEventType`, `AuditEventType`, `AuditEvent`, `GetAuditEventsParams`, `AuditEventsResponse`).
- Migration `20260618120000_admin_audit_event`.

## Vì sao độc lập

Chỉ thêm code trong `apps/web/src/app/[locale]/admin/` + component/hook FE. Không đụng `apps/api`, không đụng game-core/socket-store → không xung đột A/C/D.

## Phase

### Phase B1 — Data layer (FE)

- ✅ ĐÃ DONE: Audit-event types sống trong `@arena/shared`, KHÔNG sync từ `get-audit-events.dto.ts`.
  - `packages/shared/src/audit.ts:24,35,57,73,82` — `KnownAuditEventType`, `AuditEventType`,
    `AuditEvent`, `GetAuditEventsParams`, `AuditEventsResponse`.
  - `apps/web/src/lib/api/audit.ts:10` import `{ AuditEventsResponse, GetAuditEventsParams } from "@arena/shared"`
    — không import symbol nào từ `@arena/api`.
  - Shared contract: FE/BE consume the same `@arena/shared` symbols. Shape alignment vs controller
    Zod is **not** assumed zero-drift by construction — require contract tests or documented
    evidence (see Acceptance).
  - Open option "generate type from DTO" → đóng: không còn cần; types đã ở shared.
- [ ] API client gọi `GET /admin/audit-events` (đã có tại `apps/web/src/lib/api/audit.ts:40-46`:
      `getAuditEvents(params, token?)` qua `apiGetJson`).
- [ ] Hook `use-audit-events.ts`: phân trang (cursor/offset theo DTO), loading/error state
      (đã có tại `apps/web/src/hooks/use-audit-events.ts`).

### Phase B2 — UI panel

- [ ] Trang/tab audit trong `admin/` (hiện chỉ có `admin/page.tsx`) — bảng: thời gian, actor, action, target/room, metadata.
- [ ] Filter: theo action type, theo khoảng thời gian, theo room/match id (đúng tham số DTO hỗ trợ).
- [ ] Pagination control (next/prev hoặc infinite theo cursor).
- [ ] Trạng thái rỗng + lỗi + skeleton loading (theo design system hiện có).

### Phase B3 — Hoàn thiện

- [ ] Test component (vitest + testing-library như các spec FE hiện tại).
- [ ] i18n (dự án dùng `[locale]` routing → thêm key dịch).
- [ ] Cập nhật `memory-bank/progress.md`: chuyển "Admin Audit Panel UI (Optional)" sang done.

## File dự kiến

```text
apps/web/src/app/[locale]/admin/
  audit/page.tsx            # hoặc tab trong page.tsx hiện có
apps/web/src/hooks/
  use-audit-events.ts
apps/web/src/components/admin/
  audit-table.tsx
  audit-filters.tsx
apps/web/src/lib/api/
  audit.ts                  # client gọi endpoint
```

## Acceptance

- [ ] Panel liệt kê audit events, phân trang chạy đúng với backend.
- [ ] Filter theo action + thời gian + room hoạt động.
- [ ] Test FE pass.
- [ ] **Shared contract (FE)**: FE imports only `@arena/shared` audit symbols —
      `KnownAuditEventType`, `AuditEventType`, `AuditEvent`, `GetAuditEventsParams`,
      `AuditEventsResponse` — not backend DTO types from `get-audit-events.dto.ts` / `@arena/api`.
- [ ] **Contract evidence**: contract tests **or** documented evidence that those shared types
      remain valid against the controller’s Zod schema in
      `apps/api/src/modules/admin/dto/get-audit-events.dto.ts`. Do **not** claim zero-drift
      without that evidence.
- [ ] **Pre-edit impact analysis (required, every symbol Track B will add or modify)**:
  - Track B touches the FE admin area. Run `gitnexus_impact({direction: "upstream"})` for **every** function, class, or method that will be added or modified — NOT only the existing `AdminPage`. The minimum set (recorded here; expand if a new symbol is added):
    - `apps/web/src/app/[locale]/admin/page.tsx:AdminPage` (existing route guard — pre-existing symbol).
    - `apps/web/src/app/[locale]/admin/audit/page.tsx` (new — `AuditPage` if introduced, otherwise the page export; new in Track B).
    - `apps/web/src/hooks/use-audit-events.ts` (new — `useAuditEvents`; new in Track B).
    - `apps/web/src/lib/api/audit.ts` (new — `getAuditEvents` and any sibling request helpers; new in Track B).
    - `apps/web/src/components/admin/audit-table.tsx` (new — `AuditTable`; new in Track B).
    - `apps/web/src/components/admin/audit-filters.tsx` (new — `AuditFilters`; new in Track B).
  - For each symbol, record: **direct callers** (split into `pre-existing callers` and `callers introduced by this change set`), **affected processes** (full list, not abbreviated), **risk level**. The recorded result for each symbol must be the **complete** upstream set the index returns, not a partial summary — the PR description and the Plan update must show the full list of direct callers and the full list of affected processes so the next agent can re-verify.
  - **Callers introduced by this change set** (per-symbol, recorded explicitly):
    - `AuditPage` (`apps/web/src/app/[locale]/admin/audit/page.tsx`): introduced by this change set. When wired, its direct callers include any in-PR composition root that mounts the page (e.g. `apps/web/src/app/[locale]/admin/layout.tsx` or a route entry) and any test that imports it. Record these as `callers introduced by this change set`; do NOT classify them as `pre-existing-by-construction`.
    - `useAuditEvents` (`apps/web/src/hooks/use-audit-events.ts`): introduced by this change set. When wired, its direct callers include `AuditPage` and any FE component that calls the hook. These are also `callers introduced by this change set`, not pre-existing.
    - `getAuditEvents` (`apps/web/src/lib/api/audit.ts`): introduced by this change set. Its direct callers include `useAuditEvents` and any sibling helper. `callers introduced by this change set`.
    - `AuditTable` (`apps/web/src/components/admin/audit-table.tsx`): introduced by this change set. Direct callers include `AuditPage` (and any test). `callers introduced by this change set`.
    - `AuditFilters` (`apps/web/src/components/admin/audit-filters.tsx`): introduced by this change set. Direct callers include `AuditPage` (and any test). `callers introduced by this change set`.
    - The internal relationship graph (e.g. `AuditPage → useAuditEvents → getAuditEvents`, `AuditPage → AuditTable`, `AuditPage → AuditFilters`) is the expected composition and is part of the change set, not a pre-existing property of the codebase.
  - **STOP conditions** (any of the following):
    - Risk is `HIGH` or `CRITICAL` (e.g. changing `AdminPage` breaks an existing route other than the admin guard).
    - Blast radius (sum of pre-existing + new direct callers across the matrix, or affected processes) exceeds the planned Track B scope (i.e. the change reaches outside `apps/web/src/app/[locale]/admin/` + `apps/web/src/hooks/use-audit-events.ts` + `apps/web/src/lib/api/audit.ts` + `apps/web/src/components/admin/`).
  - **NOT a STOP**: a non-zero count of pre-existing direct callers on a single existing symbol (e.g. `AdminPage` had N pre-existing callers in the index). That is informational only — review it, but proceed if the risk is `LOW` / `MEDIUM` and the change is bounded to the route guard.
  - **Index freshness**: if the index reports a symbol as missing, run `npx gitnexus analyze` and re-run `gitnexus_impact`. Do not record `LOW` from a missing symbol; record `UNKNOWN` and apply the STOP rule.
  - **Bounded-scope shortcut (consistency note)**: an implementer MAY use the shortcut "only the existing `AdminPage` route guard is modified" **only when** none of the new Track B symbols above are introduced in the same change set. If the PR adds `AuditPage` / `useAuditEvents` / `getAuditEvents` / `AuditTable` / `AuditFilters`, the per-symbol matrix above MUST be run for those symbols and the full caller / process lists MUST be recorded. The shortcut is recorded in the PR description so reviewers see the explicit scope statement.
- [ ] **Authorization coverage** (FE-only — phù hợp với phạm vi Track B là `apps/web/src/app/[locale]/admin/`):
  - **Frontend route guard** (`apps/web/src/app/[locale]/admin/page.tsx` và trang audit mới thêm): user không phải `ADMIN` bị chặn ngay tại UI (không gọi API, render "ACCESS DENIED" hoặc redirect). Có component test xác nhận guard kích hoạt đúng với `userRole !== "ADMIN"`.
  - **Backend / API authorization** là **pre-existing dependency, NGOÀI scope Track B**. Track B KHÔNG yêu cầu thêm test backend, KHÔNG sửa `apps/api`. Bằng chứng hiện có (chỉ mang tính tham chiếu, không phải deliverable của Track B):
    - Global guards: `JwtAuthGuard` + `RolesGuard` đăng ký ở `apps/api/src/app.module.ts:69-84`.
    - Controller-level guard: `@Roles(Role.ADMIN)` ở `apps/api/src/modules/admin/admin.controller.ts:48-49`.
    - Tests contract/validation đã có:
      - `apps/api/src/modules/admin/admin.controller.spec.ts` (delegation + validation).
      - `apps/api/src/modules/admin/admin.service.spec.ts` (filter forwarding).
      - `apps/api/src/modules/admin/dto/get-audit-events.dto.spec.ts` (DTO validation).
  - **Acceptance nhỏ trong Track B (không cần backend test mới):** với MỌI endpoint admin/audit UI mới hoặc bị sửa, người implementer phải dùng **GitNexus `query` / `context` (không dùng `grep`)** để truy ngược decorator + metadata trực tiếp trên `apps/api/src/modules/admin/admin.controller.ts` (không chỉ `admin.controller.spec.ts`) và chứng minh rằng `@Roles(Role.ADMIN)` (hoặc metadata tương đương qua `RolesGuard`) đã được áp dụng. Evidence chấp nhận được (ít nhất một trong hai):
    1. Quote trực tiếp decorator/metadata trên handler tương ứng (qua `gitnexus_context` cho từng method), **HOẶC**
    2. Test hiện có đã cover authorization rejection (401/403) cho endpoint đó.
       Lưu evidence này (GitNexus output + quote) vào PR description. Track API riêng (ngoài Track B) vẫn chịu trách nhiệm bổ sung test rejection 401/403 explicit nếu evidence ở mục (2) chưa có.

## Rủi ro

- Drift type FE vs backend DTO: mitigated by shared `@arena/shared/audit.ts` symbols (FE must not
  import DTO types). `get-audit-events.dto.ts` remains controller-side Zod/Swagger only.
  Residual drift risk is closed only when Acceptance contract tests/evidence pass — not by
  shared-location alone.
- Cần auth/route guard cho khu admin (kiểm tra pattern bảo vệ route admin hiện có trước khi thêm trang).
