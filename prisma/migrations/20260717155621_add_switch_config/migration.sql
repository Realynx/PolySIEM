-- CreateTable
CREATE TABLE "SwitchConfig" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'cisco-ios',
    "hostname" TEXT,
    "rawConfig" TEXT NOT NULL,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwitchConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwitchPort" (
    "id" TEXT NOT NULL,
    "switchConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT,
    "mode" TEXT,
    "accessVlanId" INTEGER,
    "voiceVlanId" INTEGER,
    "nativeVlanId" INTEGER,
    "allowedVlans" TEXT,
    "channelGroup" INTEGER,
    "channelMode" TEXT,
    "isPortChannel" BOOLEAN NOT NULL DEFAULT false,
    "isShutdown" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "connectedDeviceId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SwitchPort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwitchVlan" (
    "id" TEXT NOT NULL,
    "switchConfigId" TEXT NOT NULL,
    "vlanId" INTEGER NOT NULL,
    "name" TEXT,
    "svIpAddress" TEXT,
    "networkId" TEXT,

    CONSTRAINT "SwitchVlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SwitchConfig_deviceId_key" ON "SwitchConfig"("deviceId");

-- CreateIndex
CREATE INDEX "SwitchPort_switchConfigId_idx" ON "SwitchPort"("switchConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "SwitchVlan_switchConfigId_vlanId_key" ON "SwitchVlan"("switchConfigId", "vlanId");

-- AddForeignKey
ALTER TABLE "SwitchConfig" ADD CONSTRAINT "SwitchConfig_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchPort" ADD CONSTRAINT "SwitchPort_switchConfigId_fkey" FOREIGN KEY ("switchConfigId") REFERENCES "SwitchConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchPort" ADD CONSTRAINT "SwitchPort_connectedDeviceId_fkey" FOREIGN KEY ("connectedDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchVlan" ADD CONSTRAINT "SwitchVlan_switchConfigId_fkey" FOREIGN KEY ("switchConfigId") REFERENCES "SwitchConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchVlan" ADD CONSTRAINT "SwitchVlan_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;
