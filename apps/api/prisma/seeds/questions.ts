export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type Category =
  | "GENERAL"
  | "SCIENCE"
  | "HISTORY"
  | "GEOGRAPHY"
  | "TECHNOLOGY"
  | "SPORTS"
  | "CULTURE"
  | "LOGIC";

export interface Question {
  content: string;
  options: string[];
  /**
   * Must be one of the entries in the options array
   */
  correctAnswer: string;
  difficulty: Difficulty;
  category: Category;
  tags?: string[];
  explanation?: string;
}

export const questionSeeds: Question[] = [
  // EASY
  {
    content: "Thủ đô của Việt Nam là gì?",
    options: ["Hà Nội", "Hồ Chí Minh", "Đà Nẵng", "Huế"],
    correctAnswer: "Hà Nội",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["Việt Nam", "chính trị"],
    explanation:
      "Hà Nội là thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.",
  },
  {
    content: "Mặt trời mọc ở hướng nào?",
    options: ["Đông", "Tây", "Nam", "Bắc"],
    correctAnswer: "Đông",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["thiên văn", "tự nhiên"],
    explanation:
      "Mặt trời mọc ở hướng Đông và lặn ở hướng Tây do Trái Đất quay từ Tây sang Đông.",
  },
  {
    content: "1 + 1 = ?",
    options: ["1", "2", "3", "4"],
    correctAnswer: "2",
    difficulty: "EASY",
    category: "LOGIC",
    tags: ["toán học", "cơ bản"],
    explanation: "Phép cộng cơ bản: 1 + 1 = 2.",
  },
  {
    content: "Nước sôi ở nhiệt độ bao nhiêu độ C?",
    options: ["50°C", "80°C", "100°C", "120°C"],
    correctAnswer: "100°C",
    difficulty: "EASY",
    category: "SCIENCE",
    tags: ["vật lý", "nhiệt độ"],
    explanation:
      "Nước sôi ở 100 độ Celsius ở điều kiện áp suất khí quyển tiêu chuẩn.",
  },
  {
    content: 'Con vật nào được gọi là "chúa tể rừng xanh"?',
    options: ["Hổ", "Sư tử", "Voi", "Gấu"],
    correctAnswer: "Sư tử",
    difficulty: "EASY",
    category: "GENERAL",
    tags: ["động vật", "thành ngữ"],
    explanation:
      "Sư tử thường được gọi là 'chúa tể rừng xanh' do sức mạnh và vẻ oai nghiêm của chúng.",
  },
  {
    content: "Quốc gia nào có diện tích lớn nhất thế giới?",
    options: ["Mỹ", "Trung Quốc", "Nga", "Canada"],
    correctAnswer: "Nga",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["quốc gia", "diện tích"],
    explanation:
      "Nga là quốc gia có diện tích lớn nhất thế giới, chiếm khoảng 11% diện tích đất liền toàn cầu.",
  },
  {
    content: "Đâu là mạng xã hội lớn nhất thế giới?",
    options: ["Twitter", "TikTok", "Facebook", "Instagram"],
    correctAnswer: "Facebook",
    difficulty: "EASY",
    category: "TECHNOLOGY",
    tags: ["mạng xã hội", "internet"],
    explanation:
      "Facebook là mạng xã hội lớn nhất thế giới tính theo số lượng người dùng hoạt động hàng tháng.",
  },
  // MEDIUM
  {
    content: "Ai là người sáng lập ra Facebook?",
    options: ["Bill Gates", "Mark Zuckerberg", "Steve Jobs", "Elon Musk"],
    correctAnswer: "Mark Zuckerberg",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["lập trình", "doanh nhân"],
    explanation:
      "Mark Zuckerberg là người sáng lập Facebook vào năm 2004 khi còn là sinh viên Harvard.",
  },
  {
    content: 'Nguyên tố hóa học nào có ký hiệu là "Fe"?',
    options: ["Fluorine", "Iron (Sắt)", "Francium", "Fermium"],
    correctAnswer: "Iron (Sắt)",
    difficulty: "MEDIUM",
    category: "SCIENCE",
    tags: ["hóa học", "kim loại"],
    explanation:
      "Fe là ký hiệu hóa học của nguyên tố Iron (Sắt) trong bảng tuần hoàn.",
  },
  {
    content: "Đại dương nào lớn nhất thế giới?",
    options: [
      "Đại Tây Dương",
      "Ấn Độ Dương",
      "Thái Bình Dương",
      "Bắc Băng Dương",
    ],
    correctAnswer: "Thái Bình Dương",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["đại dương", "trái đất"],
    explanation:
      "Thái Bình Dương là đại dương lớn nhất thế giới, chiếm khoảng 1/3 diện tích bề mặt Trái Đất.",
  },
  {
    content: "Năm nào Việt Nam giành độc lập?",
    options: ["1945", "1954", "1975", "1986"],
    correctAnswer: "1945",
    difficulty: "MEDIUM",
    category: "HISTORY",
    tags: ["Việt Nam", "độc lập"],
    explanation:
      "Việt Nam giành độc lập vào ngày 2/9/1945 khi Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập.",
  },
  {
    content: "Python là ngôn ngữ lập trình được tạo ra bởi ai?",
    options: [
      "James Gosling",
      "Guido van Rossum",
      "Bjarne Stroustrup",
      "Dennis Ritchie",
    ],
    correctAnswer: "Guido van Rossum",
    difficulty: "MEDIUM",
    category: "TECHNOLOGY",
    tags: ["lập trình", "ngôn ngữ"],
    explanation:
      "Guido van Rossum là người tạo ra ngôn ngữ lập trình Python vào cuối những năm 1980.",
  },
  {
    content: 'Thành phố nào được gọi là "Thành phố sương mù" ở Việt Nam?',
    options: ["Đà Lạt", "Sa Pa", "Tam Đảo", "Hà Giang"],
    correctAnswer: "Đà Lạt",
    difficulty: "MEDIUM",
    category: "GEOGRAPHY",
    tags: ["Việt Nam", "thành phố"],
    explanation:
      "Đà Lạt được gọi là 'Thành phố sương mù' do khí hậu mát mẻ và thường xuyên có sương mù vào buổi sáng.",
  },
  // HARD
  {
    content: "Trong vật lý, đơn vị đo cường độ dòng điện là gì?",
    options: ["Volt", "Watt", "Ampere", "Ohm"],
    correctAnswer: "Ampere",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["vật lý", "điện"],
    explanation:
      "Ampere (A) là đơn vị đo cường độ dòng điện trong hệ SI, đặt theo tên nhà vật lý André-Marie Ampère.",
  },
  {
    content: 'Ai là tác giả của tác phẩm "Truyện Kiều"?',
    options: [
      "Nguyễn Du",
      "Hồ Xuân Hương",
      "Nguyễn Trãi",
      "Bà Huyện Thanh Quan",
    ],
    correctAnswer: "Nguyễn Du",
    difficulty: "HARD",
    category: "CULTURE",
    tags: ["văn học", "kinh điển"],
    explanation:
      "Nguyễn Du (1765-1820) là tác giả của kiệt tác 'Truyện Kiều', một trong những tác phẩm văn học đỉnh cao của Việt Nam.",
  },
  {
    content: "Khoảng cách từ Trái Đất đến Mặt Trời là bao nhiêu km?",
    options: ["100 triệu km", "150 triệu km", "200 triệu km", "250 triệu km"],
    correctAnswer: "150 triệu km",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["thiên văn", "khoảng cách"],
    explanation:
      "Khoảng cách trung bình từ Trái Đất đến Mặt Trời là khoảng 150 triệu km, còn gọi là 1 đơn vị thiên văn (AU).",
  },
  {
    content: "HTTP status code 404 có ý nghĩa gì?",
    options: ["Server Error", "Unauthorized", "Not Found", "Forbidden"],
    correctAnswer: "Not Found",
    difficulty: "HARD",
    category: "TECHNOLOGY",
    tags: ["web", "HTTP"],
    explanation:
      "Mã lỗi HTTP 404 có nghĩa là 'Not Found' - tài nguyên được yêu cầu không được tìm thấy trên máy chủ.",
  },
  {
    content: "Trong lịch sử, trận Điện Biên Phủ diễn ra vào năm nào?",
    options: ["1945", "1954", "1968", "1975"],
    correctAnswer: "1954",
    difficulty: "HARD",
    category: "HISTORY",
    tags: ["Việt Nam", "chiến tranh"],
    explanation:
      "Trận Điện Biên Phủ diễn ra từ ngày 13/3 đến 7/5/1954, kết thúc bằng chiến thắng quyết định của Quân đội Nhân dân Việt Nam.",
  },
  {
    content: "Hành tinh nào có thời gian một ngày dài hơn một năm?",
    options: ["Sao Thủy", "Sao Kim", "Sao Hỏa", "Sao Thổ"],
    correctAnswer: "Sao Kim",
    difficulty: "HARD",
    category: "SCIENCE",
    tags: ["thiên văn", "hành tinh"],
    explanation:
      "Sao Kim có chu kỳ tự quay rất chậm (243 ngày Trái Đất) trong khi quỹ đạo quay quanh Mặt Trời chỉ mất 225 ngày Trái Đất.",
  },
];

/**
 * Normalizes a string for comparison (trim, lowercase, remove extra spaces)
 * @param str The string to normalize
 * @returns The normalized string
 */
export function normalizeString(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Validates that correctAnswer is one of the options
 * @param question The question to validate
 * @throws Error if correctAnswer is not in options
 */
function validateQuestion(question: Question): void {
  // Check that correctAnswer is one of the options
  if (!question.options.includes(question.correctAnswer)) {
    throw new Error(
      `Invalid question: correctAnswer "${question.correctAnswer}" is not in options [${question.options.join(", ")}] for question "${question.content}"`,
    );
  }

  // Check that all options are unique (case-insensitive, trimmed)
  const normalizedOptions = question.options.map(normalizeString);
  const uniqueOptions = new Set(normalizedOptions);
  if (uniqueOptions.size !== question.options.length) {
    throw new Error(
      `Invalid question: Duplicate options found in question "${question.content}"`,
    );
  }

  // Check that no option is empty
  if (question.options.some((option) => option.trim() === "")) {
    throw new Error(
      `Invalid question: Empty option found in question "${question.content}"`,
    );
  }

  // Check that content is not empty
  if (question.content.trim() === "") {
    throw new Error(`Invalid question: Empty content found`);
  }

  // Check that category is provided
  if (!question.category) {
    throw new Error(
      `Invalid question: Missing category for question "${question.content}"`,
    );
  }

  // Check tags after normalization if they exist
  if (question.tags) {
    const normalizedTags = question.tags.map(normalizeString);

    // Ensure no normalized tag is empty
    const emptyTagIndex = normalizedTags.findIndex((tag) => tag === "");
    if (emptyTagIndex !== -1) {
      throw new Error(
        `Invalid question: Empty tag found in question "${question.content}". Offending tag: "${question.tags[emptyTagIndex]}"`,
      );
    }

    // Ensure no duplicates in normalized tags
    const uniqueTags = new Set(normalizedTags);
    if (uniqueTags.size !== question.tags.length) {
      // Find duplicates to list them in the error
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const tag of normalizedTags) {
        if (seen.has(tag)) {
          duplicates.add(tag);
        }
        seen.add(tag);
      }
      throw new Error(
        `Invalid question: Duplicate tags [${Array.from(duplicates)
          .map((d) => `"${d}"`)
          .join(
            ", ",
          )}] found in question "${question.content}". Original tags: [${question.tags.map((t) => `"${t}"`).join(", ")}]`,
      );
    }
  }
}

/**
 * Validates all questions in the seed data
 * @param questions The array of questions to validate, defaults to questionSeeds
 */
export function validateQuestions(questions: Question[] = questionSeeds): void {
  // Validate each question individually
  questions.forEach(validateQuestion);

  // Check for duplicate questions by normalized content
  const questionContents = new Set<string>();
  for (const question of questions) {
    const normalizedContent = normalizeString(question.content);
    if (questionContents.has(normalizedContent)) {
      throw new Error(`Duplicate question found: "${question.content}"`);
    }
    questionContents.add(normalizedContent);
  }
}

// Validate all questions on module load
validateQuestions();
