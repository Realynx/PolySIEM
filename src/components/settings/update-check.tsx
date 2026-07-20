"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UpdateCheckResult } from "@/lib/updates/release";

interface ApiResponse {
  data?: UpdateCheckResult;
  error?: { message?: string };
}

export function UpdateCheck({
  updateCommand,
  automaticRollback,
}: {
  updateCommand: string;
  automaticRollback: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  async function check() {
    setChecking(true);
    try {
      const response = await fetch("/api/admin/updates", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message ?? `Update check failed (HTTP ${response.status})`);
      }
      setResult(body.data);
      if (body.data.updateAvailable) toast.info(`PolySIEM ${body.data.latestVersion} is available`);
      else if (body.data.comparison === "ahead") toast.info("This build is newer than the latest release");
      else toast.success("PolySIEM is up to date");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not check for updates");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking}>
          <RefreshCw className={cn("size-4", checking && "animate-spin")} />
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        {result?.updateAvailable && (
          <Badge className="border-warning/40 bg-warning/10 text-warning" variant="outline">
            Update available: v{result.latestVersion}
          </Badge>
        )}
        {result && !result.updateAvailable && (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" />
            {result.comparison === "ahead" ? "Running a newer development build" : "Up to date"}
          </span>
        )}
      </div>

      {result?.updateAvailable && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <p className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              {automaticRollback
                ? "Run the host updater. It creates a PostgreSQL and configuration backup before migrations, verifies health, and rolls back automatically if startup fails."
                : "Run the host installer again to update. Review the backup guidance in the release notes first; this installation type is not managed by the Docker rollback updater."}
            </span>
          </p>
          <code className="block overflow-x-auto rounded bg-muted px-2.5 py-2 text-xs">
            {updateCommand}
          </code>
          <a
            href={result.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            Read {result.releaseName} release notes
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
