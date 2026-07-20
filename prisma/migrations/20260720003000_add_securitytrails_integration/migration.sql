ALTER TYPE "IntegrationType" ADD VALUE 'SECURITYTRAILS';

CREATE TABLE "SecurityTrailsLookupCache" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "lookupKind" TEXT NOT NULL,
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
  CONSTRAINT "SecurityTrailsLookupCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecurityTrailsApiUsage" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "cacheHit" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityTrailsApiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityTrailsLookupCache_integrationId_lookupKind_cacheKey_key"
  ON "SecurityTrailsLookupCache"("integrationId", "lookupKind", "cacheKey");
CREATE INDEX "SecurityTrailsLookupCache_integrationId_fetchedAt_idx"
  ON "SecurityTrailsLookupCache"("integrationId", "fetchedAt");
CREATE INDEX "SecurityTrailsLookupCache_expiresAt_idx" ON "SecurityTrailsLookupCache"("expiresAt");
CREATE INDEX "SecurityTrailsApiUsage_integrationId_source_cacheHit_createdAt_idx"
  ON "SecurityTrailsApiUsage"("integrationId", "source", "cacheHit", "createdAt");
CREATE INDEX "SecurityTrailsApiUsage_createdAt_idx" ON "SecurityTrailsApiUsage"("createdAt");

ALTER TABLE "SecurityTrailsLookupCache" ADD CONSTRAINT "SecurityTrailsLookupCache_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityTrailsApiUsage" ADD CONSTRAINT "SecurityTrailsApiUsage_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
