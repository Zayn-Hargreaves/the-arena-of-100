import { describe, it, expect } from "vitest";
import { validateQuestions, Question } from "../../src/prisma-seeds/questions";

describe("Questions Seed Validation - Tags", () => {
  const baseValidQuestion: Question = {
    content: "Thủ đô của Việt Nam là gì?",
    options: ["Hà Nội", "Hồ Chí Minh", "Đà Nẵng", "Huế"],
    correctAnswer: "Hà Nội",
    difficulty: "EASY",
    category: "GEOGRAPHY",
    tags: ["Việt Nam", "chính trị"],
  };

  it("should pass validation with valid tags", () => {
    expect(() => validateQuestions([baseValidQuestion])).not.toThrow();
  });

  it("should pass validation if tags are not provided", () => {
    const questionWithoutTags = { ...baseValidQuestion };
    delete questionWithoutTags.tags;
    expect(() => validateQuestions([questionWithoutTags])).not.toThrow();
  });

  it("should throw error when a tag is empty or only spaces", () => {
    const questionWithEmptyTag: Question = {
      ...baseValidQuestion,
      tags: ["Việt Nam", "  ", "chính trị"],
    };
    expect(() => validateQuestions([questionWithEmptyTag])).toThrowError(
      /Empty tag found in question/,
    );
  });

  it("should throw error when duplicate tags exist after normalization", () => {
    const questionWithDuplicateTags: Question = {
      ...baseValidQuestion,
      tags: ["HTTP", "http"],
    };
    expect(() => validateQuestions([questionWithDuplicateTags])).toThrowError(
      /Duplicate tags \["http"\] found in question/,
    );
  });

  it("should throw error when duplicate tags with spaces exist after normalization", () => {
    const questionWithDuplicateTagsSpaces: Question = {
      ...baseValidQuestion,
      tags: ["  HTTP  ", "http"],
    };
    expect(() =>
      validateQuestions([questionWithDuplicateTagsSpaces]),
    ).toThrowError(/Duplicate tags \["http"\] found in question/);
  });

  it.each(["", "   "])(
    "should throw error when question content is empty (%j)",
    (content) => {
      const questionWithEmptyContent: Question = {
        ...baseValidQuestion,
        content,
      };
      expect(() => validateQuestions([questionWithEmptyContent])).toThrowError(
        /Question content cannot be empty/,
      );
    },
  );

  it.each(["", "  "])(
    "should throw error when an option is empty (%j)",
    (emptyOption) => {
      const questionWithEmptyOption: Question = {
        ...baseValidQuestion,
        options: ["Hà Nội", "Hồ Chí Minh", emptyOption, "Huế"],
      };
      expect(() => validateQuestions([questionWithEmptyOption])).toThrowError(
        /Option cannot be empty/,
      );
    },
  );

  it("should throw error when options contain duplicates after normalization", () => {
    const questionWithDupOptions: Question = {
      ...baseValidQuestion,
      options: ["Hà Nội", "Hồ Chí Minh", "hà nội", "Huế"],
    };
    expect(() => validateQuestions([questionWithDupOptions])).toThrowError(
      /Options contain duplicates/,
    );
  });

  it("should throw error when correctAnswer is not in options", () => {
    const questionWithInvalidAnswer: Question = {
      ...baseValidQuestion,
      correctAnswer: "Hải Phòng",
    };
    expect(() => validateQuestions([questionWithInvalidAnswer])).toThrowError(
      /Correct answer "Hải Phòng" is not in options/,
    );
  });

  it("should throw error when difficulty is invalid", () => {
    const questionWithInvalidDifficulty = {
      ...baseValidQuestion,
      difficulty: "EXTREME" as any,
    };
    expect(() =>
      validateQuestions([questionWithInvalidDifficulty]),
    ).toThrowError(/Invalid difficulty "EXTREME"/);
  });

  it("should throw error when category is missing", () => {
    const questionWithMissingCategory = {
      ...baseValidQuestion,
    };
    delete (questionWithMissingCategory as Partial<Question>).category;
    expect(() => validateQuestions([questionWithMissingCategory])).toThrowError(
      /Missing category for question/,
    );
  });

  it("should throw error when category is invalid", () => {
    const questionWithInvalidCategory = {
      ...baseValidQuestion,
      category: "MATH" as any,
    };
    expect(() => validateQuestions([questionWithInvalidCategory])).toThrowError(
      /Invalid category "MATH"/,
    );
  });
});
