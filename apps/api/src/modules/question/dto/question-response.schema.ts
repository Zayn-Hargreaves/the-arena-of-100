import { z } from "zod";
import { QuestionDifficulty } from "./get-questions.dto";

export const questionResponseSchema = z.object({
  id: z.string(),
  content: z.string(),
  options: z.array(z.string()),
  difficulty: z.nativeEnum(QuestionDifficulty),
  active: z.boolean(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});
