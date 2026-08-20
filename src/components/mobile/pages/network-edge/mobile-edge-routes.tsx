"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import {
  edgeRoutePath,
  edgeRouteRisk,
  edgeRouteRowBadge,
  edgeRouteRowState,
  edgeRoutesBaselineState,
  isUnrestrictedSource,
  sensitivePortService,
  type EdgeRoutePath,
  type EdgeRouteRowState,
} from "@/components/network/edge-sync-presentation";
import { MobileConnectorSetupDisclosure } from "./mobile-connector-instructions";
import { useConnectorsQuery } from "./mobile-connectors";

/**
 * The Routes tab — the actual content of this page.
 *
 * A row reads left to right as *what is published → how it gets there → where
 * it lands*, so the public port is the scannable key. Routing over a connector
 * and an unrestricted source are ordinary configuration and are styled as such;
 * the only amber on this list is a genuinely risky combination, and it says
 * which one.
 *
 * Which combinations those are, which ports count as administrative, and when a
 * row has earned a badge all come from `network/edge-sync-presentation`, shared
 * with the desktop table — a port that warns on one surface must warn on both.
 */

/** The shared row state as a sentence, for the detail sheet. */
const ROUTE_STATE_LABEL: Record<EdgeRouteRowState, string> = {
  live: "Live on the edge",
  staged: "Saved here, not pushed yet",
  disabled: "Disabled — saved but not installed",
  failed: "The last apply failed for this route",
};

/**
 * The trailing amber chip. It names the exposed service rather than repeating
 * "any source", but stays short enough not to crowd the rule name off the row —
 * the full sentence is one tap away in the detail sheet.
 */
function routeRiskChip(rule: EdgeNatRule): string | null {
  if (!edgeRouteRisk(rule)) return null;
  return `${sensitivePortService(rule.publicPort) ?? "Admin port"} exposed`;
}

/** How the traffic gets from the edge to the target: "via X → 10.0.0.5:32400". */
function routePathText(path: EdgeRoutePath, rule: EdgeNatRule): string {
  const target = `${rule.targetAddress}:${rule.targetPort}`;
  return path.kind === "connector" ? `${path.label} → ${target}` : `→ ${target}`;
}

/** The published listener, as the row's leading key. */
function RulePortChip({ rule }: { rule: EdgeNatRule }) {
  return (
    <span className="flex w-12 flex-col items-center rounded-md bg-muted px-1 py-1.5 font-mono leading-none">
      <span className="text-[13px] font-medium text-foreground">{rule.publicPort}</span>
      <span className="mt-0.5 text-[9px] tracking-wide uppercase">{rule.protocol}</span>
    </span>
  );
}

/** One published listener: port → path → target, plus its allowed source. */
function EdgeRuleRow({
  rule,
  baseline,
  lastAppliedAt,
  connectors,
  integrationId,
  onSelect,
}: {
  rule: EdgeNatRule;
  /** The state the rest of the list is in — a row badges only when it differs. */
  baseline: EdgeRouteRowState;
  lastAppliedAt: string | null | undefined;
  connectors: readonly ConnectorDto[];
  integrationId: string;
  onSelect: () => void;
}) {
  const badge = edgeRouteRowBadge(edgeRouteRowState(rule, lastAppliedAt), baseline);
  const risk = routeRiskChip(rule);
  return (
    <MobileListRow
      onClick={onSelect}
      leading={<RulePortChip rule={rule} />}
      title={
        <>
          <span className="truncate">{rule.name}</span>
          {badge && (
            <Badge variant={badge.variant} className="text-[10px] font-normal">
              {badge.label}
            </Badge>
          )}
        </>
      }
      subtitle={
        <span className="font-mono">{routePathText(edgeRoutePath(rule, connectors, integrationId), rule)}</span>
      }
      trailing={
        risk ? (
          <span className="flex items-center gap-1 text-warning">
            <TriangleAlert className="size-3.5" /> {risk}
          </span>
        ) : (
          <span className="max-w-24 truncate font-mono text-[11px]">
            {isUnrestrictedSource(rule) ? "any source" : rule.sourceCidr}
          </span>
        )
      }
    />
  );
}

function EdgeRuleDeleteDialog({
  server,
  rule,
  onOpenChange,
  onDeleted,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (ruleId: string) =>
      apiFetch(`/api/network/edge-networks/servers/${server.id}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("NAT rule removed. Apply changes to update the server.");
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onDeleted();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={rule !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {rule?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The rule will be removed from PolySIEM, then must be applied before the edge server&apos;s firewall
            changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (rule) mutation.mutate(rule.id);
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Remove rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Amber block used for the two things on a route that are genuinely risky. */
function RuleWarning({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block leading-snug">{detail}</span>
      </span>
    </div>
  );
}

function EdgeRuleFacts({
  server,
  rule,
  connectors,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule;
  connectors: readonly ConnectorDto[];
}) {
  // The shared path already resolves the connector, its tunnel address on THIS
  // edge (link data — the same connector answers elsewhere on another address),
  // and whether the last hop is a peer PolySIEM cannot program.
  const path = edgeRoutePath(rule, connectors, server.id);
  const viaConnector = path.kind === "connector";
  const risk = edgeRouteRisk(rule);
  // `path.note` is set only for that hand-configured peer; the steps behind it
  // need the connector itself, which the path does not hand back.
  const manualPeer = path.note
    ? connectors.find((entry) => entry.id === rule.connectorId || entry.connectorId === rule.connectorId) ?? null
    : null;
  return (
    <>
      <div className="divide-y divide-border/60 rounded-xl border bg-card">
        <MobileKeyRow label="Published on" mono>
          {rule.protocol} :{rule.publicPort}
        </MobileKeyRow>
        <MobileKeyRow label="Route">{path.label}</MobileKeyRow>
        {viaConnector && (
          <MobileKeyRow label="Tunnel hop here" mono>
            {path.address ? `${path.address}:${rule.publicPort}` : "Connector not linked to this edge"}
          </MobileKeyRow>
        )}
        <MobileKeyRow label={viaConnector ? "Internal target" : "Private target"} mono>
          {rule.targetAddress}:{rule.targetPort}
        </MobileKeyRow>
        <MobileKeyRow label="Allowed source" mono>
          {rule.sourceCidr || "Any source"}
        </MobileKeyRow>
        <MobileKeyRow label="State">
          {ROUTE_STATE_LABEL[edgeRouteRowState(rule, server.settings?.lastAppliedAt)]}
        </MobileKeyRow>
        {rule.error && <MobileKeyRow label="Last error">{rule.error}</MobileKeyRow>}
      </div>
      {risk && <RuleWarning title={risk.label} detail={risk.detail} />}
      {/* Finishing the path on a hand-configured peer is expected setup, not a
          fault, so it is neutral and collapsed — and the steps carry this rule's
          own protocol, ports and addresses. */}
      {manualPeer && (
        <MobileConnectorSetupDisclosure
          connector={manualPeer}
          rule={{
            protocol: rule.protocol,
            publicPort: rule.publicPort,
            targetAddress: rule.targetAddress,
            targetPort: rule.targetPort,
          }}
          integrationId={server.id}
        />
      )}
    </>
  );
}

/** Everything about one rule, including where its traffic actually ends up. */
function EdgeRuleDetailSheet({
  server,
  rule,
  connectors,
  isAdmin,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule | null;
  connectors: readonly ConnectorDto[];
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (rule: EdgeNatRule) => void;
  onDelete: (rule: EdgeNatRule) => void;
}) {
  return (
    <BottomSheet
      open={rule !== null}
      onOpenChange={onOpenChange}
      title={rule?.name ?? "NAT rule"}
      description={`Published on ${server.name}`}
    >
      {rule && (
        <div className="flex flex-col gap-3 pb-2">
          <EdgeRuleFacts server={server} rule={rule} connectors={connectors} />
          {isAdmin && server.enabled && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => onEdit(rule)}>
                <Pencil /> Edit rule
              </Button>
              <Button variant="destructive" onClick={() => onDelete(rule)}>
                <Trash2 /> Remove rule
              </Button>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

/** The Routes tab: what this edge publishes today. */
export function EdgeRoutesPanel({
  server,
  isAdmin,
  onEditRule,
}: {
  server: EdgeNatServer;
  isAdmin: boolean;
  onEditRule: (rule: EdgeNatRule) => void;
}) {
  const [selected, setSelected] = useState<EdgeNatRule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EdgeNatRule | null>(null);
  const lastAppliedAt = server.settings?.lastAppliedAt;
  // What most of this list is doing. A row matching it says nothing the card's
  // sync line has not already said, so the shared badge helper leaves it bare.
  const baseline = edgeRoutesBaselineState(server.rules, lastAppliedAt);
  // Shares the connectors block's query key, so this is a cache read, not a second fetch path.
  const connectors = useConnectorsQuery(server.id, { enabled: server.enabled }).data ?? [];

  return (
    <>
      {server.rules.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
          No ports are published. This server exposes no lab targets until a rule is added and applied.
        </p>
      ) : (
        <MobileList>
          {server.rules.map((rule) => (
            <EdgeRuleRow
              key={rule.id}
              rule={rule}
              baseline={baseline}
              lastAppliedAt={lastAppliedAt}
              connectors={connectors}
              integrationId={server.id}
              onSelect={() => setSelected(rule)}
            />
          ))}
        </MobileList>
      )}

      <EdgeRuleDetailSheet
        server={server}
        rule={selected}
        connectors={connectors}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={(rule) => {
          setSelected(null);
          onEditRule(rule);
        }}
        onDelete={(rule) => setConfirmDelete(rule)}
      />

      <EdgeRuleDeleteDialog
        server={server}
        rule={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        onDeleted={() => {
          setConfirmDelete(null);
          setSelected(null);
        }}
      />
    </>
  );
}
