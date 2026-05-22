/*
  Warnings:

  - Added the required column `category` to the `questions` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `difficulty` on the `questions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuestionCategory" AS ENUM ('GENERAL', 'SCIENCE', 'HISTORY', 'GEOGRAPHY', 'TECHNOLOGY', 'SPORTS', 'CULTURE', 'LOGIC');

-- Backfill / Normalize difficulty in questions table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "questions"
    WHERE TRIM(UPPER("difficulty")) NOT IN ('EASY', 'MEDIUM', 'HARD')
  ) THEN
    RAISE EXCEPTION 'Unsupported questions.difficulty values exist';
  END IF;
END $$;

UPDATE "questions"
SET "difficulty" = TRIM(UPPER("difficulty"));


-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "category" "QuestionCategory" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "explanation" TEXT,
ALTER COLUMN "difficulty" TYPE "Difficulty" USING "difficulty"::"Difficulty";


-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_tags" (
    "questionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_tags_pkey" PRIMARY KEY ("questionId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- AddForeignKey
ALTER TABLE "question_tags" ADD CONSTRAINT "question_tags_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_tags" ADD CONSTRAINT "question_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Remove default after migration
ALTER TABLE "questions" ALTER COLUMN "category" DROP DEFAULT;
