// ============================================================
// Question Controller - Question Management API
// ============================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
} from "@nestjs/common";
import { ParseCuidPipe } from "../../common/pipes/parse-cuid.pipe";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { QuestionService } from "./question.service";
import {
  CreateQuestionDto,
  createQuestionSchema,
} from "./dto/create-question.dto";
import {
  UpdateQuestionDto,
  updateQuestionSchema,
} from "./dto/update-question.dto";
import { GetQuestionsDto, getQuestionsSchema } from "./dto/get-questions.dto";
import { Question } from "./entities/question.entity";
import { Roles } from "../../common/decorators/roles.decorator";
import { Role } from "@prisma/client";
import { BulkImportDto, bulkImportSchema } from "./dto/bulk-import.dto";
import { RandomQueryDto, randomQuerySchema } from "./dto/random-query.dto";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ZodSerialize } from "../../common/interceptors/zod-serializer.interceptor";
import { questionResponseSchema } from "./dto/question-response.schema";
import { QuestionResponseDto } from "./dto/question-response.dto";
import { z } from "zod";

@ApiTags("Questions")
@ApiBearerAuth()
@Controller("questions")
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ZodSerialize(questionResponseSchema)
  @ApiOperation({ summary: "Create a new question" })
  @ApiResponse({
    status: 201,
    description: "Question created successfully",
    type: Question,
  })
  @ApiResponse({ status: 400, description: "Validation failed" })
  async create(
    @Body(new ZodValidationPipe(createQuestionSchema))
    createQuestionDto: CreateQuestionDto,
  ): Promise<z.infer<typeof questionResponseSchema>> {
    return this.questionService.create(createQuestionDto);
  }

  @Post("bulk")
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Bulk import multiple questions" })
  @ApiResponse({
    status: 201,
    description: "Questions imported successfully",
  })
  @ApiResponse({ status: 400, description: "Validation failed" })
  async bulkImport(
    @Body(new ZodValidationPipe(bulkImportSchema))
    bulkImportDto: BulkImportDto,
  ) {
    return this.questionService.bulkImport(bulkImportDto);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ZodSerialize(questionResponseSchema)
  @ApiOperation({ summary: "Get all questions with pagination and filters" })
  @ApiResponse({
    status: 200,
    description: "Return all questions",
    schema: {
      properties: {
        data: {
          type: "array",
          items: {
            $ref: "#/components/schemas/Question",
          },
        },
        meta: {
          $ref: "#/components/schemas/PaginationMetaDto",
        },
      },
    },
  })
  async findAll(
    @Query(new ZodValidationPipe(getQuestionsSchema))
    query: GetQuestionsDto,
  ): Promise<QuestionResponseDto> {
    return this.questionService.findAll(query);
  }

  @Get("random")
  @ZodSerialize(questionResponseSchema)
  @ApiOperation({ summary: "Get a random active question" })
  @ApiResponse({
    status: 200,
    description: "Random question retrieved successfully",
    type: Question,
  })
  @ApiResponse({ status: 404, description: "No questions found" })
  async getRandom(
    @Query(new ZodValidationPipe(randomQuerySchema))
    query: RandomQueryDto,
  ): Promise<z.infer<typeof questionResponseSchema>> {
    return this.questionService.getRandom(query.difficulty, query.excludeIds);
  }

  @Get(":id/stats")
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: "Get dynamic analytics and performance stats for a question",
  })
  @ApiResponse({
    status: 200,
    description: "Dynamic question statistics retrieved successfully",
  })
  @ApiResponse({ status: 404, description: "Question not found" })
  async getStats(@Param("id", ParseCuidPipe) id: string) {
    return this.questionService.getStats(id);
  }

  @Get(":id")
  @Roles(Role.ADMIN)
  @ZodSerialize(questionResponseSchema)
  @ApiOperation({ summary: "Get a single question by ID" })
  @ApiResponse({
    status: 200,
    description: "Return the question",
    type: Question,
  })
  @ApiResponse({ status: 404, description: "Question not found" })
  async findOne(
    @Param("id", ParseCuidPipe) id: string,
  ): Promise<z.infer<typeof questionResponseSchema>> {
    return this.questionService.findOne(id);
  }

  @Patch(":id")
  @Roles(Role.ADMIN)
  @ZodSerialize(questionResponseSchema)
  @ApiOperation({ summary: "Update a question" })
  @ApiResponse({
    status: 200,
    description: "Question updated successfully",
    type: Question,
  })
  @ApiResponse({ status: 404, description: "Question not found" })
  @ApiResponse({ status: 400, description: "Bad Request" })
  async update(
    @Param("id", ParseCuidPipe) id: string,
    @Body(new ZodValidationPipe(updateQuestionSchema))
    updateQuestionDto: UpdateQuestionDto,
  ): Promise<z.infer<typeof questionResponseSchema>> {
    return this.questionService.update(id, updateQuestionDto);
  }

  @Delete(":id")
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Delete a question" })
  @ApiResponse({ status: 204, description: "Question deleted successfully" })
  @ApiResponse({ status: 404, description: "Question not found" })
  @ApiResponse({ status: 400, description: "Invalid CUID" })
  @HttpCode(204)
  async remove(@Param("id", ParseCuidPipe) id: string): Promise<void> {
    await this.questionService.remove(id);
  }
}
