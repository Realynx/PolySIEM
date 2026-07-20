-- CreateTable
CREATE TABLE "PortForward" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT,
    "sequence" INTEGER,
    "interfaceName" TEXT,
    "protocol" TEXT,
    "sourceSpec" TEXT,
    "destSpec" TEXT,
    "destPort" TEXT,
    "targetIp" TEXT NOT NULL,
    "targetPort" TEXT,
    "descriptionText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" "Source" NOT NULL DEFAULT 'OPNSENSE',
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "annotation" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortForward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DyndnsHost" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT,
    "hostname" TEXT NOT NULL,
    "service" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "interfaceName" TEXT,
    "currentIp" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DyndnsHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkGateway" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "interfaceName" TEXT,
    "ipAddress" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "online" BOOLEAN,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkGateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tunnel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'cloudflare',
    "tunnelExternalId" TEXT,
    "originIp" TEXT,
    "ingressHostnames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceId" TEXT,
    "vmId" TEXT,
    "containerId" TEXT,
    "notes" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tunnel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortForward_integrationId_externalId_key" ON "PortForward"("integrationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "DyndnsHost_integrationId_externalId_key" ON "DyndnsHost"("integrationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkGateway_integrationId_externalId_key" ON "NetworkGateway"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "Tunnel_name_idx" ON "Tunnel"("name");

-- AddForeignKey
ALTER TABLE "PortForward" ADD CONSTRAINT "PortForward_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DyndnsHost" ADD CONSTRAINT "DyndnsHost_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkGateway" ADD CONSTRAINT "NetworkGateway_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tunnel" ADD CONSTRAINT "Tunnel_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tunnel" ADD CONSTRAINT "Tunnel_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tunnel" ADD CONSTRAINT "Tunnel_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;
