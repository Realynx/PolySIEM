import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";
import { runSecurityChecks } from "@/lib/security/checks";
import { collectSecuritySnapshot } from "@/lib/security/collect";
import { computeScore } from "@/lib/security/score";
import type { SecurityReport } from "@/lib/security/types";

export const dynamic = "force-dynamic";

/** Dismissed finding ids live in AppSetting "security_dismissed" (string[]). */
async function getDismissedIds(): Promise<string[]> {
  const raw = await getSetting<unknown>(SETTING_KEYS.securityDismissed, []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

async function buildReport(): Promise<SecurityReport> {
  const snapshot = await collectSecuritySnapshot();
  const all = runSecurityChecks(snapshot);
  const dismissedSet = new Set(await getDismissedIds());
  const findings = all.filter((f) => !dismissedSet.has(f.id));
  const dismissed = all.filter((f) => dismissedSet.has(f.id));
  const { score, deducted, ceiling, categories, bySeverity } = computeScore(findings);
  return {
    score,
    deducted,
    ceiling,
    categories,
    bySeverity,
    findings,
    dismissed,
    generatedAt: snapshot.now,
  };
}

/**
 * GET /api/security — the security advisor report: 0-100 score, per-category
 * subscores, and concrete findings computed live from the synced inventory.
 * Dismissed findings are excluded from the score but returned separately.
 */
export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(await buildReport());
});

const postSchema = z.object({
  action: z.enum(["dismiss", "undismiss"]),
  findingId: z.string().min(1).max(200),
});

/**
 * POST /api/security { action: "dismiss"|"undismiss", findingId } — admin
 * only. Persists the dismissal set in AppSetting and returns a fresh report.
 */
export const POST = handleApi(async (req: NextRequest) => {
  await requireAdmin();
  const { action, findingId } = postSchema.parse(await req.json());
  const current = await getDismissedIds();
  const next =
    action === "dismiss"
      ? [...new Set([...current, findingId])]
      : current.filter((id) => id !== findingId);
  await setSetting(SETTING_KEYS.securityDismissed, next);
  return jsonOk(await buildReport());
});
