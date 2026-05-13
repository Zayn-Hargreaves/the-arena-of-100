import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  IsEnum,
  IsBoolean,
  MaxLength,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

export enum QuestionDifficulty {
  EASY = "EASY",
  MEDIUM = "MEDIUM",
  HARD = "HARD",
}

export class GetQuestionsDto {
  @ApiPropertyOptional({ example: 1, description: "Page number" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, description: "Items per page" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: "EASY",
    description: "Filter by difficulty",
    enum: QuestionDifficulty,
  })
  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional({
    example: "capital",
    description: "Search questions by content (max 256 characters)",
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;

  @ApiPropertyOptional({
    example: true,
    description: "Filter by active status",
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === "") return undefined;
    else if (value === "true" || value === true) return true;
    else if (value === "false" || value === false) return false;
    else return undefined;
  })
  active?: boolean;
}
