import "server-only";
import type { AiScanRun } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import {
  getAiScanConfig,
  setSetting,
  SETTING_KEYS,
  type AiScanConfig,
} from "@/lib/settings";
import { runScan } from "@/lib/ai/scan/engine";
import type { AiScanConfigInput } from "@/lib/validators/scan";
import type { AiScanRunDto, AiScanRunStats } from "@/lib/types";

const STALE_RUNNING_MINUTES = 15;

export function toScanRunDto(run: AiScanRun): AiScanRunDto {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    model: run.model,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    timeRangeFrom: run.timeRangeFrom.toISOString(),
    timeRangeTo: run.timeRangeTo.toISOString(),
    stats: (run.stats as AiScanRunStats | null) ?? null,
    error: run.error,
  };
}

export async function getScanConfig(): Promise<AiScanConfig> {
  return getAiScanConfig();
}

export async function updateScanConfig(
  actor: AuditActor,
  input: AiScanConfigInput,
): Promise<AiScanConfig> {
  await setSetting(SETTING_KEYS.aiScanConfig, input);
  await audit(actor, "scan.config.update", undefined, {
    enabled: input.enabled,
    model: input.model,
  });
  return getAiScanConfig();
}

export async function listScanRuns(limit: number): Promise<AiScanRunDto[]> {
  const runs = await prisma.aiScanRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return runs.map(toScanRunDto);
}

/**
 * Kick a manual scan. Refuses (409) while another run is genuinely in flight;
 * RUNNING rows older than 15 minutes are from a dead process and get failed.
 */
export async function triggerScan(actor: AuditActor): Promise<AiScanRunDto> {
  await prisma.aiScanRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000) },
    },
    data: {
      status: "FAILED",
      error: "stale — process exited mid-run",
      finishedAt: new Date(),
    },
  });
  const running = await prisma.aiScanRun.findFirst({
    where: { status: "RUNNING" },
  });
  if (running)
    throw new ApiError(
      409,
      "scan_running",
      "A scan is already running — wait for it to finish.",
    );

  await audit(actor, "scan.run", undefined, { trigger: "manual" });
  const run = await runScan("manual");
  return toScanRunDto(run);
}
