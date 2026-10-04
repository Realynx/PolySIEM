-- Postgres does not index foreign keys automatically. The dashboard footprint
-- and inventory pages join interfaces to their owners and guests to hosts on
-- every load, and the tunnel DNS staleness check sorts by lastResolvedAt.

-- CreateIndex
CREATE INDEX "VirtualMachine_hostId_idx" ON "VirtualMachine"("hostId");

-- CreateIndex
CREATE INDEX "Container_hostId_idx" ON "Container"("hostId");

-- CreateIndex
CREATE INDEX "NetworkInterface_deviceId_idx" ON "NetworkInterface"("deviceId");

-- CreateIndex
CREATE INDEX "NetworkInterface_vmId_idx" ON "NetworkInterface"("vmId");

-- CreateIndex
CREATE INDEX "NetworkInterface_containerId_idx" ON "NetworkInterface"("containerId");

-- CreateIndex
CREATE INDEX "TunnelHostname_lastResolvedAt_idx" ON "TunnelHostname"("lastResolvedAt");
