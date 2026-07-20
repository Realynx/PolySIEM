-- CreateTable
CREATE TABLE "OtxPulseCache" (
    "sourceKey" TEXT NOT NULL,
    "pulseId" TEXT NOT NULL,
    "modified" TIMESTAMP(3) NOT NULL,
    "created" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtxPulseCache_pkey" PRIMARY KEY ("sourceKey","pulseId")
);

-- CreateIndex
CREATE INDEX "OtxPulseCache_sourceKey_modified_idx" ON "OtxPulseCache"("sourceKey", "modified" DESC);
