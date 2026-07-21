"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cloud, Plus } from "lucide-react";
import type { BackupDestinationDto, BackupStateDto } from "@/lib/backup/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/components/shared/api-client";
import { BACKUP_KEY } from "./backup-shared";
import { BackupRestoreSection } from "./backup-restore-section";
import {
  DeleteDestinationDialog,
  DestinationCard,
  DestinationDialog,
} from "./backup-destinations";
import { HistorySection, ScheduleSection } from "./backup-schedule-history";

export function BackupManager({ initialState }: { initialState: BackupStateDto }) {
  const { data: state = initialState } = useQuery({
    queryKey: BACKUP_KEY,
    queryFn: () => apiFetch<BackupStateDto>("/api/admin/backup"),
    initialData: initialState,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BackupDestinationDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupDestinationDto | null>(null);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Backup & restore"
        description="Export a full portable backup, push it to cloud storage, and schedule automatic backups."
      />

      <BackupRestoreSection />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Cloud destinations</h2>
            <p className="text-sm text-muted-foreground">
              Where scheduled and manual backups are uploaded. Secrets are stored encrypted.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add destination
          </Button>
        </div>

        {state.destinations.length === 0 ? (
          <EmptyState
            icon={Cloud}
            title="No cloud destinations"
            description="Add an S3-compatible bucket or Azure Blob container to store backups off-box."
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> Add destination
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {state.destinations.map((d) => (
              <DestinationCard
                key={d.id}
                destination={d}
                onEdit={() => setEditTarget(d)}
                onDelete={() => setDeleteTarget(d)}
              />
            ))}
          </div>
        )}
      </section>

      <ScheduleSection config={state.config} destinations={state.destinations} />

      <HistorySection history={state.history} />

      <DestinationDialog open={addOpen} onOpenChange={setAddOpen} target={null} />
      <DestinationDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <DeleteDestinationDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
