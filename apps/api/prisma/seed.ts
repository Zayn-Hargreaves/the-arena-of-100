// ============================================================
// Seed Script - Initial Question Data
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const questions = [
  // EASY
  {
    content: 'Thủ đô của Việt Nam là gì?',
    options: ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Huế'],
    correctAnswer: 'Hà Nội',
    difficulty: 'EASY',
  },
  {
    content: 'Mặt trời mọc ở hướng nào?',
    options: ['Đông', 'Tây', 'Nam', 'Bắc'],
    correctAnswer: 'Đông',
    difficulty: 'EASY',
  },
  {
    content: '1 + 1 = ?',
    options: ['1', '2', '3', '4'],
    correctAnswer: '2',
    difficulty: 'EASY',
  },
  {
    content: 'Nước sôi ở nhiệt độ bao nhiêu độ C?',
    options: ['50°C', '80°C', '100°C', '120°C'],
    correctAnswer: '100°C',
    difficulty: 'EASY',
  },
  {
    content: 'Con vật nào được gọi là "chúa tể rừng xanh"?',
    options: ['Hổ', 'Sư tử', 'Voi', 'Gấu'],
    correctAnswer: 'Sư tử',
    difficulty: 'EASY',
  },
  // MEDIUM
  {
    content: 'Ai là người sáng lập ra Facebook?',
    options: ['Bill Gates', 'Mark Zuckerberg', 'Steve Jobs', 'Elon Musk'],
    correctAnswer: 'Mark Zuckerberg',
    difficulty: 'MEDIUM',
  },
  {
    content: 'Nguyên tố hóa học nào có ký hiệu là "Fe"?',
    options: ['Fluorine', 'Iron (Sắt)', 'Francium', 'Fermium'],
    correctAnswer: 'Iron (Sắt)',
    difficulty: 'MEDIUM',
  },
  {
    content: 'Đại dương nào lớn nhất thế giới?',
    options: ['Đại Tây Dương', 'Ấn Độ Dương', 'Thái Bình Dương', 'Bắc Băng Dương'],
    correctAnswer: 'Thái Bình Dương',
    difficulty: 'MEDIUM',
  },
  {
    content: 'Năm nào Việt Nam giành độc lập?',
    options: ['1945', '1954', '1975', '1986'],
    correctAnswer: '1945',
    difficulty: 'MEDIUM',
  },
  {
    content: 'Python là ngôn ngữ lập trình được tạo ra bởi ai?',
    options: ['James Gosling', 'Guido van Rossum', 'Bjarne Stroustrup', 'Dennis Ritchie'],
    correctAnswer: 'Guido van Rossum',
    difficulty: 'MEDIUM',
  },
  // HARD
  {
    content: 'Trong vật lý, đơn vị đo cường độ dòng điện là gì?',
    options: ['Volt', 'Watt', 'Ampere', 'Ohm'],
    correctAnswer: 'Ampere',
    difficulty: 'HARD',
  },
  {
    content: 'Ai là tác giả của tác phẩm "Truyện Kiều"?',
    options: ['Nguyễn Du', 'Hồ Xuân Hương', 'Nguyễn Trãi', 'Bà Huyện Thanh Quan'],
    correctAnswer: 'Nguyễn Du',
    difficulty: 'HARD',
  },
  {
    content: 'Khoảng cách từ Trái Đất đến Mặt Trời là bao nhiêu km?',
    options: ['100 triệu km', '150 triệu km', '200 triệu km', '250 triệu km'],
    correctAnswer: '150 triệu km',
    difficulty: 'HARD',
  },
  {
    content: 'HTTP status code 404 có ý nghĩa gì?',
    options: ['Server Error', 'Unauthorized', 'Not Found', 'Forbidden'],
    correctAnswer: 'Not Found',
    difficulty: 'HARD',
  },
  {
    content: 'Trong lịch sử, trận Điện Biên Phủ diễn ra vào năm nào?',
    options: ['1945', '1954', '1968', '1975'],
    correctAnswer: '1954',
    difficulty: 'HARD',
  },
];

async function main() {
  console.log('🌱 Seeding questions...');

  for (const question of questions) {
    await prisma.question.create({
      data: question,
    });
  }

  console.log(`✅ Seeded ${questions.length} questions`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });