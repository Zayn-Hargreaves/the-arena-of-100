import { IsOptional, IsEnum, IsArray, IsString } from "class-validator";
import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { QuestionDifficulty } from "./get-questions.dto";

export class RandomQueryDto {
  @ApiPropertyOptional({
    example: "EASY",
    description: "Filter by difficulty",
    enum: QuestionDifficulty,
  })
  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional({
    example: ["clx123abc", "clx456def"],
    description: "List of CUIDs to exclude from the random selection. Can be passed as multiple parameters or a comma-separated string.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return undefined;
  })
  excludeIds?: string[];
}
