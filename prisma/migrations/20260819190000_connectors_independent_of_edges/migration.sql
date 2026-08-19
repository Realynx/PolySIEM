-- Connectors become standalone: one installed connector can serve many edge
-- servers, and any edge server can route through any linked connector.
-- The per-edge tunnel address moves from Connector onto the new join table,
-- because each edge allocates from its own tunnel subnet.

-- CreateTable
CREATE TABLE "ConnectorEdgeLink" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "tunnelAddress" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHandshakeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorEdgeLink_pkey" PRIMARY KEY ("id")
);

-- Backfill one link per existing connector from its former owning edge, so any
-- already-installed connector keeps exactly the peering (and tunnel IP) it had.
INSERT INTO "ConnectorEdgeLink" ("id", "connectorId", "integrationId", "tunnelAddress", "enabled", "lastHandshakeAt", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    c."id",
    c."integrationId",
    c."tunnelAddress",
    c."status" <> 'disabled',
    c."lastHandshakeAt",
    c."createdAt",
    CURRENT_TIMESTAMP
FROM "Connector" c;

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorEdgeLink_connectorId_integrationId_key" ON "ConnectorEdgeLink"("connectorId", "integrationId");
CREATE UNIQUE INDEX "ConnectorEdgeLink_integrationId_tunnelAddress_key" ON "ConnectorEdgeLink"("integrationId", "tunnelAddress");
CREATE INDEX "ConnectorEdgeLink_integrationId_enabled_idx" ON "ConnectorEdgeLink"("integrationId", "enabled");

-- AddForeignKey
ALTER TABLE "ConnectorEdgeLink" ADD CONSTRAINT "ConnectorEdgeLink_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectorEdgeLink" ADD CONSTRAINT "ConnectorEdgeLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The connector's WireGuard interface is now an explicit, per-connector field.
ALTER TABLE "Connector" ADD COLUMN "interfaceName" TEXT NOT NULL DEFAULT 'wg0';

-- Connector is no longer owned by an edge server.
DROP INDEX IF EXISTS "Connector_integrationId_name_key";
DROP INDEX IF EXISTS "Connector_integrationId_tunnelAddress_key";
DROP INDEX IF EXISTS "Connector_integrationId_status_idx";
DROP INDEX IF EXISTS "Connector_integrationId_kind_idx";
ALTER TABLE "Connector" DROP CONSTRAINT IF EXISTS "Connector_integrationId_fkey";

-- Names must be unique instance-wide now that they are not scoped to an edge.
-- Disambiguate any collisions the old per-edge scoping allowed before adding it.
UPDATE "Connector" c
SET "name" = c."name" || ' (' || left(c."id", 6) || ')'
WHERE EXISTS (
    SELECT 1 FROM "Connector" o
    WHERE o."name" = c."name" AND o."id" <> c."id" AND o."createdAt" < c."createdAt"
);

ALTER TABLE "Connector" DROP COLUMN "integrationId";
ALTER TABLE "Connector" DROP COLUMN "tunnelAddress";

CREATE UNIQUE INDEX "Connector_name_key" ON "Connector"("name");
CREATE INDEX "Connector_status_idx" ON "Connector"("status");
CREATE INDEX "Connector_kind_idx" ON "Connector"("kind");
