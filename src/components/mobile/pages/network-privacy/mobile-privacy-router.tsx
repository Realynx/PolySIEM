"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, RefreshCw, Split } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
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
} from "@/components/network/privacy-router-types";
import { MobilePrivacyAddSheet } from "./mobile-privacy-add-sheet";
import { MobilePrivacyExitsPanel } from "./mobile-privacy-exits";
import { MobilePrivacyIntro } from "./mobile-privacy-intro";
import { MobilePrivacyOverview } from "./mobile-privacy-overview";
import { MobilePrivacyRouterSheet } from "./mobile-privacy-router-sheet";
import { MobilePrivacyRulesPanel } from "./mobile-privacy-rules";
import { MobilePrivacySetupPanel } from "./mobile-privacy-setup";
import { MobilePrivacyTrafficPanel } from "./mobile-privacy-traffic";
import { PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * The privacy router on a phone.
 *
 * A **privacy router** is a PolySIEM-managed Linux box on the LAN that decides, per
 * flow, whether traffic leaves through the WAN or through one of its WireGuard
 * **exits** — from ONE ordered, first-match-wins list of routing rules. The four
 * tabs answer, in the same order as the desktop page, what happened (Traffic),
 * what the policy is (Rules), what it can route through (Exits), and how the box
 * came to exist at all (Setup).
 *
 * Nothing here writes copy about a rule's tier, a throttle, an exit's health,
 * the concurrency probe or the two setup walkthroughs: every one of those words
 * comes from `network/privacy-router-presentation`, which the desktop page reads
 * too, so the two surfaces cannot describe the same box differently. The phone
 * chooses only its own shape — lists instead of tables, sheets instead of
 * popovers, and one tab's panel on screen at a time.
 */

const PRIVACY_TABS = ["traffic", "rules", "exits", "setup"] as const;
type MobilePrivacyTab = (typeof PRIVACY_TABS)[number];

function resolvePrivacyTab(param: string | null): MobilePrivacyTab {
  return PRIVACY_TABS.find((tab) => tab === param) ?? "traffic";
}

/** The FAB's action for a tab, or null where the tab has nothing to add. */
function addAction(tab: MobilePrivacyTab): { label: string; sheet: "rule" | "exit" } | null {
  if (tab === "rules") return { label: "Add routing rule", sheet: "rule" };
  if (tab === "exits") return { label: "Add exit", sheet: "exit" };
  return null;
}

export function MobilePrivacyRouter({ isAdmin }: { isAdmin: boolean }) {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addRouterOpen, setAddRouterOpen] = useState(false);
  const tab = resolvePrivacyTab(searchParams.get("tab"));

  const routersQuery = useQuery({
    queryKey: privacyRoutersQueryKey(),
    queryFn: () => apiFetch<PrivacyRouterDto[]>(privacyRoutersUrl()),
    refetchInterval: 60_000,
  });
  const routers = routersQuery.data ?? [];
  const router = routers.find((one) => one.id === selectedId) ?? routers[0] ?? null;

  return (
    <>
      <MobilePageHeader
        title="Privacy router"
        backHref="/network"
        actions={
          <button
            type="button"
            aria-label="Refresh"
            disabled={routersQuery.isFetching}
            onClick={() => void routersQuery.refetch()}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <RefreshCw className={cn("size-4.5", routersQuery.isFetching && "animate-spin")} />
          </button>
        }
      >
        <MobileSegmented items={privacyTabItems(tab, router)} />
      </MobilePageHeader>

      <MobilePage>
        <PrivacyRoutersBody
          router={router}
          routers={routers}
          tab={tab}
          isAdmin={isAdmin}
          isLoading={routersQuery.isLoading}
          error={routersQuery.isError ? ((routersQuery.error as Error | null) ?? new Error("unavailable")) : null}
          onRetry={() => void routersQuery.refetch()}
          onSelectRouter={setSelectedId}
          onAddRouter={() => setAddRouterOpen(true)}
        />
      </MobilePage>

      {addRouterOpen && (
        <MobilePrivacyAddSheet
          onOpenChange={setAddRouterOpen}
          onCreated={(created) => setSelectedId(created.id)}
        />
      )}
    </>
  );
}

/**
 * The four page tabs, in the desktop page's order, with the two counts worth
 * carrying on a 412px strip.
 */
function privacyTabItems(tab: MobilePrivacyTab, router: PrivacyRouterDto | null) {
  return [
    { label: "Traffic", href: "/network/privacy-router?tab=traffic", active: tab === "traffic" },
    {
      label: router ? `Rules · ${router.ruleCount}` : "Rules",
      href: "/network/privacy-router?tab=rules",
      active: tab === "rules",
    },
    {
      label: router ? `Exits · ${router.exitCount}` : "Exits",
      href: "/network/privacy-router?tab=exits",
      active: tab === "exits",
    },
    { label: "Setup", href: "/network/privacy-router?tab=setup", active: tab === "setup" },
  ];
}

/** Loading, failure, no-router-yet, or the selected router's workspace. */
function PrivacyRoutersBody({
  router,
  routers,
  tab,
  isAdmin,
  isLoading,
  error,
  onRetry,
  onSelectRouter,
  onAddRouter,
}: {
  router: PrivacyRouterDto | null;
  routers: PrivacyRouterDto[];
  tab: MobilePrivacyTab;
  isAdmin: boolean;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSelectRouter: (id: string) => void;
  onAddRouter: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading privacy routers">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon={Split}
        title="Could not load privacy routers"
        description={error.message || "The privacy router inventory is unavailable."}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    );
  }
  if (!router) return <MobilePrivacyEmptyState isAdmin={isAdmin} onAddRouter={onAddRouter} />;
  return (
    <MobilePrivacyWorkspace
      router={router}
      routers={routers}
      tab={tab}
      isAdmin={isAdmin}
      onSelectRouter={onSelectRouter}
    />
  );
}

/**
 * With no routers, the page's whole job is to answer "what is this".
 *
 * The review that produced this redesign ended with "I'm not even really sure
 * what the privacy router is as a user just clicking this at this point", and
 * this is the screen where that is asked. The phone shows the same explanation
 * and the same prerequisites as the desktop empty state, from the same words.
 */
function MobilePrivacyEmptyState({ isAdmin, onAddRouter }: { isAdmin: boolean; onAddRouter: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <MobilePrivacyIntro />
      {isAdmin ? (
        <Button className="w-full" onClick={onAddRouter}>
          <Plus className="size-4" /> Add a privacy router
        </Button>
      ) : (
        <p className="px-0.5 text-xs leading-snug text-muted-foreground">Ask an administrator to add one.</p>
      )}
      {isAdmin && (
        <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
          Four steps. PolySIEM asks for three things and finds the rest.
        </p>
      )}
    </div>
  );
}

/** One router's head and the selected tab's panel, with the queries they read. */
function MobilePrivacyWorkspace({
  router,
  routers,
  tab,
  isAdmin,
  onSelectRouter,
}: {
  router: PrivacyRouterDto;
  routers: PrivacyRouterDto[];
  tab: MobilePrivacyTab;
  isAdmin: boolean;
  onSelectRouter: (id: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const nextRouter = useRouter();
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
  const applyMutation = useVpnApply(router, () => void statusQuery.refetch());

  const exits = exitsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const report = statusQuery.data;
  const add = addAction(tab);

  return (
    <>
      {routers.length > 1 && <PrivacyRouterPicker routers={routers} selected={router} onSelect={onSelectRouter} />}

      <MobilePrivacyOverview
        router={router}
        rules={rules}
        report={report}
        isAdmin={isAdmin}
        applying={applyMutation.isPending}
        reading={statusQuery.isFetching}
        statusError={statusQuery.isError ? (statusQuery.error as Error) : null}
        onApply={() => applyMutation.mutate()}
        onRead={() => void statusQuery.refetch()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSetup={() => pushWithNavigationFeedback(nextRouter, "/network/privacy-router?tab=setup")}
      />

      <PrivacyTabPanel
        tab={tab}
        router={router}
        rules={rules}
        exits={exits}
        report={report}
        isAdmin={isAdmin}
        rulesError={rulesQuery.isError ? (rulesQuery.error as Error) : null}
        exitsError={exitsQuery.isError ? (exitsQuery.error as Error) : null}
        addOpen={addOpen}
        onAddOpenChange={setAddOpen}
      />

      {isAdmin && add && router.enabled && (
        <MobileFab aria-label={add.label} onClick={() => setAddOpen(true)}>
          <Plus />
        </MobileFab>
      )}

      {settingsOpen && (
        <MobilePrivacyRouterSheet router={router} onOpenChange={setSettingsOpen} />
      )}
    </>
  );
}

/**
 * Only the selected tab's panel renders — a phone never scrolls through all
 * four, and the Rules and Exits panels each own several sheets that have no
 * business being mounted while another tab is showing.
 */
function PrivacyTabPanel({
  tab,
  router,
  rules,
  exits,
  report,
  isAdmin,
  rulesError,
  exitsError,
  addOpen,
  onAddOpenChange,
}: {
  tab: MobilePrivacyTab;
  router: PrivacyRouterDto;
  rules: PrivacyRoutingRuleDto[];
  exits: VpnExitDto[];
  report: PrivacyRouterStatusReport | undefined;
  isAdmin: boolean;
  rulesError: Error | null;
  exitsError: Error | null;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}) {
  if (tab === "traffic") return <MobilePrivacyTrafficPanel routerId={router.id} />;
  if (tab === "setup") return <MobilePrivacySetupPanel router={router} isAdmin={isAdmin} />;
  if (tab === "rules") {
    if (rulesError) return <PrivacyNotice tone="danger" title="Could not load the rules" detail={rulesError.message} />;
    return (
      <MobilePrivacyRulesPanel
        router={router}
        rules={rules}
        exits={exits}
        ruleCounters={report?.status.ruleCounters ?? []}
        hasStatus={report !== undefined}
        isAdmin={isAdmin}
        addOpen={addOpen}
        onAddOpenChange={onAddOpenChange}
      />
    );
  }
  if (exitsError) return <PrivacyNotice tone="danger" title="Could not load the exits" detail={exitsError.message} />;
  return (
    <MobilePrivacyExitsPanel
      router={router}
      exits={exits}
      rules={rules}
      exitStates={report?.status.exits ?? []}
      probes={report?.status.probes}
      isAdmin={isAdmin}
      addOpen={addOpen}
      onAddOpenChange={onAddOpenChange}
    />
  );
}

/**
 * Applying is the one write that reaches the box, so its result is reported in
 * full — including the concurrency verdict, which is the one way this feature
 * can come back having quietly under-delivered.
 */
function useVpnApply(router: PrivacyRouterDto, onApplied: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<PrivacyRouterApplyResult>(privacyRouterApplyUrl(router.id), { method: "POST" }),
    onSuccess: (result) => {
      toast.success(`Applied revision ${result.revision} · ${result.ruleCount} rules on ${router.name}.`);
      if (result.exitsConcurrent === false) {
        toast.warning(
          "The router could not use several exits at once — per-rule exit selection holds only on inspected traffic.",
        );
      }
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
      onApplied();
    },
    onError: (error: Error) => toast.error(`Could not apply the configuration: ${error.message}`),
  });
}

/** Only when there is more than one box to pick from. */
function PrivacyRouterPicker({
  routers,
  selected,
  onSelect,
}: {
  routers: PrivacyRouterDto[];
  selected: PrivacyRouterDto;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MobileList>
        <MobileListRow
          onClick={() => setOpen(true)}
          leading={<Split className="size-4" />}
          title={<span className="truncate">{selected.name}</span>}
          subtitle={`1 of ${routers.length} privacy routers`}
          trailing={<ChevronRight className="size-4 text-muted-foreground/50" />}
        />
      </MobileList>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Choose a privacy router"
        description="Each box has its own rules, exits and traffic."
      >
        <MobileList className="mb-2">
          {routers.map((one) => (
            <MobileListRow
              key={one.id}
              onClick={() => {
                onSelect(one.id);
                setOpen(false);
              }}
              title={<span className="truncate">{one.name}</span>}
              subtitle={<span className="font-mono">{one.ssh.host}</span>}
              trailing={one.id === selected.id ? <span className="text-[11px]">selected</span> : undefined}
            />
          ))}
        </MobileList>
      </BottomSheet>
    </>
  );
}
