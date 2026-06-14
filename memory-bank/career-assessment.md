# Career Assessment: Arena of 100

> Đánh giá thẳng thắn về project dưới góc nhìn apply công ty quốc tế. Viết 2026-06-14.
> Mục đích: tham chiếu lại khi quyết định đổ công vào đâu để nâng trần.

## TL;DR

Project **trên trung bình rõ rệt** — tốt hơn hẳn mức "tutorial portfolio". Đủ để mở cửa phỏng vấn ở product company quốc tế tier thực tế. Nhưng **trần MVP này thấp** vì nó dừng lại đúng trước ngưỡng "khó thật": single-process là giới hạn, và frontend đang phản bội backend.

Trần thật sự không nằm ở thêm bug fix / feature, mà ở **đẩy nó qua ranh giới single-process → distributed, và chứng minh bằng số đo.**

## Điểm mạnh thật sự (đọc từ code)

- **Concurrency awareness thật**: `SELECT ... FOR UPDATE` ở `joinRoom`, Lua-script clamp cho playerCount, idempotency guard `endingRounds`, generation counter chống kick-old-socket race. Phân biệt người hiểu hệ thống phân tán với người chỉ ghép CRUD.
- **Server-authoritative + state machine persist/recover**: recovery countdown sau restart, re-attach correctAnswer từ DB thay vì Redis (chống leak). Tư duy đúng.
- **Comment chất lượng cao**: mỗi fix có mã (H1, M5, L3...) giải thích _tại sao_, không phải _cái gì_. Reviewer sẽ thích.
- **Test footprint rộng + coverage gate ≥90%**: hiếm ứng viên làm tới mức này.

> Nếu một junior/mid đưa repo này, đáng để phỏng vấn. Nó cho thấy biết _vấn đề khó nằm ở đâu_ trong real-time multiplayer.

## Tại sao trần thấp (3 lý do cốt lõi)

### 1. Chưa từng chạy ở quy mô nó tuyên bố

- `setTimeout` in-process cho toàn bộ game loop → chết khi scale >1 instance. Memory-bank tự thừa nhận "chưa có multi-instance adapter".
- Chưa có k6 load test. Game 100-concurrent-WS mà chưa đo p99 latency / reconnect storm thì "100" mới là tên gọi, chưa phải đặc tính đã chứng minh.
- Timer-driven round-end + match-finish guards (`finishingMatches`,
  `endingRounds`, `lobbyCountdowns`) là in-memory `Map`/`Set` trong
  từng process Node. Đa-instance sẽ phá vỡ — cần distributed lock
  hoặc chuyển sang Redis (đã có sẵn infra). B3 đã dùng
  `SELECT ... FOR UPDATE` cho launch race, B1 dùng DB-level
  `finishMatch` transaction; phần còn lại là timer/finishing
  guard chưa được distributed.

### 2. Frontend kéo điểm xuống đáng kể

- Backend ở mức mid-to-senior, nhưng `game/[matchId]/page.tsx` có **mock data cứng** (F1) và **client tự kết thúc trận với magic number `<= 12`** (F2).
- F2 trực tiếp phá vỡ chính cái server-authoritative mà backend dày công bảo vệ.
- Reviewer nhìn thấy mâu thuẫn này sẽ nghi: "code backend đẹp kia có phải của cùng một người không?". Đây là _red flag_ lớn hơn cả thiếu feature.

### 3. Đây là CRUD-real-time, không phải bài toán có chiều sâu thuật toán/hệ thống

- Quiz battle royale là bài tốt để _thể hiện_ kỹ năng, nhưng bản thân không có "wow" kỹ thuật: không matchmaking phức tạp, không physics/lockstep, không CRDT, không sharding thật.
- Nó chứng minh bạn _cẩn thận_, chưa chứng minh giải được bài _khó_.

## Đánh giá theo loại công ty

| Tier                                                     | Verdict                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Product/scale-up (Series B–D, fintech, SaaS quốc tế)** | Repo + fix xong F1/F2 → đủ qua screening + điểm tựa tốt cho system-design interview. **Tier thực tế nhất.**                                                                    |
| **FAANG / Big Tech**                                     | Repo gần như không quyết định — tuyển qua DSA + system design phỏng vấn. Repo đẹp giúp vượt recruiter screen. Trần ở tier này nằm ở **kỹ năng phỏng vấn, không phải project.** |
| **Game studio / real-time infra chuyên sâu**             | Chưa đủ. Họ hỏi về authoritative tick rate, lag compensation, state reconciliation ở mức chưa làm.                                                                             |

## Nâng trần — thứ thật sự di chuyển kim

Không phải thêm feature (rematch, emotes, AFK policy = bề rộng). Thứ nâng trần là **chiều sâu hệ thống**:

1. **Multi-instance thật**: Redis adapter cho Socket.io + distributed lock (Redlock) cho game loop + sticky session. Biến mọi in-memory Set/Map thành Redis-backed. Biến project từ "biết viết code đúng" thành "biết thiết kế hệ thống scale".
2. **k6 load test + trang ghi số đo** (p50/p95/p99, reconnect storm, 100 WS thật). Một biểu đồ latency có thật đáng giá hơn 10 feature.
3. **Sửa frontend cho khớp backend** (PR đang plan). Bắt buộc — mâu thuẫn server-authority là vết nứt đáng ngờ nhất.
4. **Bài viết kiến trúc ngắn** (README/blog) giải thích quyết định concurrency. Comment đã xuất sắc — nâng thành narrative là có sẵn material cho system-design interview.

## Câu hỏi định hướng

Mục tiêu gần nhất là **vượt recruiter/portfolio screen** hay **gây ấn tượng trong vòng system-design**?

- Vượt screen → ưu tiên (3) frontend fix + (4) narrative.
- Ấn tượng system-design → ưu tiên (1) distributed refactor + (2) load test với số đo.

Hai mục tiêu đòi hỏi đầu tư khác nhau.
