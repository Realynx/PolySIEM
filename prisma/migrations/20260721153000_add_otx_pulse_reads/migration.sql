-- Track threat-intelligence reports read by each user. Receipts are kept
-- independently from the bounded OTX cache so cache eviction does not make a
-- previously read report appear new again.
CREATE TABLE "OtxPulseRead" (
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "pulseId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtxPulseRead_pkey" PRIMARY KEY ("userId", "sourceKey", "pulseId")
);

CREATE INDEX "OtxPulseRead_sourceKey_pulseId_idx" ON "OtxPulseRead"("sourceKey", "pulseId");

ALTER TABLE "OtxPulseRead"
ADD CONSTRAINT "OtxPulseRead_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
