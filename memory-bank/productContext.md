# Product Context: Arena of 100

> **Core memory-bank file 1/4**  
> Read order: `AGENTS.md` -> `productContext.md` -> `systemPatterns.md` -> `progress.md` -> `activeContext.md`  
> Recruiter & System Design overview: see `recruiter-summary.md`

## Product Overview

**Arena of 100** là game quiz battle royale trực tuyến thời gian thực: 100 người chơi cùng bước vào đấu trường, trả lời các câu hỏi trắc nghiệm dưới áp lực thời gian (15s/round). Trả lời sai hoặc quá hạn sẽ bị loại ngay lập tức. Người trụ lại cuối cùng giành chiến thắng.

### Core Value Propositions:

- **High-Stakes Thrill**: Trải nghiệm căng thẳng thật sự với nhịp độ battle royale dồn dập.
- **Zero-Friction Onboarding**: Khởi tạo phiên chơi tức thì dưới dạng Guest (nickname + avatar seed), không rào cản đăng ký rườm rà.
- **Engaging Spectator Mode**: Người chơi bị loại chuyển mượt mà sang giao diện khán giả (watch-only UI) với tương tác cổ vũ thời gian thực.
- **Deep Tactical Gameplay**: Hệ thống Class (Công / Thủ) & 18 Thẻ bài chiến thuật bổ sung chiều sâu chiến thuật vào giải đố trivia truyền thống.
- **Fair Play & Competitive Ranking**: Đấu trường xếp hạng Elo chuẩn xác, hệ thống chống gian lận tuyệt đối (server-authoritative), và Daily Challenge rèn luyện chuỗi ngày liên tiếp.

---

## Core User Journey

1. **Landing & Onboarding**: Người chơi truy cập web, nhập nickname và chọn avatar ngẫu nhiên.
2. **Matchmaking & Room Discovery**:
   - Tham gia hàng đợi tìm trận xếp hạng theo Elo (ZSET Matchmaking với Bot backfill thông minh).
   - Hoặc tạo/tham gia phòng thi đấu tùy chỉnh (Custom Room) qua mã Code / Link mời.
3. **Class & Card Allocation**: Hệ thống phân định ngẫu nhiên Class (Công / Thủ) và cung cấp bộ thẻ bài tương ứng.
4. **Real-time Match Loop**:
   - Vòng đấu 15-20s: câu hỏi xuất hiện đồng bộ trên toàn bộ người chơi.
   - Sử dụng thẻ bài chiến lược (Khiên bảo vệ, Nhân đôi điểm, Đóng băng đối thủ,...).
   - Chọn đáp án với phản hồi tức thì (Optimistic UI & server validation).
5. **Instant Elimination & Spectating**: Trả lời sai hoặc hết giờ bị loại ngay; tiếp tục theo dõi diễn biến trận đấu ở góc nhìn khán giả.
6. **Tie-Break & Victory Screen**: Xác định quán quân (dựa trên thời gian phản xạ và độ chính xác), cộng điểm Elo, mở khóa biến thể thẻ bài đặc biệt (Neon/Gold) và chia sẻ thành tích.

---

## Locked Product Decisions

### 1. Onboarding & Identity

- **Guest-first**: Đăng nhập tức thì không cần mật khẩu; định danh phiên bằng JWT gắn với Redis.
- **Sanitized Identity**: Tự động lọc từ ngữ nhạy cảm (Profanity filter) cho nickname trước khi vào phòng.

### 2. Match & Elimination Semantics

- **Strict Rule**: Trả lời sai HOẶC không trả lời trước hạn chót (timeout) = **BỊ LOẠI NGAY TRONG ROUND ĐÓ**.
- **Spectator UI**: Socket kết nối vẫn duy trì nhận update và render giao diện quan sát viên; spectator không có quyền gửi câu trả lời.

### 3. Tactical Depth: Class & Cards Hybrid

- **2 Classes**: Công (Tấn công) vs Thủ (Phòng thủ) được phân bổ ngẫu nhiên.
- **18 Tactical Cards**: Hiệu ứng được giải quyết theo lô tức thì (`CARD_RESOLVED_BATCH` <= 50ms) đảm bảo tính công bằng và chống trôi lệch đồng hồ (Clock drift safe).
- **Cosmetics & Progression**: Chuỗi thắng Daily Challenge (Streak >= 7) mở khóa biến thể thẻ bài Neon / Gold.

### 4. Competitive Integrity

- **Server-Authoritative Anti-Cheat**: Client chỉ gửi ý định (intent); toàn bộ thời gian, tính đúng sai, và kết quả đều do backend tính toán và ký phát.
- **Monotonic Replay Hydration**: Kết nối lại sau sự cố mạng tự động bù đắp sự kiện thiếu hụt qua cơ chế Delta Replay (`EVENT_BATCH`), không làm gián đoạn trận đấu.

---

## Completed Feature Matrix

| Feature Area                 | Status     | Key Characteristics                                                        |
| :--------------------------- | :--------- | :------------------------------------------------------------------------- |
| **100-Player Battle Royale** | Production | 15s round loop, instant elimination, sudden-death tiebreak                 |
| **Class + Card System**      | Production | 2 classes, 18 cards, batch resolution, streak variants                     |
| **Elo & Matchmaking**        | Production | Dynamic K-factor, Redis ZSET queue, bot auto-backfill                      |
| **Daily Challenge Mode**     | Production | Daily curated sets, streak tracking, unlockable cosmetics                  |
| **Spectator Experience**     | Production | Drop-in watch mode, real-time match state observation                      |
| **Resilience & Reconnect**   | Production | Monotonic `seqNo` delta replay, Redis Sentinel automatic failover          |
| **Anti-Cheat & Security**    | Production | Server authority, idempotent submissions (`submissionId`), profanity guard |
