-- CreateTable
CREATE TABLE "SshKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "bits" INTEGER,
    "comment" TEXT,
    "purpose" TEXT,
    "ownerLabel" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SshKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SshKeyDeployment" (
    "id" TEXT NOT NULL,
    "sshKeyId" TEXT NOT NULL,
    "username" TEXT NOT NULL DEFAULT 'root',
    "method" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "entityType" TEXT NOT NULL,
    "deviceId" TEXT,
    "vmId" TEXT,
    "containerId" TEXT,
    "hostLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SshKeyDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SshKey_fingerprint_key" ON "SshKey"("fingerprint");

-- CreateIndex
CREATE INDEX "SshKey_name_idx" ON "SshKey"("name");

-- CreateIndex
CREATE INDEX "SshKeyDeployment_sshKeyId_idx" ON "SshKeyDeployment"("sshKeyId");

-- AddForeignKey
ALTER TABLE "SshKeyDeployment" ADD CONSTRAINT "SshKeyDeployment_sshKeyId_fkey" FOREIGN KEY ("sshKeyId") REFERENCES "SshKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SshKeyDeployment" ADD CONSTRAINT "SshKeyDeployment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SshKeyDeployment" ADD CONSTRAINT "SshKeyDeployment_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SshKeyDeployment" ADD CONSTRAINT "SshKeyDeployment_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE CASCADE ON UPDATE CASCADE;
