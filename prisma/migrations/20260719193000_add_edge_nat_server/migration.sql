ALTER TYPE "Source" ADD VALUE 'EDGE_NAT_SERVER';
ALTER TYPE "IntegrationType" ADD VALUE 'EDGE_NAT_SERVER';

CREATE TABLE "EdgeNatRule" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "publicPort" INTEGER NOT NULL,
  "targetAddress" TEXT NOT NULL,
  "targetPort" INTEGER NOT NULL,
  "sourceCidr" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EdgeNatRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EdgeNatRule_integrationId_protocol_publicPort_sourceCidr_key"
  ON "EdgeNatRule"("integrationId", "protocol", "publicPort", "sourceCidr");
CREATE INDEX "EdgeNatRule_integrationId_enabled_idx" ON "EdgeNatRule"("integrationId", "enabled");
ALTER TABLE "EdgeNatRule" ADD CONSTRAINT "EdgeNatRule_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
