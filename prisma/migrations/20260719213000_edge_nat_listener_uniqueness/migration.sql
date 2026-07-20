DROP INDEX IF EXISTS "EdgeNatRule_integrationId_protocol_publicPort_sourceCidr_key";
CREATE UNIQUE INDEX "EdgeNatRule_integrationId_protocol_publicPort_key"
  ON "EdgeNatRule"("integrationId", "protocol", "publicPort");
