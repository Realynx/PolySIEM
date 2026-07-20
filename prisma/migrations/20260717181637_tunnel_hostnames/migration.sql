-- CreateTable
CREATE TABLE "TunnelHostname" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "resolvedIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proxied" BOOLEAN,
    "lastResolvedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TunnelHostname_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TunnelHostname_tunnelId_hostname_key" ON "TunnelHostname"("tunnelId", "hostname");

-- AddForeignKey
ALTER TABLE "TunnelHostname" ADD CONSTRAINT "TunnelHostname_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
