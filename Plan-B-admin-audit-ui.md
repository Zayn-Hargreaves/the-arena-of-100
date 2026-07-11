# Plan B — Admin Audit Panel UI

> Track độc lập (frontend). Chạy song song với A/C/D. Xem tổng quan: [Plan1.md](Plan1.md).
> Nguồn: `memory-bank/progress.md` → P1#3 (Optional). Backend đã xong, chỉ còn UI.

## Mục tiêu

Xây UI trong khu admin để xem/lọc/phân trang **audit events** của admin kill-switch (ai làm gì, khi nào). Backend đã cung cấp đầy đủ endpoint.

## Nền backend đã có (chỉ tiêu thụ, KHÔNG sửa)

- `apps/api/src/modules/admin/ops/admin-audit.ops.ts` — `appendAudit`, `getAuditEvents` (paginated).
- `apps/api/src/modules/admin/admin.controller.ts:108` — `@Get("audit-events")`.
- `apps/api/src/modules/admin/dto/get-audit-events.dto.ts` — query/response DTO (dùng làm nguồn cho type FE).
- Migration `20260618120000_admin_audit_event`.

## Vì sao độc lập

Chỉ thêm code trong `apps/web/src/app/[locale]/admin/` + component/hook FE. Không đụng `apps/api`, không đụng game-core/socket-store → không xung đột A/C/D.

## Phase

### Phase B1 — Data layer (FE)

- [ ] Thêm API client gọi `GET /admin/audit-events` (dùng axios/react-query đã có trong dự án).
- [ ] Định nghĩa type khớp `get-audit-events.dto.ts` (đồng bộ shape, tránh drift).
- [ ] Hook `use-audit-events.ts`: phân trang (cursor/offset theo DTO), loading/error state.

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

```
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
- [ ] Test FE pass; type FE khớp DTO backend.

## Rủi ro

- Drift type FE vs DTO backend → sinh type từ DTO hoặc share qua `packages/shared` nếu phù hợp.
- Cần auth/route guard cho khu admin (kiểm tra pattern bảo vệ route admin hiện có trước khi thêm trang).
