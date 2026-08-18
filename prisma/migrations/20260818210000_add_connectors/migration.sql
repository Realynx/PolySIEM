-- Reverse-tunnel connectors (Cloudflare-tunnel style) and connector-backed routes.

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "tunnelAddress" TEXT NOT NULL,
    "publicKey" TEXT,
    "installTokenHash" TEXT,
    "installTokenIssuedAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastSeenAt" TIMESTAMP(3),
    "lastHandshakeAt" TIMESTAMP(3),
    "osInfo" TEXT,
    "agentVersion" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Connector_connectorId_key" ON "Connector"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_integrationId_name_key" ON "Connector"("integrationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_integrationId_tunnelAddress_key" ON "Connector"("integrationId", "tunnelAddress");

-- CreateIndex
CREATE INDEX "Connector_integrationId_status_idx" ON "Connector"("integrationId", "status");

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "EdgeNatRule" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN     "connectorId" TEXT;

-- CreateIndex
CREATE INDEX "EdgeNatRule_connectorId_idx" ON "EdgeNatRule"("connectorId");

-- AddForeignKey
ALTER TABLE "EdgeNatRule" ADD CONSTRAINT "EdgeNatRule_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
