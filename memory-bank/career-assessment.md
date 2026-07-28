# Career Assessment: Arena of 100

> Đánh giá thẳng thắn về project dưới góc nhìn apply công ty quốc tế. Viết 2026-06-14.
> Mục đích: tham chiếu lại khi quyết định đổ công vào đâu để nâng trần.

## TL;DR

> **⚠️ 2026-07-28: hai điểm yếu chính của TL;DR này đã được giải quyết** — distributed
> runtime đã chạy thật multi-node và đã có số đo k6 (800→3200 VU, p95 tuyến tính
> 201/357/669ms, 0 connect error). Đọc §CẬP NHẬT 2026-07-28 ở cuối file cho verdict
> hiện hành; phần dưới đây giữ nguyên làm mốc lịch sử 2026-06-14.

Project **trên trung bình rõ rệt** — tốt hơn hẳn mức "tutorial portfolio". Đủ để mở cửa phỏng vấn ở product company quốc tế tier thực tế. Nhưng **trần MVP này thấp** vì nó dừng lại đúng trước ngưỡng "khó thật": single-process là giới hạn, và frontend đang phản bội backend.

Trần thật sự không nằm ở thêm bug fix / feature, mà ở **đẩy nó qua ranh giới single-process → distributed, và chứng minh bằng số đo.** _(→ đã làm, xem cập nhật 2026-07-28.)_

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

---

## CẬP NHẬT 2026-07-28 — sau performance investigation đa-node (supersedes phần lớn "Tại sao trần thấp")

> Bối cảnh: ngày 2026-07-28 chạy thật multi-node k6 800→3200 VU trên cluster 3 node
> (Redis adapter), tìm-sửa-verify 2 nghẽn code, sweep pool + repeats, và tách
> được rig khỏi app bằng thí nghiệm. Toàn bộ số trace về `load-test/results/`.

### Các claim 2026-06-14 đã hết hạn

- ~~"Chưa có k6 load test"~~ → 5 milestone run (800/800-fix/1600/3200/3200-slow) + 2 sweep TSV, artifacts đầy đủ.
- ~~"Chưa từng chạy ở quy mô nó tuyên bố"~~ → **3200 socket / 32 match đồng thời** trên 1 máy 12-core, 0 connect error, 0 app error, scaling tuyến tính.
- ~~"single-process là giới hạn"~~ → distributed runtime đã chạy thật: socket chia đều 3 node (33.3/33.5/33.3%), cross-node fan-out qua Redis adapter hoạt động dưới tải.
- Mục (1) và (2) của "Nâng trần" coi như **DONE**. Mục (4) narrative: một nửa — còn thiếu trang performance investigation.

### Verdict phỏng vấn (big tech)

**Đủ ấn tượng ở thời điểm hiện tại.** Giá trị biên của tối ưu thêm ≈ 0; giá trị
còn lại nằm ở (a) kể chuyện đúng cách, (b) chiều sâu khi bị probe. Feature còn
lại là scale bề rộng — không đổ công vào đó vì mục đích phỏng vấn.

### 3 câu chuyện 90 giây — TẬP KỂ, mỗi câu: triệu chứng → khoanh vùng → fix → số → điều còn mở

1. **Timer-bound consumer.** Answer p95 1126ms trong khi CPU 10% → không phải
   compute mà là queuing. Chữ ký: `min=2ms` và `max=1217ms` trên cùng code path.
   Khoanh: `max ≈ ceil(69 players / BATCH 16) × 250ms poll interval`. Fix: batch
   ≥ roster, vòng đọc tự re-arm thay setInterval, XAUTOCLAIM tách khỏi hot path.
   Kết quả: **p95 1126→201ms (−82%), CPU không đổi**. Còn mở: trần per-match của
   single-writer là design trade-off, không phải bug.
2. **Sweep n=1 là fit vào nhiễu.** Pool sweep đầu kết luận "20 tối ưu, 50 thảm
   hoạ 5.8×". Interleaved repeats (20,10,32,32,20,10) giết kết luận đó: variance
   146→1011ms trong cùng setting. Cái sống sót qua repeats: trần cứng pool=10
   (backends ghim 31/31) là thật; chênh latency giữa 20/32 là nhiễu. Bài học:
   chỉ tin kết luận sống qua repeats xen kẽ.
3. **Wall theo N vs wall theo dN/dt.** 3200 VU nén: p95 2.12s, máy cạn (idle
   0.6%, loadavg 13/12 core). Cùng 3200 VU giãn nhịp storm, không đổi dòng code:
   **p95 669ms**. Thí nghiệm phân xử 2 giả thuyết: nếu wall theo số kết nối thì
   giãn không giúp; nó giúp 3.2× → wall theo tốc độ đến. Chuỗi scaling
   201@800 → 357@1600 → 669@3200 = tuyến tính. Hệ suy giảm duyên dáng: 0 lỗi,
   chỉ chậm rồi tự hồi.

### Câu probe PHẢI có sẵn đáp án trước khi vào phòng

1. **"Redis chết thì sao?"** — câu nguy hiểm nhất. Redis là SPOF 3-trong-1:
   adapter bus + command stream + match state. Chuẩn bị: Sentinel vs Cluster,
   Streams consumer-group hành xử thế nào qua failover, cái gì mất giữa trận
   và cái gì phục hồi được từ đâu.
2. **"Toàn bộ trên 1 máy?"** — nhận chủ động, đừng né: "vì thế em thiết kế thí
   nghiệm tách rig khỏi app (run giãn nhịp), và em biết bước kế tiếp là off-box
   load gen". Yếu điểm được nhận diện rõ ăn điểm hơn yếu điểm bị giấu.
3. **"3200 user có gì to?"** — con số không phải điểm mạnh, phương pháp mới là.
   Luôn kèm mẫu số: _trên 12 core, kèm cả bộ đo trên lưng, app dùng ~1 core/node,
   biết trần kế tiếp ở đâu (event-loop fan-out ~5-6k) và cần gì để đo nó_.
4. **"Sao không Prometheus/Grafana?"** — map được sampler tay → stack chuẩn:
   dockerstats.psv ≈ cAdvisor/node-exporter, pgconn.psv ≈ pg_stat_activity
   exporter, answer_result_latency ≈ histogram + p95 recording rule.

### Số cần thuộc lòng

| Số                | Ý nghĩa                                                            |
| ----------------- | ------------------------------------------------------------------ |
| 1126 → 201ms      | consumer fix @800 VU, CPU không đổi                                |
| 201 / 357 / 669ms | p95 @ 800/1600/3200 — tuyến tính ~1.9×/double                      |
| 2120 → 669ms      | cùng 3200 VU, chỉ giãn storm — rig, không phải app                 |
| 10 → 20           | pool/node: default thư viện → sized; active thật 19/60, lockwait 0 |
| 33.3/33.5/33.3%   | socket split 3 node — adapter làm đúng việc                        |
| 0                 | connect error ở mọi scale                                          |

### Việc còn lại đáng làm (không phải feature, không phải optimization)

1. Commit công việc 2026-07-28 (2 nhóm: boot/config + consumer fix) kèm artifacts.
2. Trang "Performance investigation" trong docs — timeline nghẽn → giả thuyết →
   thí nghiệm → số. Một trang này > mọi feature thêm được, và là script 5 phút
   cho system-design interview.
3. Tập 3 câu chuyện trên thành ~90s/câu chuyện.

Còn mở (tuỳ chọn, không chặn phỏng vấn): pgbench ceiling, off-box load gen >3200,
harness polling fix, nghẽn #3 `IN (NULL)` + #4 `rooms.status` index, chaos run
failover numbers (C3) trên cluster mới.
