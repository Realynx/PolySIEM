-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('MANUAL', 'PROXMOX', 'OPNSENSE');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'STALE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PowerState" AS ENUM ('RUNNING', 'STOPPED', 'PAUSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('PROXMOX', 'OPNSENSE');

-- CreateEnum
CREATE TYPE "FirewallAction" AS ENUM ('PASS', 'BLOCK', 'REJECT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "themeColor" TEXT NOT NULL DEFAULT 'blue',
    "themeMode" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "verifyTls" BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "SyncStatus",
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'server',
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "integrationId" TEXT,
    "externalId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "description" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "location" TEXT,
    "cpuModel" TEXT,
    "cpuCores" INTEGER,
    "memoryBytes" BIGINT,
    "osName" TEXT,
    "osVersion" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualMachine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "integrationId" TEXT,
    "externalId" TEXT,
    "vmid" INTEGER,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "powerState" "PowerState" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "description" TEXT,
    "hostId" TEXT,
    "cpuCores" INTEGER,
    "memoryBytes" BIGINT,
    "diskBytes" BIGINT,
    "osName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Container" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "runtime" TEXT NOT NULL DEFAULT 'lxc',
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "integrationId" TEXT,
    "externalId" TEXT,
    "vmid" INTEGER,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "powerState" "PowerState" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "description" TEXT,
    "hostId" TEXT,
    "vmId" TEXT,
    "cpuCores" INTEGER,
    "memoryBytes" BIGINT,
    "diskBytes" BIGINT,
    "osName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Container_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Network" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vlanId" INTEGER,
    "cidr" TEXT,
    "gateway" TEXT,
    "domain" TEXT,
    "purpose" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "integrationId" TEXT,
    "externalId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpAddress" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "networkId" TEXT,
    "interfaceId" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkInterface" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "macAddress" TEXT,
    "deviceId" TEXT,
    "vmId" TEXT,
    "containerId" TEXT,
    "networkId" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "integrationId" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkInterface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "port" INTEGER,
    "protocol" TEXT,
    "description" TEXT,
    "deviceId" TEXT,
    "vmId" TEXT,
    "containerId" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoragePool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "deviceId" TEXT,
    "totalBytes" BIGINT,
    "usedBytes" BIGINT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "integrationId" TEXT,
    "externalId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoragePool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallRule" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT,
    "sequence" INTEGER,
    "action" "FirewallAction" NOT NULL DEFAULT 'PASS',
    "interfaceName" TEXT,
    "direction" TEXT,
    "protocol" TEXT,
    "sourceSpec" TEXT,
    "destSpec" TEXT,
    "destPort" TEXT,
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

    CONSTRAINT "FirewallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallAlias" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliasType" TEXT,
    "content" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "descriptionText" TEXT,
    "integrationId" TEXT,
    "externalId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirewallAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DhcpLease" (
    "id" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "macAddress" TEXT,
    "hostname" TEXT,
    "isStatic" BOOLEAN NOT NULL DEFAULT false,
    "networkId" TEXT,
    "integrationId" TEXT,
    "externalId" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DhcpLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocPage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "authorId" TEXT,
    "createdVia" TEXT NOT NULL DEFAULT 'ui',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'gray',

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagAssignment" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "deviceId" TEXT,
    "vmId" TEXT,
    "containerId" TEXT,
    "networkId" TEXT,
    "serviceId" TEXT,
    "docPageId" TEXT,

    CONSTRAINT "TagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "userId" TEXT,
    "apiTokenId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_type_name_key" ON "IntegrationConfig"("type", "name");

-- CreateIndex
CREATE INDEX "SyncRun_integrationId_startedAt_idx" ON "SyncRun"("integrationId", "startedAt");

-- CreateIndex
CREATE INDEX "Device_name_idx" ON "Device"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Device_integrationId_externalId_key" ON "Device"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "VirtualMachine_name_idx" ON "VirtualMachine"("name");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_integrationId_externalId_key" ON "VirtualMachine"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "Container_name_idx" ON "Container"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Container_integrationId_externalId_key" ON "Container"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "Network_name_idx" ON "Network"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Network_integrationId_externalId_key" ON "Network"("integrationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "IpAddress_interfaceId_key" ON "IpAddress"("interfaceId");

-- CreateIndex
CREATE INDEX "IpAddress_address_idx" ON "IpAddress"("address");

-- CreateIndex
CREATE UNIQUE INDEX "IpAddress_address_networkId_key" ON "IpAddress"("address", "networkId");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkInterface_integrationId_externalId_key" ON "NetworkInterface"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "Service_name_idx" ON "Service"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StoragePool_integrationId_externalId_key" ON "StoragePool"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "FirewallRule_interfaceName_idx" ON "FirewallRule"("interfaceName");

-- CreateIndex
CREATE UNIQUE INDEX "FirewallRule_integrationId_externalId_key" ON "FirewallRule"("integrationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "FirewallAlias_integrationId_externalId_key" ON "FirewallAlias"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "DhcpLease_ipAddress_idx" ON "DhcpLease"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DhcpLease_integrationId_externalId_key" ON "DhcpLease"("integrationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "DocPage_slug_key" ON "DocPage"("slug");

-- CreateIndex
CREATE INDEX "DocPage_title_idx" ON "DocPage"("title");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "TagAssignment_entityType_entityId_idx" ON "TagAssignment"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "TagAssignment_tagId_entityType_entityId_key" ON "TagAssignment"("tagId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Network" ADD CONSTRAINT "Network_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "NetworkInterface"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkInterface" ADD CONSTRAINT "NetworkInterface_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkInterface" ADD CONSTRAINT "NetworkInterface_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkInterface" ADD CONSTRAINT "NetworkInterface_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkInterface" ADD CONSTRAINT "NetworkInterface_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkInterface" ADD CONSTRAINT "NetworkInterface_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoragePool" ADD CONSTRAINT "StoragePool_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoragePool" ADD CONSTRAINT "StoragePool_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirewallRule" ADD CONSTRAINT "FirewallRule_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirewallAlias" ADD CONSTRAINT "FirewallAlias_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DhcpLease" ADD CONSTRAINT "DhcpLease_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DhcpLease" ADD CONSTRAINT "DhcpLease_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DocPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_docPageId_fkey" FOREIGN KEY ("docPageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
