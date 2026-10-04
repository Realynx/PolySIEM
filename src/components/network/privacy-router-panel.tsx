"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartColumn, ListOrdered, Plus, RefreshCw, Split, Waypoints, Wrench } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { edgeCardsStartExpanded } from "./cloudflare-presentation";
import { VPN_STATUS_READ_FAILED_NOTE } from "./privacy-router-presentation";
import { PrivacyRouterAddDialog } from "./privacy-router-add-dialog";
import { PrivacyRouterCard } from "./privacy-router-card";
import { PrivacyRouterDialog } from "./privacy-router-dialogs";
import { PrivacyRouterIntroBlock } from "./privacy-router-intro";
import { PrivacyRouterExitsTab } from "./privacy-router-exits-tab";
import { PrivacyRouterRulesTab } from "./privacy-router-rules-tab";
import { PrivacyRouterSetupTab } from "./privacy-router-setup-tab";
import { PrivacyRouterTrafficTab } from "./privacy-router-traffic-tab";
import {
  vpnExitsQueryKey,
  vpnExitsUrl,
  privacyRouterApplyUrl,
  privacyRouterStatusQueryKey,
  privacyRouterStatusUrl,
  privacyRulesQueryKey,
  privacyRulesUrl,
  privacyRoutersQueryKey,
  privacyRoutersUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type VpnExitDto,
  type PrivacyRouterApplyResult,
  type PrivacyRouterDto,
  type PrivacyRouterStatusReport,
  type PrivacyRoutingRuleDto,
} from "./privacy-router-types";

type PrivacyRouterTab = "traffic" | "rules" | "exits" | "setup";

/**
 * The desktop privacy router page.
 *
 * The framing is the user's own: it looks like a firewall. One ordered rule list
 * decides, per flow, whether traffic leaves through the WAN or through one of
 * the box's WireGuard exits — and the four tabs answer, in order, what happened
 * (Traffic), what the policy is (Rules), what it can route through (Exits), and
 * how the box came to exist at all (Setup).
 *
 * Everything derived — tier badges, throttle labels, exit health, the two setup
 * walkthroughs — comes from `privacy-router-presentation.ts`, which mobile imports
 * too. Nothing in this file writes copy of its own about those.
 */
export function PrivacyRouterPanel({ isAdmin }: { isAdmin: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<PrivacyRouterTab>("traffic");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const routersQuery = useQuery({
    queryKey: privacyRoutersQueryKey(),
    queryFn: () => apiFetch<PrivacyRouterDto[]>(privacyRoutersUrl()),
    refetchInterval: 60_000,
  });
  const routers = routersQuery.data ?? [];
  const router = routers.find((one) => one.id === selectedId) ?? routers[0] ?? null;

  return (
    <div>
      <PageHeader
        title="Privacy router"
        description="A managed LAN box that decides, per flow, whether traffic leaves through the WAN or through one of its WireGuard exits."
        actions={
          <PrivacyRouterHeaderActions
            routers={routers}
            selected={router}
            isAdmin={isAdmin}
            fetching={routersQuery.isFetching}
            onSelect={setSelectedId}
            onRefresh={() => void routersQuery.refetch()}
            onAdd={() => setAddOpen(true)}
          />
        }
      />

      {routersQuery.isLoading && <PrivacyRouterSkeleton />}

      {routersQuery.isError && (
        <EmptyState
          icon={Split}
          title="Could not load privacy routers"
          description={(routersQuery.error as Error | null)?.message ?? "The privacy router inventory is unavailable."}
          action={<Button onClick={() => void routersQuery.refetch()}>Try again</Button>}
        />
      )}

      {routersQuery.isSuccess && !router && <PrivacyRouterEmptyState isAdmin={isAdmin} onAdd={() => setAddOpen(true)} />}

      {router && (
        <PrivacyRouterWorkspace
          router={router}
          routerCount={routers.length}
          isAdmin={isAdmin}
          tab={tab}
          onTabChange={setTab}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
        />
      )}

      <PrivacyRouterAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(created) => { setSelectedId(created.id); setTab("setup"); }}
      />
    </div>
  );
}

/**
 * The empty state answers "what is this", not "here is a button".
 *
 * The review that produced this redesign ended with "I'm not even really sure
 * what the privacy router is as a user just clicking this at this point" — and
 * the screen an operator lands on with no routers is the one place in the
 * product where they are certainly asking. It has the room, so it answers in
 * full rather than behind a disclosure.
 */
function PrivacyRouterEmptyState({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <div className="space-y-4">
      <PrivacyRouterIntroBlock />
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onAdd}><Plus className="size-4" /> Add a privacy router</Button>
          <p className="text-xs text-muted-foreground">Four steps. PolySIEM asks for three things and finds the rest.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ask an administrator to add one.</p>
      )}
    </div>
  );
}

/** The router picker appears only when there is more than one box to pick from. */
function PrivacyRouterHeaderActions({
  routers,
  selected,
  isAdmin,
  fetching,
  onSelect,
  onRefresh,
  onAdd,
}: {
  routers: PrivacyRouterDto[];
  selected: PrivacyRouterDto | null;
  isAdmin: boolean;
  fetching: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onAdd: () => void;
}) {
  return (
    <>
      {routers.length > 1 && selected && (
        <Select value={selected.id} onValueChange={onSelect}>
          <SelectTrigger size="sm" className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {routers.map((one) => <SelectItem key={one.id} value={one.id}>{one.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Button variant="outline" size="sm" disabled={fetching} onClick={onRefresh}>
        <RefreshCw className={cn("size-4", fetching && "animate-spin")} aria-hidden="true" /> Refresh
      </Button>
      {isAdmin && routers.length > 0 && (
        <Button size="sm" onClick={onAdd}><Plus className="size-4" /> Add router</Button>
      )}
    </>
  );
}

/** One router's card and its four surfaces, with the queries they all read. */
function PrivacyRouterWorkspace({
  router,
  routerCount,
  isAdmin,
  tab,
  onTabChange,
  settingsOpen,
  onSettingsOpenChange,
}: {
  router: PrivacyRouterDto;
  routerCount: number;
  isAdmin: boolean;
  tab: PrivacyRouterTab;
  onTabChange: (tab: PrivacyRouterTab) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const exitsQuery = useQuery({
    queryKey: vpnExitsQueryKey(router.id),
    queryFn: () => apiFetch<VpnExitDto[]>(vpnExitsUrl(router.id)),
  });
  const rulesQuery = useQuery({
    queryKey: privacyRulesQueryKey(router.id),
    queryFn: () => apiFetch<PrivacyRoutingRuleDto[]>(privacyRulesUrl(router.id)),
  });
  // Every read opens a real SSH session to the box, so it is manual and never
  // polled. The traffic pipeline has its own background poller.
  const statusQuery = useQuery({
    queryKey: privacyRouterStatusQueryKey(router.id),
    queryFn: () => apiFetch<PrivacyRouterStatusReport>(privacyRouterStatusUrl(router.id)),
    enabled: false,
    retry: false,
  });
  const applyMutation = useMutation({
    mutationFn: () => apiFetch<PrivacyRouterApplyResult>(privacyRouterApplyUrl(router.id), { method: "POST" }),
    onSuccess: (result) => {
      toast.success(`Applied revision ${result.revision} · ${result.ruleCount} rules on ${router.name}.`);
      if (result.exitsConcurrent === false) {
        toast.warning("The router could not use several exits at once — per-rule exit selection holds only on inspected traffic.");
      }
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
      void statusQuery.refetch();
    },
    onError: (error: Error) => toast.error(`Could not apply the configuration: ${error.message}`),
  });

  const exits = exitsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const report = statusQuery.data;

  return (
    <div className="space-y-5">
      <PrivacyRouterCard
        router={router}
        rules={rules}
        report={report}
        isAdmin={isAdmin}
        applying={applyMutation.isPending}
        reading={statusQuery.isFetching}
        defaultExpanded={edgeCardsStartExpanded(routerCount)}
        onApply={() => applyMutation.mutate()}
        onRead={() => void statusQuery.refetch()}
        onOpenSettings={() => onSettingsOpenChange(true)}
        onOpenSetup={() => onTabChange("setup")}
      />

      {statusQuery.isError && (
        <VpnStatusError message={(statusQuery.error as Error).message} onRetry={() => void statusQuery.refetch()} />
      )}

      <Tabs value={tab} onValueChange={(next) => onTabChange(next as PrivacyRouterTab)} className="gap-5">
        <div className="overflow-x-auto pb-1">
          <TabsList className="grid h-10 w-full min-w-[25rem] grid-cols-4 sm:inline-grid sm:w-auto">
            <PrivacyRouterTabTrigger value="traffic" label="Traffic" mobileLabel="Traffic" icon={ChartColumn} count={null} ariaLabel="Traffic, per service" />
            <PrivacyRouterTabTrigger value="rules" label="Rules" mobileLabel="Rules" icon={ListOrdered} count={rules.length} ariaLabel={`Rules, ${rules.length} configured`} />
            <PrivacyRouterTabTrigger value="exits" label="Exits" mobileLabel="Exits" icon={Waypoints} count={exits.length} ariaLabel={`Exits, ${exits.length} configured`} />
            <PrivacyRouterTabTrigger value="setup" label="Setup" mobileLabel="Setup" icon={Wrench} count={null} ariaLabel="Setup and enrollment" />
          </TabsList>
        </div>

        <TabsContent value="traffic">
          <PrivacyRouterTrafficTab routerId={router.id} />
        </TabsContent>

        <TabsContent value="rules">
          {rulesQuery.isError
            ? <VpnListError subject="rules" message={(rulesQuery.error as Error).message} onRetry={() => void rulesQuery.refetch()} />
            : (
              <PrivacyRouterRulesTab
                router={router}
                rules={rules}
                exits={exits}
                ruleCounters={report?.status.ruleCounters ?? []}
                hasStatus={report !== undefined}
                isAdmin={isAdmin}
              />
            )}
        </TabsContent>

        <TabsContent value="exits">
          {exitsQuery.isError
            ? <VpnListError subject="exits" message={(exitsQuery.error as Error).message} onRetry={() => void exitsQuery.refetch()} />
            : (
              <PrivacyRouterExitsTab
                router={router}
                exits={exits}
                rules={rules}
                exitStates={report?.status.exits ?? []}
                probes={report?.status.probes}
                isAdmin={isAdmin}
              />
            )}
        </TabsContent>

        <TabsContent value="setup">
          {/* The next-step card can point at Exits or Rules, so it needs to be
              able to actually go there rather than only name the tab. */}
          <PrivacyRouterSetupTab router={router} isAdmin={isAdmin} onOpenTab={onTabChange} />
        </TabsContent>
      </Tabs>

      <PrivacyRouterDialog router={router} open={settingsOpen} onOpenChange={onSettingsOpenChange} />
    </div>
  );
}

function PrivacyRouterTabTrigger({
  value,
  label,
  mobileLabel,
  icon: Icon,
  count,
  ariaLabel,
}: {
  value: PrivacyRouterTab;
  label: string;
  mobileLabel: string;
  icon: typeof Split;
  count: number | null;
  ariaLabel: string;
}) {
  return (
    <TabsTrigger value={value} className="min-w-0 gap-1.5 px-2" aria-label={ariaLabel}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="truncate sm:hidden">{mobileLabel}</span>
      <span className="hidden sm:inline">{label}</span>
      {count !== null && (
        <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[0.6875rem] tabular-nums" aria-hidden="true">
          {count}
        </Badge>
      )}
    </TabsTrigger>
  );
}

/**
 * A failed STATUS read is not a failed page: the rules and exits are still worth
 * showing, so this is a destructive alert beside them rather than an empty state
 * that replaces everything.
 */
function VpnStatusError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-destructive">Could not read the router</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{message} {VPN_STATUS_READ_FAILED_NOTE}</p>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function VpnListError({ subject, message, onRetry }: { subject: string; message: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={Split}
      title={`Could not load the ${subject}`}
      description={message}
      action={<Button onClick={onRetry}>Try again</Button>}
    />
  );
}

function PrivacyRouterSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading privacy routers">
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
