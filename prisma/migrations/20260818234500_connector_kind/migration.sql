-- OPNsense (and any other WireGuard endpoint) becomes a kind of connector rather
-- than a separate "manual peer" concept. Existing rows are agent connectors.

ALTER TABLE "Connector" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'agent';

CREATE INDEX "Connector_integrationId_kind_idx" ON "Connector"("integrationId", "kind");
