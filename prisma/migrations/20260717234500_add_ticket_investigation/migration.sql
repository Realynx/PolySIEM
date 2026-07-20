-- AlterTable
ALTER TABLE "SecurityTicket" ADD COLUMN "investigation" JSONB;
ALTER TABLE "SecurityTicket" ADD COLUMN "investigatedAt" TIMESTAMP(3);
