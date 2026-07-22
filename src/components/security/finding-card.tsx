"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, EyeOff, Undo2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  SECURITY_CATEGORIES,
  type AffectedEntity,
  type SecurityFinding,
} from "@/lib/security/types";
import { FindingSeverityBadge } from "./severity-badge";

const CATEGORY_LABELS = new Map(SECURITY_CATEGORIES.map((c) => [c.id, c.label]));

const AFFECTED_PREVIEW = 8;

const AFFECTED_ROUTES: Partial<Record<AffectedEntity["kind"], string>> = {
  rule: "/firewall/rules",
  "port-forward": "/firewall",
  dyndns: "/firewall",
  integration: "/settings/integrations",
  user: "/settings/users",
  "api-token": "/settings/api-tokens",
  wireless: "/network/wifi",
};

const INVENTORY_ROUTES: Partial<Record<AffectedEntity["kind"], string>> = {
  device: "/inventory/hosts",
  vm: "/inventory/vms",
  container: "/inventory/containers",
  "ssh-key": "/keys",
};

/** Deep link for an affected entity, when PolySIEM has a page for it. */
export function affectedHref(entity: AffectedEntity): string | null {
  const inventoryRoute = INVENTORY_ROUTES[entity.kind];
  if (inventoryRoute) return entity.id ? `${inventoryRoute}/${entity.id}` : inventoryRoute;
  return AFFECTED_ROUTES[entity.kind] ?? null;
}

function AffectedChip({ entity }: { entity: AffectedEntity }) {
  const href = affectedHref(entity);
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "max-w-56 border-border bg-muted/50 font-normal text-muted-foreground",
        href && "transition-colors hover:border-primary/40 hover:text-foreground",
      )}
    >
      <span className="truncate">{entity.name}</span>
    </Badge>
  );
  return href ? <Link href={href}>{badge}</Link> : badge;
}

interface FindingCardProps {
  finding: SecurityFinding;
  isAdmin: boolean;
  dismissed?: boolean;
  pending?: boolean;
  onDismiss: (findingId: string) => void;
  onRestore: (findingId: string) => void;
}

const SEVERITY_EDGE: Record<SecurityFinding["severity"], string> = {
  critical: "border-l-destructive",
  high: "border-l-destructive/60",
  medium: "border-l-warning",
  low: "border-l-info",
  info: "border-l-border",
};

/** One misconfiguration finding: severity, explanation, remediation, affected entities. */
export function FindingCard({ finding, isAdmin, dismissed = false, pending = false, onDismiss, onRestore }: FindingCardProps) {
  const [showAllAffected, setShowAllAffected] = useState(false);
  const affected = showAllAffected ? finding.affected : finding.affected.slice(0, AFFECTED_PREVIEW);
  const hiddenCount = finding.affected.length - affected.length;

  return (
    <Card className={cn("border-l-4 py-4", SEVERITY_EDGE[finding.severity], dismissed && "opacity-60")}>
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <FindingSeverityBadge severity={finding.severity} />
              <span className="text-xs text-muted-foreground">
                {CATEGORY_LABELS.get(finding.category) ?? finding.category}
              </span>
            </div>
            <h3 className="text-sm font-medium leading-snug">{finding.title}</h3>
          </div>
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              disabled={pending}
              onClick={() => (dismissed ? onRestore(finding.id) : onDismiss(finding.id))}
            >
              {dismissed ? (
                <>
                  <Undo2 className="size-4" /> Restore
                </>
              ) : (
                <>
                  <EyeOff className="size-4" /> Dismiss
                </>
              )}
            </Button>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{finding.detail}</p>

        <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">How to fix: </span>
            {finding.remediation}
          </p>
        </div>

        {finding.affected.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {affected.map((entity, i) => (
              <AffectedChip key={`${entity.kind}:${entity.id ?? entity.name}:${i}`} entity={entity} />
            ))}
            {hiddenCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => setShowAllAffected(true)}
              >
                +{hiddenCount} more <ChevronDown className="size-3" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
