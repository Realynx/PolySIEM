import "server-only";

import { randomUUID } from "node:crypto";
import { getSetting, SETTING_KEYS, setSetting } from "@/lib/settings";
import { compareVersions, getCurrentVersion } from "@/lib/updates/release";

export type UpdateRequestStatus = "queued" | "installing" | "completed" | "failed";

export interface UpdateRequest {
  id: string;
  targetVersion: string;
  status: UpdateRequestStatus;
  requestedAt: string;
  updatedAt: string;
  requestedBy: string;
  message?: string;
}

const EMPTY_REQUEST: UpdateRequest | null = null;

export function isActiveUpdateRequest(request: UpdateRequest | null): boolean {
  return request?.status === "queued" || request?.status === "installing";
}

export async function getUpdateRequest(): Promise<UpdateRequest | null> {
  const request = await getSetting<UpdateRequest | null>(
    SETTING_KEYS.updateRequest,
    EMPTY_REQUEST,
  );
  if (!request) return null;

  // The agent's final callback can race the application restart. Seeing the
  // requested (or a newer) version is conclusive, so repair that state here.
  if (
    isActiveUpdateRequest(request) &&
    compareVersions(getCurrentVersion(), request.targetVersion) >= 0
  ) {
    return updateRequestStatus(request.id, "completed", "The new release is online.");
  }
  return request;
}

export async function createUpdateRequest(
  targetVersion: string,
  requestedBy: string,
): Promise<UpdateRequest> {
  const now = new Date().toISOString();
  const request: UpdateRequest = {
    id: randomUUID(),
    targetVersion,
    status: "queued",
    requestedAt: now,
    updatedAt: now,
    requestedBy,
    message: "Waiting for the host update service.",
  };
  await setSetting(SETTING_KEYS.updateRequest, request);
  return request;
}

export async function updateRequestStatus(
  requestId: string,
  status: Exclude<UpdateRequestStatus, "queued">,
  message?: string,
): Promise<UpdateRequest | null> {
  const request = await getSetting<UpdateRequest | null>(
    SETTING_KEYS.updateRequest,
    EMPTY_REQUEST,
  );
  if (!request || request.id !== requestId) return null;

  const updated: UpdateRequest = {
    ...request,
    status,
    updatedAt: new Date().toISOString(),
    ...(message ? { message } : {}),
  };
  await setSetting(SETTING_KEYS.updateRequest, updated);
  return updated;
}
