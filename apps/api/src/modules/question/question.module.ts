import { Module } from "@nestjs/common";
import { QuestionService } from "./question.service";
import { QuestionController } from "./question.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [QuestionController],
  providers: [QuestionService],
})
export class QuestionModule {}
