-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateTable
CREATE TABLE "SecurityTicket" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" "TicketSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "category" TEXT NOT NULL DEFAULT 'anomaly',
    "createdBy" TEXT NOT NULL DEFAULT 'ai',
    "dedupeKey" TEXT,
    "evidence" JSONB,
    "suggestions" TEXT,
    "sourceRefs" JSONB,
    "timesSeen" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanRunId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiScanRun" (
    "id" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "timeRangeFrom" TIMESTAMP(3) NOT NULL,
    "timeRangeTo" TIMESTAMP(3) NOT NULL,
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "AiScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityTicket_dedupeKey_key" ON "SecurityTicket"("dedupeKey");

-- CreateIndex
CREATE INDEX "SecurityTicket_status_severity_idx" ON "SecurityTicket"("status", "severity");

-- CreateIndex
CREATE INDEX "SecurityTicket_createdAt_idx" ON "SecurityTicket"("createdAt");

-- CreateIndex
CREATE INDEX "AiScanRun_startedAt_idx" ON "AiScanRun"("startedAt");

-- AddForeignKey
ALTER TABLE "SecurityTicket" ADD CONSTRAINT "SecurityTicket_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "AiScanRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityTicket" ADD CONSTRAINT "SecurityTicket_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
