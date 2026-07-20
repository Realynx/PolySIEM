ALTER TYPE "IntegrationType" ADD VALUE 'CENSYS';

CREATE TABLE "CensysLookupCache" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "lookupKind" TEXT NOT NULL DEFAULT 'host',
  "cacheKey" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "responseHash" TEXT NOT NULL,
  "previousResponseHash" TEXT,
  "changed" BOOLEAN NOT NULL DEFAULT false,
  "fetchedBy" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hitCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CensysLookupCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CensysApiUsage" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "cacheHit" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CensysApiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CensysLookupCache_integrationId_lookupKind_cacheKey_key"
  ON "CensysLookupCache"("integrationId", "lookupKind", "cacheKey");
CREATE INDEX "CensysLookupCache_integrationId_fetchedAt_idx"
  ON "CensysLookupCache"("integrationId", "fetchedAt");
CREATE INDEX "CensysLookupCache_expiresAt_idx" ON "CensysLookupCache"("expiresAt");
CREATE INDEX "CensysApiUsage_integrationId_source_cacheHit_createdAt_idx"
  ON "CensysApiUsage"("integrationId", "source", "cacheHit", "createdAt");
CREATE INDEX "CensysApiUsage_createdAt_idx" ON "CensysApiUsage"("createdAt");

ALTER TABLE "CensysLookupCache" ADD CONSTRAINT "CensysLookupCache_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CensysApiUsage" ADD CONSTRAINT "CensysApiUsage_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
