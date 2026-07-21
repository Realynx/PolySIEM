"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import type { BackupConfigDto, BackupDestinationDto, BackupRunDto } from "@/lib/backup/types";
import { EmptyState } from "@/components/shared/empty-state";
import { ListCard } from "@/components/inventory/list-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/components/shared/api-client";
import { BACKUP_KEY } from "./backup-shared";

/* ---------- section 3: schedule ---------- */

export function ScheduleSection({
  config,
  destinations,
}: {
  config: BackupConfigDto;
  destinations: BackupDestinationDto[];
}) {
  const queryClient = useQueryClient();
  const [schedule, setSchedule] = useState(config.schedule);
  const [destinationId, setDestinationId] = useState(config.destinationId);
  const [retention, setRetention] = useState(String(config.retention));

  // Re-seed from server whenever the query refreshes the config.
  useEffect(() => {
    setSchedule(config.schedule);
    setDestinationId(config.destinationId);
    setRetention(String(config.retention));
  }, [config.schedule, config.destinationId, config.retention]);

  const save = useMutation({
    mutationFn: () => {
      const parsed = Number.parseInt(retention, 10);
      return apiFetch<BackupConfigDto>("/api/admin/backup/config", {
        method: "PUT",
        body: JSON.stringify({
          schedule,
          destinationId,
          retention: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Schedule saved");
      queryClient.invalidateQueries({ queryKey: BACKUP_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const noDestinations = destinations.length === 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Automatic backups</h2>
        <p className="text-sm text-muted-foreground">
          Run a backup on a schedule and push it to a destination. The scheduler checks roughly every five
          minutes.
        </p>
      </div>
      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="sched-freq">Frequency</Label>
              <Select value={schedule} onValueChange={(v) => setSchedule(v as BackupConfigDto["schedule"])}>
                <SelectTrigger id="sched-freq">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sched-dest">Destination</Label>
              <Select
                value={destinationId || "none"}
                onValueChange={(v) => setDestinationId(v === "none" ? "" : v)}
                disabled={noDestinations}
              >
                <SelectTrigger id="sched-dest">
                  <SelectValue placeholder="Select a destination" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (download only)</SelectItem>
                  {destinations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sched-retention">Keep last (0 = all)</Label>
              <Input
                id="sched-retention"
                type="number"
                min={0}
                max={365}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
            </div>
          </div>
          {schedule !== "off" && !destinationId && (
            <p className="text-sm text-warning">
              Pick a destination — a schedule with no destination never uploads anything.
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save schedule"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ---------- section 4: history ---------- */

export function HistorySection({ history }: { history: BackupRunDto[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Recent backups</h2>
        <p className="text-sm text-muted-foreground">The last {history.length || "few"} backup runs.</p>
      </div>
      {history.length === 0 ? (
        <EmptyState
          icon={CloudUpload}
          title="No backups yet"
          description="Manual and scheduled backup runs will appear here."
        />
      ) : (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-muted-foreground" title={formatDateTime(run.at)}>
                    {formatRelative(run.at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {run.trigger}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{run.destinationName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {run.ok ? formatBytes(run.sizeBytes) : "—"}
                  </TableCell>
                  <TableCell>
                    {run.ok ? (
                      <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                        OK
                      </Badge>
                    ) : (
                      <span
                        className="inline-flex max-w-xs items-center gap-1 truncate text-destructive"
                        title={run.error ?? "Failed"}
                      >
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span className="truncate">{run.error ?? "Failed"}</span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </section>
  );
}
