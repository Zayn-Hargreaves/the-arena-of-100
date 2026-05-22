import { Difficulty, Category, Question, validateQuestions } from "./questions";

export const testQuestionSeeds: Question[] = [
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
];

// Validate test questions on module load
validateQuestions(testQuestionSeeds);
