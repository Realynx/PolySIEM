-- CreateTable
CREATE TABLE "TrafficCounterSample" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bytes" BIGINT NOT NULL,
    "bytesIn" BIGINT,
    "bytesOut" BIGINT,
    "delta" BIGINT,
    "deltaSeconds" INTEGER,

    CONSTRAINT "TrafficCounterSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrafficCounterSample_integrationId_kind_externalId_sampledA_idx" ON "TrafficCounterSample"("integrationId", "kind", "externalId", "sampledAt");

-- CreateIndex
CREATE INDEX "TrafficCounterSample_integrationId_sampledAt_idx" ON "TrafficCounterSample"("integrationId", "sampledAt");

-- AddForeignKey
ALTER TABLE "TrafficCounterSample" ADD CONSTRAINT "TrafficCounterSample_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
