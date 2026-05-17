import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { QuestionDifficulty } from "./get-questions.dto";

// Define the base object schema separately so it can be partial()ed without effect/refinement issues in PATCH
export const createQuestionObjectSchema = z.object({
  content: z.string().min(10).max(1000),
  options: z
    .array(z.string().min(1))
    .min(2)
    .max(6)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: "options must contain unique values",
    }),
  correctAnswer: z.string().min(1),
  difficulty: z.nativeEnum(QuestionDifficulty),
  active: z.boolean().optional(),
});

export const createQuestionSchema = createQuestionObjectSchema.refine(
  (data) => data.options.includes(data.correctAnswer),
  {
    message: "correctAnswer must be one of the options",
    path: ["correctAnswer"],
  },
);

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export class CreateQuestionDto implements CreateQuestionInput {
  @ApiProperty({
    example: "What is the capital of France?",
    description: "The question text",
  })
  content!: string;

  @ApiProperty({
    example: ["Paris", "London", "Berlin", "Madrid"],
    description: "The possible answers",
  })
  options!: string[];

  @ApiProperty({ example: "Paris", description: "The correct answer" })
  correctAnswer!: string;

  @ApiProperty({
    example: "EASY",
    description: "The difficulty level",
    enum: QuestionDifficulty,
  })
  difficulty!: QuestionDifficulty;

  @ApiProperty({
    example: true,
    description: "Whether the question is active",
    required: false,
  })
  active?: boolean;
}
