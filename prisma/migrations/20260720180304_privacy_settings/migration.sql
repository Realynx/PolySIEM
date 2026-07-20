-- AlterTable
ALTER TABLE "User" ADD COLUMN     "anonymousMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shieldOnBlur" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shieldOnCapture" BOOLEAN NOT NULL DEFAULT false;

-- RenameIndex
ALTER INDEX "SecurityTrailsApiUsage_integrationId_source_cacheHit_createdAt_" RENAME TO "SecurityTrailsApiUsage_integrationId_source_cacheHit_create_idx";
