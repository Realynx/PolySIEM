-- CreateTable
CREATE TABLE "WirelessNetwork" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT,
    "source" "Source" NOT NULL DEFAULT 'UNIFI',
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "security" TEXT,
    "wpaMode" TEXT,
    "band" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "vlanId" INTEGER,
    "networkId" TEXT,
    "apCount" INTEGER,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WirelessNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WirelessAp" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT,
    "source" "Source" NOT NULL DEFAULT 'UNIFI',
    "name" TEXT NOT NULL,
    "model" TEXT,
    "mac" TEXT,
    "ipAddress" TEXT,
    "adopted" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT,
    "deviceId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WirelessAp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WirelessNetwork_name_idx" ON "WirelessNetwork"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WirelessNetwork_integrationId_externalId_key" ON "WirelessNetwork"("integrationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WirelessAp_integrationId_externalId_key" ON "WirelessAp"("integrationId", "externalId");

-- AddForeignKey
ALTER TABLE "WirelessNetwork" ADD CONSTRAINT "WirelessNetwork_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WirelessNetwork" ADD CONSTRAINT "WirelessNetwork_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WirelessAp" ADD CONSTRAINT "WirelessAp_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WirelessAp" ADD CONSTRAINT "WirelessAp_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
