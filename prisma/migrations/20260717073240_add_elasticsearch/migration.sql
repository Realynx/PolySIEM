-- AlterEnum
ALTER TYPE "IntegrationType" ADD VALUE 'ELASTICSEARCH';

-- AlterTable
ALTER TABLE "IntegrationConfig" ADD COLUMN     "settings" JSONB;
