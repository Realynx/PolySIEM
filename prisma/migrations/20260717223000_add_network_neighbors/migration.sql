-- CreateTable
CREATE TABLE "NetworkNeighbor" (
    "id" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "macAddress" TEXT,
    "hostname" TEXT,
    "manufacturer" TEXT,
    "interfaceKey" TEXT,
    "permanent" BOOLEAN NOT NULL DEFAULT false,
    "networkId" TEXT,
    "integrationId" TEXT,
    "externalId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkNeighbor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetworkNeighbor_ipAddress_idx" ON "NetworkNeighbor"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkNeighbor_integrationId_externalId_key" ON "NetworkNeighbor"("integrationId", "externalId");

-- AddForeignKey
ALTER TABLE "NetworkNeighbor" ADD CONSTRAINT "NetworkNeighbor_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkNeighbor" ADD CONSTRAINT "NetworkNeighbor_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
