"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";

interface AuditRow {
  id: string;
  action: string;
  actorType: string;
  createdAt: string;
  user?: { username?: string | null; displayName?: string | null } | null;
  detail?: Record<string, unknown> | null;
}

function normalize(data: unknown): AuditRow[] {
  if (Array.isArray(data)) return data as AuditRow[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown[] }).items)) {
    return (data as { items: AuditRow[] }).items;
  }
  return [];
}

/**
 * Recent audit events for one entity. The /api/audit endpoint is owned by
 * another workstream — renders a graceful placeholder until it exists.
 */
export function AuditTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["audit", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      );
      if (!res.ok) throw new Error(`audit unavailable (${res.status})`);
      const json = (await res.json()) as { data?: unknown };
      return normalize(json.data);
    },
    retry: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="size-4 text-muted-foreground" />
          Audit trail
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Audit history isn’t available yet.</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded changes for this entity.</p>
        ) : (
          <ul className="space-y-3">
            {data.slice(0, 15).map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.action}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.user?.displayName || row.user?.username || row.actorType}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
