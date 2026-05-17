import { z } from "zod";
import { PartialType } from "@nestjs/swagger";
import {
  createQuestionObjectSchema,
  CreateQuestionDto,
} from "./create-question.dto";

export const updateQuestionSchema = createQuestionObjectSchema.partial().refine(
  (data) => {
    // In a partial PATCH update, we check if both options and correctAnswer are provided.
    // If they are, correctAnswer must be one of the options.
    if (data.options !== undefined && data.correctAnswer !== undefined) {
      return data.options.includes(data.correctAnswer);
    }
    return true;
  },
  {
    message: "correctAnswer must be one of the options",
    path: ["correctAnswer"],
  },
);

export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export class UpdateQuestionDto
  extends PartialType(CreateQuestionDto)
  implements UpdateQuestionInput {}
