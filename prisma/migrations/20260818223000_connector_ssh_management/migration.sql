-- SSH management for connectors: PolySIEM manages both ends of the tunnel
-- (edge server and internal connector) through a restricted forced-command key.

ALTER TABLE "Connector" ADD COLUMN     "sshHost" TEXT,
ADD COLUMN     "sshPort" INTEGER NOT NULL DEFAULT 22,
ADD COLUMN     "sshUsername" TEXT NOT NULL DEFAULT 'polysiem-connector',
ADD COLUMN     "sshPublicKey" TEXT,
ADD COLUMN     "sshAuthorizedKey" TEXT,
ADD COLUMN     "sshHostKeyFingerprint" TEXT,
ADD COLUMN     "sshProvisionedAt" TIMESTAMP(3),
ADD COLUMN     "encryptedCredentials" TEXT;
