import { z } from "zod";
import { ApiPropertyOptional } from "@nestjs/swagger";

export enum QuestionDifficulty {
  EASY = "EASY",
  MEDIUM = "MEDIUM",
  HARD = "HARD",
}

export const getQuestionsSchema = z.object({
  page: z.preprocess(
    (val) => (val !== undefined ? Number(val) : undefined),
    z.number().int().min(1).max(1000).default(1),
  ),
  limit: z.preprocess(
    (val) => (val !== undefined ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(20),
  ),
  difficulty: z.nativeEnum(QuestionDifficulty).optional(),
  search: z.string().max(256).optional(),
  active: z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === "") return undefined;
      if (val === "true" || val === true) return true;
      if (val === "false" || val === false) return false;
      return val; // If invalid, return it so Zod's boolean check fails
    },
    z
      .boolean({ invalid_type_error: "Invalid boolean value for active" })
      .optional(),
  ),
});

export type GetQuestionsInput = z.input<typeof getQuestionsSchema>;

export class GetQuestionsDto implements GetQuestionsInput {
  @ApiPropertyOptional({ example: 1, description: "Page number" })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: "Items per page" })
  limit?: number;

  @ApiPropertyOptional({
    example: "EASY",
    description: "Filter by difficulty",
    enum: QuestionDifficulty,
  })
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional({
    example: "capital",
    description: "Search questions by content (max 256 characters)",
  })
  search?: string;

  @ApiPropertyOptional({
    example: true,
    description: "Filter by active status",
  })
  active?: boolean;
}
