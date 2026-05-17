import { z } from "zod";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { QuestionDifficulty } from "./get-questions.dto";

export const randomQuerySchema = z.object({
  difficulty: z.nativeEnum(QuestionDifficulty).optional(),
  excludeIds: z.preprocess((val) => {
    if (!val) return undefined;
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return undefined;
  }, z.array(z.string()).optional()),
});

export type RandomQueryInput = z.infer<typeof randomQuerySchema>;

export class RandomQueryDto implements RandomQueryInput {
  @ApiPropertyOptional({
    example: "EASY",
    description: "Filter by difficulty",
    enum: QuestionDifficulty,
  })
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional({
    example: ["clx123abc", "clx456def"],
    description:
      "List of CUIDs to exclude from the random selection. Can be passed as multiple parameters or a comma-separated string.",
    type: [String],
  })
  excludeIds?: string[];
}
