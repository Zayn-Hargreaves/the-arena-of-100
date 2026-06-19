# Active Context: Arena of 100

> **Core memory-bank file 4/4**
> Đây là working set ngắn hạn cho agent. Nếu cần lịch sử sâu, xem `progress.md` hoặc supplementary docs theo chỉ dẫn của user.

## Current Working Mode

- Repo hiện đang được đồng bộ lại docs + memory-bank
- Branch hiện tại theo git status đang là **`main`**
- Mục tiêu phiên này: giảm context bloat, sửa mismatch docs, và chốt roadmap còn lại

## What Is True Right Now

1. PR cũ cho race/frontend correctness **không còn là next plan** nữa; nó đã merge từ 2026-06-14
2. L2/L3 + home gradient **đã xong** từ 2026-06-18
3. Admin audit backend **đã xong ở backend**; frontend audit panel vẫn optional
4. Core docs cũ có mâu thuẫn về AFK; core truth mới là:
   - miss active round deadline => eliminated ngay round đó
   - sau đó render spectator UI
5. Monolith-first là hướng chính; distributed spectator infra defer tới khi có load evidence

## Immediate Tasks

1. Overwrite `plan.md` với roadmap mới
2. Slim 4 core docs để agent chỉ cần đọc ít nhưng đúng
3. Update `AGENTS.md` để mặc định chỉ refer 4 core docs
4. Giữ nguyên toàn bộ legacy docs, không xóa

## Next Implementation Queue

1. `Room.maxPlayers` payload
2. Optimistic answer rollback
3. Moderation MVP
4. Optional admin audit panel UI
5. `k6` load test PR riêng

## Decisions Locked In This Session

- **AFK**: không tạo rule mới "2 missed rounds" ở core docs nữa
- **Spectator after elimination**: là UI/experience state sau khi player bị loại
- **Moderation MVP**: làm vừa đủ, ghi rõ deferred enhancements sau MVP
- **Mass spectator**: chưa ép distributed/SSE riêng ngay
- **k6**: tách riêng, làm bài bản

## Core Memory-Bank Policy

Agent mặc định chỉ nên đọc 4 file sau:

1. `memory-bank/productContext.md`
2. `memory-bank/systemPatterns.md`
3. `memory-bank/progress.md`
4. `memory-bank/activeContext.md`

Các file khác trong `memory-bank/` là **supplementary / legacy notes**.

## Supplementary / Legacy Notes

Các file như `issue.md`, `projectbrief.md`, `techContext.md`, `career-assessment.md`, `frontend-enterprise-followups.md`, `coverage-cleanup.md`, `errorHandlingPattern.md`, `processTechDebt.md` vẫn được giữ nguyên để tra cứu khi cần, nhưng không dùng làm default prompt context nữa.
