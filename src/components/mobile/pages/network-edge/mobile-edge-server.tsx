"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, MoreHorizontal, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  edgeInterfaceOptions,
  edgeServerState,
  edgeWireguardStatus,
  sshEndpoint,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import { edgeSyncSummary, type EdgeSyncSummary } from "@/components/network/edge-sync-presentation";
import { MobileConnectorsBlock, connectorsTabBadge, useConnectorsQuery } from "./mobile-connectors";
import { EdgeInterfacesPanel } from "./mobile-edge-interfaces";
import { EdgeRoutesPanel } from "./mobile-edge-routes";
import {
  EdgeCleanupAction,
  EdgeDetailsSheet,
  EdgeMoreSheet,
  EdgeSyncRow,
  edgeNeedsCleanup,
  edgeSyncAlert,
} from "./mobile-edge-sync";
import {
  MobileStateSegmented,
  MobileTabPanel,
  EDGE_SERVER_TABS,
  type EdgeServerTab,
  type MobileSegmentedTab,
} from "./mobile-edge-tabs";
import { MobileNatRuleSheet } from "./mobile-nat-rule-sheet";
import { MobileWireguardBlock } from "./mobile-wireguard";

function ServerStateBadge({ state }: { state: ReturnType<typeof edgeServerState> }) {
  const label = { online: "Online", offline: "Offline", unverified: "Unverified", disabled: "Disabled" }[state];
  return (
    <Badge
      variant={state === "online" ? "secondary" : state === "offline" ? "destructive" : "outline"}
      className="text-[10px] font-normal"
    >
      {state === "online" && <span className="size-1.5 rounded-full bg-success" />}
      {label}
    </Badge>
  );
}

/**
 * Only the states that need a decision. A disabled edge whose rules were
 * cleared, or an edge with nothing pushed yet, is described by the sync line
 * above — a banner that is always on is not a banner.
 */
function EdgeServerAlerts({
  server,
  summary,
  isAdmin,
}: {
  server: EdgeNatServer;
  summary: EdgeSyncSummary;
  isAdmin: boolean;
}) {
  const failure = server.settings?.lastApplyError ?? server.lastSyncError;
  const alert = edgeSyncAlert(summary);
  return (
    <>
      {failure && (
        <p className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {failure}
        </p>
      )}
      {alert && (
        <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {alert}
        </p>
      )}
      {isAdmin && server.enabled && !server.hostKeyEnrolled && (
        <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          SSH enrollment is not finished. Complete the guided setup from the desktop view before applying rules.
        </p>
      )}
    </>
  );
}

/**
 * One primary action, one secondary, and an overflow for the rest. Apply only
 * takes primary styling while it has something to push.
 */
function EdgeApplyActions({
  server,
  summary,
  onAddRule,
  onMore,
}: {
  server: EdgeNatServer;
  summary: EdgeSyncSummary;
  onAddRule: () => void;
  onMore: () => void;
}) {
  const queryClient = useQueryClient();
  const applyMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/apply`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`Applied NAT rules on ${server.name}`);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Could not apply rules: ${error.message}`),
  });

  return (
    <div className="flex items-stretch gap-2">
      <Button
        size="sm"
        className="flex-1"
        variant={summary.actionUrgent ? "default" : "outline"}
        disabled={!server.hostKeyEnrolled || applyMutation.isPending}
        onClick={() => applyMutation.mutate()}
      >
        {applyMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
        {summary.actionLabel ?? "Apply rules"}
      </Button>
      <Button variant="outline" size="sm" onClick={onAddRule}>
        <Plus /> Add rule
      </Button>
      <Button variant="outline" size="sm" aria-label={`More actions for ${server.name}`} onClick={onMore}>
        <MoreHorizontal />
      </Button>
    </div>
  );
}

/**
 * Tier 1 — the part that never changes as the tabs switch: which edge this is,
 * whether PolySIEM can reach it, whether what is configured is actually live,
 * and the single action that changes that.
 */
function EdgeServerOverview({
  server,
  summary,
  isAdmin,
  onAddRule,
}: {
  server: EdgeNatServer;
  summary: EdgeSyncSummary;
  isAdmin: boolean;
  onAddRule: () => void;
}) {
  const [sheet, setSheet] = useState<"none" | "more" | "details">("none");
  return (
    <>
      <MobileList>
        <MobileListRow
          title={
            <>
              <span className="truncate">{server.name}</span>
              <ServerStateBadge state={edgeServerState(server)} />
            </>
          }
          subtitle={<span className="font-mono">ssh://{sshEndpoint(server.baseUrl)}</span>}
          trailing={
            <span className="text-[11px]">
              {server.lastSyncAt ? `checked ${formatRelative(server.lastSyncAt)}` : "never checked"}
            </span>
          }
        />
        <EdgeSyncRow summary={summary} onOpenDetails={() => setSheet("details")} />
      </MobileList>

      <EdgeServerAlerts server={server} summary={summary} isAdmin={isAdmin} />

      {isAdmin && server.enabled && (
        <EdgeApplyActions server={server} summary={summary} onAddRule={onAddRule} onMore={() => setSheet("more")} />
      )}
      {isAdmin && edgeNeedsCleanup(summary) && <EdgeCleanupAction server={server} />}

      {sheet === "more" && (
        <EdgeMoreSheet
          server={server}
          onOpenChange={(open) => !open && setSheet("none")}
          onOpenDetails={() => setSheet("details")}
        />
      )}
      {sheet === "details" && (
        <EdgeDetailsSheet
          server={server}
          summary={summary}
          onOpenChange={(open) => !open && setSheet("none")}
        />
      )}
    </>
  );
}

/** Rule count for the Routes segment: "none", "1 route", "6 routes". */
function routesBadge(count: number): string {
  if (count === 0) return "none";
  return count === 1 ? "1 route" : `${count} routes`;
}

/** On / Incomplete / Off, from the same helper the tunnel block's badge uses. */
function tunnelBadge(server: EdgeNatServer): { badge: string; tone: "muted" | "success" | "warning" } {
  const status = edgeWireguardStatus(server.settings?.wireguard);
  if (status.tone === "on") return { badge: "On", tone: "success" };
  return status.tone === "pending" ? { badge: "Incomplete", tone: "warning" } : { badge: "Off", tone: "muted" };
}

/**
 * The four tabs with their compact badges — the same information the desktop
 * card's tab strip carries, sized for a 412px phone.
 */
function edgeServerTabs(
  server: EdgeNatServer,
  connectors: readonly ConnectorDto[],
): MobileSegmentedTab<EdgeServerTab>[] {
  const connectorSummary = connectorsTabBadge(connectors);
  const tunnel = tunnelBadge(server);
  const detected = edgeInterfaceOptions(server).length;
  return [
    { key: "routes", label: "Routes", badge: routesBadge(server.rules.length) },
    {
      key: "connectors",
      label: "Connectors",
      badge: connectorSummary.badge,
      tone: connectorSummary.ready ? "success" : "muted",
    },
    { key: "tunnel", label: "Tunnel", badge: tunnel.badge, tone: tunnel.tone },
    { key: "interfaces", label: "Interfaces", badge: detected > 0 ? `${detected} found` : "not synced" },
  ];
}

/** Renders exactly the selected tab — a phone never scrolls through all four. */
function EdgeServerTabContent({
  tab,
  server,
  servers,
  isAdmin,
  onEditRule,
}: {
  tab: EdgeServerTab;
  server: EdgeNatServer;
  servers?: readonly EdgeNatServer[];
  isAdmin: boolean;
  onEditRule: (rule: EdgeNatRule) => void;
}) {
  if (tab === "routes") return <EdgeRoutesPanel server={server} isAdmin={isAdmin} onEditRule={onEditRule} />;
  if (tab === "connectors") return <MobileConnectorsBlock server={server} servers={servers} isAdmin={isAdmin} />;
  if (tab === "tunnel") return <MobileWireguardBlock server={server} isAdmin={isAdmin} />;
  return <EdgeInterfacesPanel server={server} isAdmin={isAdmin} />;
}

/**
 * One edge server on a phone. Identity, the sync line and the primary action
 * stay pinned; Routes / Connectors / Tunnel / Interfaces switch below them in
 * the same order as the desktop card, and only the selected one renders.
 */
export function MobileEdgeServerSection({
  server,
  servers,
  isAdmin,
}: {
  server: EdgeNatServer;
  /** Every edge box, so a connector here can be linked onward to another one. */
  servers?: readonly EdgeNatServer[];
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<EdgeServerTab>(EDGE_SERVER_TABS[0]);
  const [ruleForm, setRuleForm] = useState<{ open: boolean; rule: EdgeNatRule | null }>({ open: false, rule: null });
  const summary = edgeSyncSummary(server);
  // One shared connectors query (same key as the connectors tab) feeds the badge
  // even while another tab is showing.
  const connectors = useConnectorsQuery(server.id, { enabled: server.enabled }).data ?? [];
  const openRuleForm = (rule: EdgeNatRule | null) => {
    setTab("routes");
    setRuleForm({ open: true, rule });
  };

  return (
    <MobileSection title={server.name}>
      <EdgeServerOverview server={server} summary={summary} isAdmin={isAdmin} onAddRule={() => openRuleForm(null)} />

      <MobileStateSegmented
        idBase={`edge-${server.id}`}
        ariaLabel={`${server.name} sections`}
        tabs={edgeServerTabs(server, connectors)}
        value={tab}
        onChange={setTab}
        className="mt-0.5"
      />
      <MobileTabPanel idBase={`edge-${server.id}`} tab={tab}>
        <EdgeServerTabContent
          tab={tab}
          server={server}
          servers={servers}
          isAdmin={isAdmin}
          onEditRule={openRuleForm}
        />
      </MobileTabPanel>

      {ruleForm.open && (
        <MobileNatRuleSheet
          server={server}
          rule={ruleForm.rule}
          onOpenChange={(open) => setRuleForm((current) => ({ ...current, open }))}
        />
      )}
    </MobileSection>
  );
}
