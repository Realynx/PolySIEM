ALTER TYPE "Source" ADD VALUE 'CLOUDFLARE';

ALTER TABLE "Service"
ADD COLUMN "integrationId" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "metadata" JSONB;

CREATE UNIQUE INDEX "Service_integrationId_externalId_key"
ON "Service"("integrationId", "externalId");

ALTER TABLE "Service"
ADD CONSTRAINT "Service_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
