// ============================================================
// Question Service - Question Management Logic
// ============================================================

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { UpdateQuestionDto } from "./dto/update-question.dto";
import { GetQuestionsDto } from "./dto/get-questions.dto";
import { Prisma } from "@prisma/client";
import { Question } from "./entities/question.entity";
import { QuestionResponseDto } from "./dto/question-response.dto";
import { plainToInstance } from "class-transformer";

@Injectable()
export class QuestionService {
  private readonly MAX_LIMIT = 100;

  constructor(private readonly prisma: PrismaService) {}

  async create(createQuestionDto: CreateQuestionDto): Promise<Question> {
    const question = await this.prisma.question.create({
      data: {
        content: createQuestionDto.content,
        options: createQuestionDto.options,
        correctAnswer: createQuestionDto.correctAnswer,
        difficulty: createQuestionDto.difficulty,
        active: createQuestionDto.active ?? true,
      },
    });

    return plainToInstance(Question, question);
  }

  async findAll(query: GetQuestionsDto): Promise<QuestionResponseDto> {
    const { page = 1, limit = 20, difficulty, search, active } = query;
    const cappedLimit = Math.min(limit, this.MAX_LIMIT);
    const skip = (page - 1) * cappedLimit;

    const where: Prisma.QuestionWhereInput = {};

    if (difficulty) {
      where.difficulty = difficulty;
    }

    if (active !== undefined) {
      where.active = active;
    }

    if (search) {
      where.content = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        skip,
        take: cappedLimit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.question.count({ where }),
    ]);


    return plainToInstance(QuestionResponseDto, {
      data: plainToInstance(Question, data),
      meta: {
        total,
        page,
        limit: cappedLimit,
        totalPages: Math.ceil(total / cappedLimit),
      },
    });
  }

  async findOne(id: string): Promise<Question> {
    const question = await this.prisma.question.findUnique({
      where: { id },
    });

    if (!question) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }

    return plainToInstance(Question, question);
  }
  private handlePrismaNotFound(error: unknown, id: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }
    throw error;
  }

  async update(
    id: string,
    updateQuestionDto: UpdateQuestionDto,
  ): Promise<Question> {
    try {
      const question = await this.prisma.question.update({
        where: { id },
        data: updateQuestionDto,
      });

      return plainToInstance(Question, question);
    } catch (error) {
      return this.handlePrismaNotFound(error, id);
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.question.delete({
        where: { id },
      });
    } catch (error) {
      return this.handlePrismaNotFound(error, id);
    }
  }
}
