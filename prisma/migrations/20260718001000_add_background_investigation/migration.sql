-- AlterTable
ALTER TABLE "SecurityTicket" ADD COLUMN "investigationStatus" TEXT;
ALTER TABLE "SecurityTicket" ADD COLUMN "investigationStartedAt" TIMESTAMP(3);
ALTER TABLE "SecurityTicket" ADD COLUMN "investigationProgress" JSONB;
ALTER TABLE "SecurityTicket" ADD COLUMN "investigationError" TEXT;
