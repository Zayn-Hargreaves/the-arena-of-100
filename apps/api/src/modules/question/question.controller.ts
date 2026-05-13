import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ValidationPipe,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { QuestionService } from "./question.service";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { UpdateQuestionDto } from "./dto/update-question.dto";
import { GetQuestionsDto } from "./dto/get-questions.dto";
import { Question } from "./entities/question.entity";
import { QuestionResponseDto } from "./dto/question-response.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Questions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("questions")
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}

  @Post()
  @ApiOperation({ summary: "Create a new question" })
  @ApiResponse({
    status: 201,
    description: "Question created successfully",
    type: Question,
  })
  @ApiResponse({ status: 400, description: "Validation failed" })
  async create(
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
     createQuestionDto: CreateQuestionDto,
  ): Promise<Question> {
    return this.questionService.create(createQuestionDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all questions with pagination and filters" })
  @ApiResponse({
    status: 200,
    description: "Return all questions",
    type: QuestionResponseDto,
  })
  async findAll(
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    query: GetQuestionsDto,
  ): Promise<QuestionResponseDto> {
    return this.questionService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single question by ID" })
  @ApiResponse({
    status: 200,
    description: "Return the question",
    type: Question,
  })
  @ApiResponse({ status: 404, description: "Question not found" })
  async findOne(@Param("id", ParseUUIDPipe) id: string): Promise<Question> {
    return this.questionService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a question" })
  @ApiResponse({
    status: 200,
    description: "Question updated successfully",
    type: Question,
  })
  @ApiResponse({ status: 404, description: "Question not found" })
  @ApiResponse({ status: 400, description: "Bad Request" })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    updateQuestionDto: UpdateQuestionDto,
  ): Promise<Question> {
    return this.questionService.update(id, updateQuestionDto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a question" })
  @ApiResponse({ status: 204, description: "Question deleted successfully" })
  @ApiResponse({ status: 404, description: "Question not found" })
  @ApiResponse({ status: 400, description: "Invalid UUID" })
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.questionService.remove(id);
  }
}
