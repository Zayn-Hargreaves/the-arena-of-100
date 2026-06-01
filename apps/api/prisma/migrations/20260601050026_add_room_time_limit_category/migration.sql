-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "timeLimit" INTEGER NOT NULL DEFAULT 15;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
