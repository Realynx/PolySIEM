import type { NextRequest } from "next/server";
import { getAutoUpdateConfig, isUpdateAgentAuthorized } from "@/lib/updates/auto-update";
import { checkForUpdate } from "@/lib/updates/release";
import {
  getUpdateRequest,
  isActiveUpdateRequest,
  updateRequestStatus,
  type UpdateRequestStatus,
} from "@/lib/updates/request";

export const dynamic = "force-dynamic";

/** Machine-readable endpoint consumed only by the host-side update timer. */
export async function GET(req: NextRequest): Promise<Response> {
  if (!isUpdateAgentAuthorized(req.headers.get("authorization"))) {
    return new Response("unauthorized\n", {
      status: 401,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
    });
  }

  const config = await getAutoUpdateConfig();
  const request = await getUpdateRequest();
  const lines = [
    `enabled=${config.enabled}`,
    `capable=${config.capable}`,
    `manualRequested=${isActiveUpdateRequest(request)}`,
  ];
  if (request && isActiveUpdateRequest(request)) {
    lines.push(`requestId=${request.id}`, `latestVersion=${request.targetVersion}`);
  } else if (
    config.enabled &&
    config.capable &&
    req.nextUrl.searchParams.get("check") === "true"
  ) {
    const update = await checkForUpdate();
    lines.push(
      `updateAvailable=${update.updateAvailable}`,
      `currentVersion=${update.currentVersion}`,
      `latestVersion=${update.latestVersion}`,
    );
  }

  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
  });
}

const AGENT_STATUSES = new Set<UpdateRequestStatus>([
  "installing",
  "completed",
  "failed",
]);

/** Status callback from the root-owned agent before and after app replacement. */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isUpdateAgentAuthorized(req.headers.get("authorization"))) {
    return new Response("unauthorized\n", { status: 401 });
  }

  const body = new URLSearchParams(await req.text());
  const requestId = body.get("requestId") ?? "";
  const status = body.get("status") as UpdateRequestStatus | null;
  if (!requestId || !status || !AGENT_STATUSES.has(status)) {
    return new Response("invalid status update\n", { status: 400 });
  }

  const updated = await updateRequestStatus(
    requestId,
    status as Exclude<UpdateRequestStatus, "queued">,
    body.get("message")?.slice(0, 240) || undefined,
  );
  return new Response(updated ? "ok\n" : "stale request\n", {
    status: updated ? 200 : 409,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
  });
}
