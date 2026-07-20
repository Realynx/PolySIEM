-- CreateTable
CREATE TABLE "SecurityResearchPage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "verdict" TEXT NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "createdById" TEXT,
    "lastResearchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityResearchPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityResearchEvidence" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "query" TEXT,
    "sourceUrl" TEXT,
    "data" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityResearchEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityResearchPage_status_updatedAt_idx" ON "SecurityResearchPage"("status", "updatedAt");
CREATE INDEX "SecurityResearchPage_subject_idx" ON "SecurityResearchPage"("subject");
CREATE INDEX "SecurityResearchPage_createdById_idx" ON "SecurityResearchPage"("createdById");
CREATE INDEX "SecurityResearchEvidence_pageId_capturedAt_idx" ON "SecurityResearchEvidence"("pageId", "capturedAt");
CREATE INDEX "SecurityResearchEvidence_runId_idx" ON "SecurityResearchEvidence"("runId");
CREATE INDEX "SecurityResearchEvidence_provider_capturedAt_idx" ON "SecurityResearchEvidence"("provider", "capturedAt");

-- AddForeignKey
ALTER TABLE "SecurityResearchPage" ADD CONSTRAINT "SecurityResearchPage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecurityResearchEvidence" ADD CONSTRAINT "SecurityResearchEvidence_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SecurityResearchPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
