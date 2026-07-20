"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Terminal } from "lucide-react";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkflowRunLogDto, WorkflowRunStatus } from "@/lib/workflows/types";

interface LogsResponse {
  lines: WorkflowRunLogDto[];
  nextSeq: number;
  done: boolean;
}

const LEVEL_CLASS: Record<WorkflowRunLogDto["level"], string> = {
  DEBUG: "text-muted-foreground",
  INFO: "text-foreground",
  WARN: "text-warning",
  ERROR: "text-destructive",
};

/** HH:MM:SS in local time — the gutter timestamp, like a CI console. */
function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "--:--:--"
    : date.toLocaleTimeString(undefined, { hour12: false });
}

/**
 * Live console for a workflow run. While the run is going it polls for lines
 * after the highest sequence it already holds, so each request carries only
 * what is new; once the run finishes it settles into a static transcript of the
 * historic run.
 *
 * Auto-scroll follows the tail until the reader scrolls up, which pauses it —
 * the usual CI-console behaviour, so inspecting an earlier failure is not
 * yanked away by later output.
 */
export function RunConsole({
  runId,
  status,
}: {
  runId: string;
  status: WorkflowRunStatus;
}) {
  const [lines, setLines] = useState<WorkflowRunLogDto[]>([]);
  const [cursor, setCursor] = useState(0);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // A finished run still polls once (cursor 0) to load its transcript; it stops
  // as soon as the API reports nothing further is coming.
  const [settled, setSettled] = useState(false);
  const live = status === "RUNNING" || !settled;

  const query = useQuery({
    queryKey: ["workflow-run-logs", runId, cursor],
    queryFn: () => apiFetch<LogsResponse>(`/api/workflows/runs/${runId}/logs?after=${cursor}`),
    enabled: live,
    refetchInterval: status === "RUNNING" ? 1000 : false,
  });

  // Append whatever the latest response brought and advance the cursor.
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    if (data.lines.length > 0) {
      setLines((prev) => {
        const seen = new Set(prev.map((l) => l.seq));
        const fresh = data.lines.filter((l) => !seen.has(l.seq));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      setCursor((prev) => (data.nextSeq > prev ? data.nextSeq : prev));
    }
    if (data.done && status !== "RUNNING") setSettled(true);
  }, [query.data, status]);

  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Within a line or so of the bottom counts as "following".
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  return (
    <section className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="size-4 text-muted-foreground" />
          Console
          {status === "RUNNING" && (
            <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
              <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-info" />
              live
            </Badge>
          )}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {lines.length} line{lines.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-96 overflow-y-auto bg-background/60 p-3 font-mono text-xs leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="text-muted-foreground">
              {query.isPending ? "Loading console output…" : "No console output for this run."}
            </p>
          ) : (
            lines.map((line) => (
              <div key={line.seq} className="flex gap-2 whitespace-pre-wrap break-words">
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {clock(line.createdAt)}
                </span>
                <span className={cn("min-w-0", LEVEL_CLASS[line.level])}>{line.message}</span>
              </div>
            ))
          )}
        </div>

        {!follow && (
          <Button
            size="sm"
            variant="outline"
            className="absolute bottom-3 right-3 shadow-sm"
            onClick={() => {
              setFollow(true);
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <ChevronDown className="size-3.5" />
            Follow
          </Button>
        )}
      </div>
    </section>
  );
}
