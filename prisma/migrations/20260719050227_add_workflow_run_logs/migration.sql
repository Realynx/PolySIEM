-- CreateEnum
CREATE TYPE "WorkflowLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "WorkflowRunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT,
    "level" "WorkflowLogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowRunLog_runId_seq_idx" ON "WorkflowRunLog"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRunLog_runId_seq_key" ON "WorkflowRunLog"("runId", "seq");

-- AddForeignKey
ALTER TABLE "WorkflowRunLog" ADD CONSTRAINT "WorkflowRunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
