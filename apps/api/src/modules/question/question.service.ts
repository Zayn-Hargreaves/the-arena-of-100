// ============================================================
// Question Service - Question Management Logic
// ============================================================

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { UpdateQuestionDto } from "./dto/update-question.dto";
import { GetQuestionsDto, QuestionDifficulty } from "./dto/get-questions.dto";
import { Prisma, Question as PrismaQuestion } from "@prisma/client";
import { Question } from "./entities/question.entity";
import { QuestionResponseDto } from "./dto/question-response.dto";
import { BulkImportDto } from "./dto/bulk-import.dto";

@Injectable()
export class QuestionService {
  private readonly MAX_LIMIT = 100;
  private readonly STATS_DECIMAL_PRECISION = 4;

  constructor(private readonly prisma: PrismaService) {}

  private roundToStatsPrecision(value: number): number {
    const multiplier = 10 ** this.STATS_DECIMAL_PRECISION;
    return Math.round(value * multiplier) / multiplier;
  }

  private mapPrismaQuestionToQuestion(
    prismaQuestion: PrismaQuestion,
  ): Question {
    return {
      id: prismaQuestion.id,
      content: prismaQuestion.content,
      options: Array.isArray(prismaQuestion.options)
        ? prismaQuestion.options
        : JSON.parse(JSON.stringify(prismaQuestion.options)),
      correctAnswer: prismaQuestion.correctAnswer,
      difficulty: prismaQuestion.difficulty as QuestionDifficulty,
      active: prismaQuestion.active,
      createdAt: prismaQuestion.createdAt,
      updatedAt: prismaQuestion.updatedAt,
    };
  }

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

    return this.mapPrismaQuestionToQuestion(question);
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

    const mappedData = data.map((question) =>
      this.mapPrismaQuestionToQuestion(question),
    );

    return {
      data: mappedData,
      meta: {
        total,
        page,
        limit: cappedLimit,
        totalPages: Math.ceil(total / cappedLimit),
      },
    };
  }

  async findOne(id: string): Promise<Question> {
    const question = await this.prisma.question.findUnique({
      where: { id },
    });

    if (!question) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }

    return this.mapPrismaQuestionToQuestion(question);
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
    // Additional validation for partial updates:
    // When correctAnswer is provided but options is not, we need to ensure
    // the new correctAnswer exists in the existing question's options
    if (
      updateQuestionDto.correctAnswer !== undefined &&
      updateQuestionDto.options === undefined
    ) {
      const existingQuestion = await this.prisma.question.findUnique({
        where: { id },
      });

      if (!existingQuestion) {
        throw new NotFoundException(`Question with ID ${id} not found`);
      }

      if (
        !existingQuestion.options ||
        !Array.isArray(existingQuestion.options) ||
        !existingQuestion.options.includes(updateQuestionDto.correctAnswer)
      ) {
        throw new BadRequestException(
          "correctAnswer must be one of the existing options",
        );
      }
    }

    try {
      const question = await this.prisma.question.update({
        where: { id },
        data: updateQuestionDto,
      });

      return this.mapPrismaQuestionToQuestion(question);
    } catch (error) {
      return this.handlePrismaNotFound(error, id);
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.question.update({
        where: { id },
        data: { active: false },
      });
    } catch (error) {
      return this.handlePrismaNotFound(error, id);
    }
  }

  async bulkImport(bulkImportDto: BulkImportDto) {
    const { questions } = bulkImportDto;
    const data = questions.map((q) => ({
      content: q.content,
      options: q.options,
      correctAnswer: q.correctAnswer,
      difficulty: q.difficulty,
      active: q.active ?? true,
    }));

    try {
      const result = await this.prisma.question.createMany({
        data,
        skipDuplicates: true,
      });

      return {
        count: result.count,
        message: `Successfully imported ${result.count} questions`,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          // Unique constraint violation
          throw new BadRequestException(
            `Failed to import questions due to unique constraint violation. Some questions may already exist.`,
          );
        }
        // Re-throw other Prisma errors
        throw new BadRequestException(
          `Failed to import questions: ${error.message}`,
        );
      }
      // Re-throw non-Prisma errors
      throw error;
    }
  }

  async getRandom(
    difficulty?: QuestionDifficulty,
    excludeIds?: string[],
  ): Promise<Question> {
    const where: Prisma.QuestionWhereInput = {
      active: true,
    };

    if (difficulty) {
      where.difficulty = difficulty;
    }

    if (excludeIds && excludeIds.length > 0) {
      where.id = {
        notIn: excludeIds,
      };
    }

    const count = await this.prisma.question.count({ where });

    if (count === 0) {
      throw new NotFoundException(
        "No active questions available matching the criteria",
      );
    }

    const randomOffset = Math.floor(Math.random() * count);

    const question = await this.prisma.question.findFirst({
      where,
      skip: randomOffset,
    });

    if (!question) {
      throw new NotFoundException(
        "No active questions available matching the criteria",
      );
    }

    return this.mapPrismaQuestionToQuestion(question);
  }

  async getStats(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
    });

    if (!question) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }

    const answers = await this.prisma.answer.findMany({
      where: {
        round: {
          questionId: id,
        },
      },
      select: {
        isCorrect: true,
        responseTimeMs: true,
      },
    });

    const totalAppearances = answers.length;
    const correctAnswers = answers.filter((a) => a.isCorrect).length;
    const incorrectAnswers = totalAppearances - correctAnswers;
    const actualDifficultyScore =
      totalAppearances > 0
        ? this.roundToStatsPrecision(correctAnswers / totalAppearances)
        : 0;
    const averageResponseTimeMs =
      totalAppearances > 0
        ? Math.round(
            answers.reduce((acc, curr) => acc + curr.responseTimeMs, 0) /
              totalAppearances,
          )
        : 0;

    return {
      questionId: id,
      totalAppearances,
      correctAnswers,
      incorrectAnswers,
      averageResponseTimeMs,
      actualDifficultyScore,
    };
  }
}
