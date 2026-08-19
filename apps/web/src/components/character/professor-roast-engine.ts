import { useLocale } from "next-intl";

export type ProfessorMood =
  | "idle"
  | "thinking"
  | "searching"
  | "teaching"
  | "ticking_panic"
  | "shocked"
  | "angry_roast"
  | "proud_cheer";

export type DialogueContext =
  | "home_greeting"
  | "home_nickname_empty"
  | "home_nickname_typed"
  | "matchmaking_waiting"
  | "matchmaking_matched"
  | "lobby_briefing"
  | "game_round_start"
  | "game_last_seconds"
  | "game_correct_answer"
  | "game_wrong_answer"
  | "game_mass_elimination"
  | "game_eliminated"
  | "game_eliminated_timeout"
  | "result_winner"
  | "result_top10"
  | "result_early_elim";

interface DialogueData {
  textVi: string;
  textEn: string;
  mood: ProfessorMood;
}

export const PROFESSOR_DIALOGUES: Record<DialogueContext, DialogueData[]> = {
  home_greeting: [
    {
      textVi:
        "Trò mới tới à? Mau ghi danh vào sổ điểm danh để thầy xếp phòng thi!",
      textEn:
        "New student? Quick, sign into the attendance book so I can assign your exam hall!",
      mood: "idle",
    },
    {
      textVi: "Hôm nay có 100 học sinh tranh tài. Trò liệu trụ được mấy câu?",
      textEn:
        "100 students competing today. How many questions do you think you can survive?",
      mood: "teaching",
    },
    {
      textVi:
        "Đừng run tay! Hãy chứng minh cho thầy thấy não trò không chỉ để trưng bày!",
      textEn:
        "Don't shake! Prove to me that your brain isn't just for decoration!",
      mood: "idle",
    },
  ],
  home_nickname_empty: [
    {
      textVi: "Ủa trò định thi giấu tên à? Đặt một cái tên thật kêu vào!",
      textEn:
        "Are you taking the exam incognito? Give yourself a fierce nickname!",
      mood: "angry_roast",
    },
    {
      textVi: "Không có tên thì thầy biết ghi ai vào sổ đầu bài bây giờ?",
      textEn:
        "Without a name, whose name am I supposed to write in the detention log?",
      mood: "shocked",
    },
  ],
  home_nickname_typed: [
    {
      textVi: "Biệt danh chiến đấy! Sẵn sàng vào đấu trường chưa?",
      textEn: "Fierce nickname! Are you ready to enter the arena?",
      mood: "proud_cheer",
    },
    {
      textVi: "Cái tên nghe có vẻ nhiều chữ, hy vọng não cũng tỉ lệ thuận!",
      textEn: "Smart-sounding name! Let's hope your brainpower matches it!",
      mood: "thinking",
    },
  ],
  matchmaking_waiting: [
    {
      textVi: "Đang gom đủ 100 trò... Đừng có đứa nào tranh thủ trốn tiết nhé!",
      textEn:
        "Gathering 100 students... Nobody skip class while I'm not looking!",
      mood: "searching",
    },
    {
      textVi: "Thầy đang lật sổ tìm phòng thi phù hợp cho trò...",
      textEn: "Checking my records to find the right exam room for you...",
      mood: "searching",
    },
    {
      textVi: "Sắp xếp thí sinh vào bàn... Trò nhớ thắt chặt nơ cổ áo lại!",
      textEn: "Assigning exam seats... Straighten your tie, young student!",
      mood: "thinking",
    },
  ],
  matchmaking_matched: [
    {
      textVi:
        "Đã tìm thấy phòng thi! 100 thí sinh đã có mặt. Chuẩn bị nộp não!",
      textEn:
        "Exam room located! All 100 candidates present. Prepare your brain!",
      mood: "shocked",
    },
  ],
  lobby_briefing: [
    {
      textVi:
        "Quy chế thi: Sai một câu là xách cặp ra khỏi phòng ngay lập tức! Rõ chưa?",
      textEn:
        "Exam rule: One wrong answer and you are ejected immediately! Understood?",
      mood: "teaching",
    },
    {
      textVi: "Tuyệt đối không liếc bài bạn bên cạnh! Thầy có mắt sau gáy đấy!",
      textEn:
        "No peeking at your neighbor's screen! I have eyes in the back of my head!",
      mood: "angry_roast",
    },
    {
      textVi: "Sĩ số đang lấp đầy. Hít thở sâu và kích hoạt nơ-ron não bộ nào!",
      textEn:
        "The room is filling up. Take a deep breath and fire up your neurons!",
      mood: "teaching",
    },
  ],
  game_round_start: [
    {
      textVi: "Đề bài đã phát! Đọc kỹ câu hỏi, đừng vội tay nhanh hơn não!",
      textEn:
        "Questions distributed! Read carefully, don't let hands be faster than brain!",
      mood: "teaching",
    },
    {
      textVi: "Tập trung cao độ! Đồng hồ đang tích tắc trôi!",
      textEn: "Full focus! The clock is ticking!",
      mood: "thinking",
    },
  ],
  game_last_seconds: [
    {
      textVi: "SẮP HẾT GIỜ! Mau chọn đáp án đi, đứng ngơ ra thế làm gì?!",
      textEn: "TIME ALMOST UP! Pick an answer, why are you freezing?!",
      mood: "ticking_panic",
    },
    {
      textVi: "3... 2... 1... Quyết định nhanh lên!",
      textEn: "3... 2... 1... Make your choice now!",
      mood: "ticking_panic",
    },
  ],
  game_correct_answer: [
    {
      textVi: "Chính xác! Trò làm thầy nở mũi đấy!",
      textEn: "Spot on! You make your teacher proud!",
      mood: "proud_cheer",
    },
    {
      textVi: "Tốt lắm! Tiếp tục phong độ này nhé!",
      textEn: "Excellent! Keep up that momentum!",
      mood: "proud_cheer",
    },
    {
      textVi: "Đáp án chuẩn không cần chỉnh! Một điểm cộng cho trò!",
      textEn: "Flawless answer! Bonus point for you!",
      mood: "proud_cheer",
    },
  ],
  game_wrong_answer: [
    {
      textVi:
        "Sai bét rồi! Tôi tưởng câu này học sinh mẫu giáo cũng biết chứ?!",
      textEn: "Completely wrong! I thought even preschoolers knew this one?!",
      mood: "angry_roast",
    },
    {
      textVi: "Não trò vừa ấn nút tạm dừng hoạt động à?",
      textEn: "Did your brain just press the pause button?",
      mood: "shocked",
    },
    {
      textVi: "Về chỗ đứng úp mặt vào tường tự kiểm điểm cho thầy!",
      textEn: "Go stand in the corner and reflect on what you just answered!",
      mood: "angry_roast",
    },
    {
      textVi: "Chọn đáp án tự tin lắm, mà trật lất!",
      textEn: "Such confidence in clicking, such disaster in correctness!",
      mood: "angry_roast",
    },
  ],
  game_mass_elimination: [
    {
      textVi:
        "Một pha thanh trừng ngoạn mục! Mấy chục trò vừa dắt tay nhau ra đảo!",
      textEn:
        "A spectacular mass purge! Dozens of students just walked out together!",
      mood: "shocked",
    },
    {
      textVi: "Cả lớp cùng dính bẫy câu này à? Thầy cạn lời luôn!",
      textEn: "Did the whole class fall for that trap? I am speechless!",
      mood: "shocked",
    },
  ],
  game_eliminated: [
    {
      textVi:
        "Rất tiếc! Trò đã bị truất quyền thi đấu. Hẹn gặp lại ở kỳ thi phụ!",
      textEn: "Alas! You have been disqualified. See you in remedial class!",
      mood: "angry_roast",
    },
    {
      textVi:
        "Học bạ ghi nhận: Trượt vỏ chuối! Mai mời phụ huynh lên gặp thầy!",
      textEn:
        "Academic record: Slipped on a banana peel! Bring your parents tomorrow!",
      mood: "shocked",
    },
  ],
  game_eliminated_timeout: [
    {
      textVi: "Hết giờ mà chưa chọn đáp án? Trò ngủ gật trong giờ thi à?!",
      textEn:
        "Time ran out without answering? Did you fall asleep in the exam?!",
      mood: "angry_roast",
    },
  ],
  result_winner: [
    {
      textVi:
        "THỦ KHOA CỦA 100 HỌC SINH! Thầy xin ngả mũ thán phục trí tuệ của trò!",
      textEn:
        "VALEDICTORIAN OF 100 CANDIDATES! I tip my hat to your brilliant mind!",
      mood: "proud_cheer",
    },
  ],
  result_top10: [
    {
      textVi:
        "Lọt vào Top 10 học sinh giỏi! Xứng đáng được nhận giấy khen của thầy!",
      textEn:
        "Made it into the Top 10 Honor Roll! Well deserving of a certificate!",
      mood: "proud_cheer",
    },
  ],
  result_early_elim: [
    {
      textVi:
        "Lời phê của giáo viên: Cần nạp thêm nơ-ron và ôn bài kỹ trước khi tái đấu!",
      textEn:
        "Teacher's remarks: Needs more brainpower and serious studying before rematch!",
      mood: "angry_roast",
    },
  ],
};

export function getRandomProfessorDialogue(
  context: DialogueContext,
  locale: string = "vi",
): { text: string; mood: ProfessorMood } {
  const list =
    PROFESSOR_DIALOGUES[context] || PROFESSOR_DIALOGUES.home_greeting;
  const item = list[Math.floor(Math.random() * list.length)];
  const text = locale.startsWith("vi") ? item.textVi : item.textEn;
  return { text, mood: item.mood };
}

export function useSafeLocale(fallback = "vi"): string {
  try {
    return useLocale() || fallback;
  } catch {
    return fallback;
  }
}
