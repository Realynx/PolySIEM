/** Hard safety ceilings for destructive backup imports. */
export const BACKUP_IMPORT_LIMITS = {
  uploadBytes: 64 * 1024 * 1024,
  // Multipart encoding adds boundaries and field headers around the file.
  requestBytes: 65 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  totalRows: 500_000,
  rowsPerModel: 100_000,
  insertBatchRows: 1_000,
} as const;

export class BackupLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupLimitError";
  }
}

export function formatMiB(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}
