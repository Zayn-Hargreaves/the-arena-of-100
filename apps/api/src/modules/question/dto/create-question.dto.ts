import {
  IsString,
  IsArray,
  IsEnum,
  IsBoolean,
  IsOptional,
  MinLength,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsNotEmpty,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { QuestionDifficulty } from "./get-questions.dto";
import { IsInArray } from "../../../common/validators/is-in-array.validator";

export class CreateQuestionDto {
  @ApiProperty({
    example: "What is the capital of France?",
    description: "The question text",
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  content!: string;

  @ApiProperty({
    example: ["Paris", "London", "Berlin", "Madrid"],
    description: "The possible answers",
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  options!: string[];

  @ApiProperty({ example: "Paris", description: "The correct answer" })
  @IsString()
  @IsInArray("options")
  correctAnswer!: string;

  @ApiProperty({
    example: "EASY",
    description: "The difficulty level",
    enum: QuestionDifficulty,
  })
  @IsEnum(QuestionDifficulty)
  difficulty!: QuestionDifficulty;

  @ApiProperty({
    example: true,
    description: "Whether the question is active",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
