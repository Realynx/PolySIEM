-- Privacy router: a PolySIEM-managed Linux box on the LAN that decides, per flow,
-- whether traffic egresses through the normal WAN or through one of several
-- WireGuard exits. It replaces a hand-rolled failover script whose only
-- "killswitch" was route absence, and whose single-tunnel-at-a-time design
-- cannot express per-service policy at all.
--
-- Six new tables, no changes to any existing one — this is purely additive, so
-- a pre-update image keeps running against a database that has had it applied.
--
-- Why ManagedHost exists and why nothing else uses it yet:
--   The SSH-management columns are duplicated across Connector and the
--   EDGE_NAT_SERVER integration, and the duplication has already produced a real
--   asymmetry bug. ManagedHost is the single storage shape those will eventually
--   share, but ONLY the new PrivacyRouter points at it in this release. The edge and
--   connector boxes are carrying live production traffic; moving their storage
--   in the same migration as a large new feature is not a risk worth taking, and
--   an expand-first migration lets the follow-up backfill on its own schedule.
--   `kind` is here from day one so that backfill can tell rows apart.
--
-- Why ServiceTrafficSample is a new table rather than more TrafficCounterSample:
--   TrafficCounterSample."bytes" is contractually CUMULATIVE and its reset
--   detector silently rewrites interval-shaped input to delta = NULL. These rows
--   are intervals. Overloading its "kind" would also drag per-hostname,
--   high-cardinality rows into the firewall dashboard's unfiltered window query.
--   The column here is "hostname", not "externalId", because the demo-mode
--   anonymizer skips keys named externalId and would leak real hostnames.
--
-- ServiceTrafficRollup is folded forward inside the ingest transaction (upsert +
-- increment), so monthly totals survive the raw-sample prune by construction
-- rather than depending on a batch job that has to beat the pruner.

-- CreateTable
CREATE TABLE "ManagedHost" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'privacy-router',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "publicKey" TEXT,
    "authorizedKey" TEXT,
    "hostKeyFingerprint" TEXT,
    "provisionedAt" TIMESTAMP(3),
    "encryptedCredentials" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRouter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "managedHostId" TEXT NOT NULL,
    -- Nullable and DEFAULT-FREE. A router row exists before anyone knows its
    -- topology: PolySIEM only learns the interface names by asking the box, and
    -- it can only ask once the agent is installed. A default of 'eth0' would
    -- make an unconfirmed guess indistinguishable from a confirmed answer, and
    -- an apply would then route real traffic with it. NULL means "not confirmed
    -- yet", and the apply path refuses rather than guessing.
    "lanCidr" TEXT,
    "lanInterface" TEXT,
    "wanInterface" TEXT,
    "proxyHttpPort" INTEGER NOT NULL DEFAULT 3128,
    "proxyHttpsPort" INTEGER NOT NULL DEFAULT 3129,
    "blockQuic" BOOLEAN NOT NULL DEFAULT true,
    "defaultAction" TEXT NOT NULL DEFAULT 'direct',
    "defaultExitId" TEXT,
    "appliedRevision" INTEGER NOT NULL DEFAULT 0,
    "appliedHash" TEXT,
    "lastStatusAt" TIMESTAMP(3),
    "exitsConcurrent" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRouter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpnExit" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ifName" TEXT NOT NULL,
    "addressCidr" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "peerPublicKey" TEXT NOT NULL,
    "keepalive" INTEGER NOT NULL DEFAULT 25,
    "mtu" INTEGER NOT NULL DEFAULT 1420,
    "encryptedPrivateKey" TEXT,
    "privateKeySha256" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHandshakeAt" TIMESTAMP(3),
    "lastRxBytes" BIGINT,
    "lastTxBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpnExit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRoutingRule" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "exitId" TEXT,
    "srcCidr" TEXT,
    "dstCidr" TEXT,
    "proto" TEXT,
    "dportSpec" TEXT,
    "hostname" TEXT,
    "rateKbps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTrafficSample" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "bytesIn" BIGINT NOT NULL,
    "bytesOut" BIGINT NOT NULL,
    "flows" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceTrafficSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTrafficRollup" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "bytesIn" BIGINT NOT NULL DEFAULT 0,
    "bytesOut" BIGINT NOT NULL DEFAULT 0,
    "samples" INTEGER NOT NULL DEFAULT 0,
    "observedSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTrafficRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagedHost_kind_idx" ON "ManagedHost"("kind");

-- CreateIndex
CREATE INDEX "ManagedHost_host_idx" ON "ManagedHost"("host");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRouter_name_key" ON "PrivacyRouter"("name");

-- One router per managed host: the relation is 1:1, not many-to-one.
-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRouter_managedHostId_key" ON "PrivacyRouter"("managedHostId");

-- CreateIndex
CREATE INDEX "PrivacyRouter_enabled_idx" ON "PrivacyRouter"("enabled");

-- CreateIndex
CREATE INDEX "VpnExit_routerId_enabled_idx" ON "VpnExit"("routerId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "VpnExit_routerId_key_key" ON "VpnExit"("routerId", "key");

-- Two exits on one router must not claim the same netdev name.
-- CreateIndex
CREATE UNIQUE INDEX "VpnExit_routerId_ifName_key" ON "VpnExit"("routerId", "ifName");

-- CreateIndex
CREATE INDEX "PrivacyRoutingRule_routerId_enabled_seq_idx" ON "PrivacyRoutingRule"("routerId", "enabled", "seq");

-- CreateIndex
CREATE INDEX "PrivacyRoutingRule_exitId_idx" ON "PrivacyRoutingRule"("exitId");

-- The ordered rule list is dense and first-match-wins, so `seq` must be unique
-- within a router. Reordering therefore cannot swap two rows with two separate
-- UPDATEs; the service shifts the affected rows out of range first.
-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRoutingRule_routerId_seq_key" ON "PrivacyRoutingRule"("routerId", "seq");

-- CreateIndex
CREATE INDEX "ServiceTrafficSample_routerId_sampledAt_idx" ON "ServiceTrafficSample"("routerId", "sampledAt");

-- Idempotent ingest: a duplicated or concurrent poll for the same instant is a
-- conflict rather than a second row. This also serves every lookup keyed by
-- (routerId, hostname, …), so no separate index is created for it.
--
-- "action" is part of the key because the proxy counts (hostname, action)
-- PAIRS: one hostname can legitimately appear twice in one STATUS, once direct
-- and once through an exit. Keying on hostname alone would make the second line
-- of such a pair collide with the first and be discarded, and would erase the
-- direct-vs-VPN split this feature exists to report.
-- CreateIndex
CREATE UNIQUE INDEX "ServiceTrafficSample_routerId_hostname_action_sampledAt_key" ON "ServiceTrafficSample"("routerId", "hostname", "action", "sampledAt");

-- CreateIndex
CREATE INDEX "ServiceTrafficRollup_routerId_period_periodStart_idx" ON "ServiceTrafficRollup"("routerId", "period", "periodStart");

-- CreateIndex
-- Name truncated to Postgres' 63-character identifier limit exactly as Prisma
-- truncates it, so `migrate diff` never reports drift against this schema.
CREATE UNIQUE INDEX "ServiceTrafficRollup_routerId_hostname_action_period_period_key" ON "ServiceTrafficRollup"("routerId", "hostname", "action", "period", "periodStart");

-- AddForeignKey
ALTER TABLE "PrivacyRouter" ADD CONSTRAINT "PrivacyRouter_managedHostId_fkey" FOREIGN KEY ("managedHostId") REFERENCES "ManagedHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not SET NULL: an exit that is a router's default must be detached
-- deliberately. Nulling it silently would leave defaultAction = 'exit' with no
-- exit, and a flow assigned to a VPN must never quietly fall back to the WAN.
-- Deleting the ROUTER still works: its own row is gone before the cascade
-- reaches its exits, so nothing references them by then.
-- AddForeignKey
ALTER TABLE "PrivacyRouter" ADD CONSTRAINT "PrivacyRouter_defaultExitId_fkey" FOREIGN KEY ("defaultExitId") REFERENCES "VpnExit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpnExit" ADD CONSTRAINT "VpnExit_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "PrivacyRouter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRoutingRule" ADD CONSTRAINT "PrivacyRoutingRule_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "PrivacyRouter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE mirrors EdgeNatRule.connectorId: deleting an exit removes the rules
-- that route through it rather than leaving rules that cannot be rendered into
-- the canonical ruleset at all. The UI must state how many rules go with it.
-- AddForeignKey
ALTER TABLE "PrivacyRoutingRule" ADD CONSTRAINT "PrivacyRoutingRule_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "VpnExit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTrafficSample" ADD CONSTRAINT "ServiceTrafficSample_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "PrivacyRouter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTrafficRollup" ADD CONSTRAINT "ServiceTrafficRollup_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "PrivacyRouter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
