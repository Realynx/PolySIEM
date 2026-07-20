import "server-only";

import { ApiError } from "@/lib/api";

/** User-maintained metadata that survives subsequent integration syncs. */
const SYNCED_EDITABLE_FIELDS = new Set([
  "description",
  "location",
  "annotation",
  "purpose",
]);

export function assertSyncedEdit(
  source: string,
  input: Record<string, unknown>,
): void {
  if (source === "MANUAL") return;
  const illegal = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .filter((key) => !SYNCED_EDITABLE_FIELDS.has(key));
  if (illegal.length > 0) {
    throw new ApiError(
      400,
      "integration_owned",
      `Field(s) ${illegal.join(", ")} are managed by the integration sync and cannot be edited. ` +
        `Editable fields on synced entries: ${[...SYNCED_EDITABLE_FIELDS].join(", ")}.`,
    );
  }
}

export function entityNotFound(): never {
  throw new ApiError(404, "not_found", "Entity not found");
}

/** A synced row would simply be recreated; deletion belongs to source/purge. */
export function assertManualDelete(source: string): void {
  if (source !== "MANUAL") {
    throw new ApiError(
      400,
      "integration_owned",
      "This entry is managed by an integration and would be recreated on the next sync. " +
        "Remove it from the source, or delete the integration (with data purge) instead.",
    );
  }
}

