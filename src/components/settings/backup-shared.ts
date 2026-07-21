import type { DestinationType } from "@/lib/backup/types";

export const BACKUP_KEY = ["admin-backup"];

export const BACKUP_TYPE_META: Record<DestinationType, { label: string }> = {
  s3: { label: "S3-compatible" },
  azure: { label: "Azure Blob" },
};

