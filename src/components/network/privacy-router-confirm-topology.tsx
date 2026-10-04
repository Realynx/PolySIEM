"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  privacyRouterTopologyBody,
  usePrivacyTopologyForm,
  type PrivacyRouterTopologyForm,
} from "./privacy-router-enrollment";
import { normalizeIpv4Cidr } from "@/lib/validators/privacy-router";
import {
  parsePrivacyClientNetworks,
  privacyRouterClientNetworksView,
  privacyRouterInterfaceLabel,
  privacyRouterInterfaceScopeNote,
  privacyRouterTopologyError,
  PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE,
  PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE,
  type PrivacyTopologySummary,
} from "./privacy-router-presentation";
import {
  privacyRouterStatusQueryKey,
  privacyRouterStatusUrl,
  privacyRouterUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type PrivacyInterfaceInfo,
  type PrivacyRouterDto,
  type PrivacyRouterStatusReport,
} from "./privacy-router-types";

/**
 * Confirming the router's topology: which interface faces the LAN, which one
 * reaches the internet, and what the LAN network is.
 *
 * The operator is never asked to remember any of this. The box reports its own
 * interfaces in STATUS, `suggestPrivacyRouterTopology` picks the likely pair,
 * and this is a confirmation of a filled-in answer rather than three blank
 * fields — which is precisely what the previous add dialog got wrong ("I'm not
 * really sure what to put in for LAN interface or WAN interface yet at all").
 *
 * Rendered twice: as step 4 of the add flow, and as a section of the Setup tab
 * for a router whose topology is not confirmed yet.
 */

/** A stable empty list, so a null status does not re-seed the form every render. */
const NO_INTERFACES: readonly PrivacyInterfaceInfo[] = [];

/**
 * The three controls, plus the box's own shape stated as a fact.
 *
 * The one-armed case — a single `eth0` carrying both the LAN and the WireGuard
 * underlay — is the NORMAL shape on this hardware, so it is rendered as
 * information and never as a warning. An alert about something correct is how
 * this screen lost its reader the first time.
 *
 * The second sentence is the fix for the second way it lost them: "I don't see
 * WireGuard interface or anything… perhaps it is misleading, if I'm expecting to
 * configure something like ProtonVPN." These lists hold the box's own NICs; the
 * tunnels PolySIEM creates are never in them, and the step now says so and names
 * the tab that has them.
 */
export function PrivacyTopologyFields({
  form,
  interfaces,
  summary,
  exitCount,
  onChange,
}: {
  form: PrivacyRouterTopologyForm;
  interfaces: readonly PrivacyInterfaceInfo[];
  summary: PrivacyTopologySummary;
  /** This router's exits, so the note can say how many are already elsewhere. */
  exitCount: number;
  onChange: (patch: Partial<PrivacyRouterTopologyForm>) => void;
}) {
  const scope = privacyRouterInterfaceScopeNote(exitCount);
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-foreground">{summary.fact}</span>
          {summary.gap && <span className="mt-0.5 block">{summary.gap}</span>}
          <span className="mt-1.5 block">{scope.fact}</span>
          <span className="mt-0.5 block">{scope.exclusion}</span>
        </span>
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <PrivacyInterfaceField
          id="privacy-topology-lanif"
          label="LAN interface"
          help="The one whose subnet holds the address PolySIEM just connected to."
          value={form.lanInterface}
          interfaces={interfaces}
          onChange={(lanInterface) => onChange({ lanInterface })}
        />
        <PrivacyInterfaceField
          id="privacy-topology-wanif"
          label="WAN interface"
          help="The one holding the default route."
          value={form.wanInterface}
          interfaces={interfaces}
          onChange={(wanInterface) => onChange({ wanInterface })}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="privacy-topology-lan">Router&apos;s own network</Label>
        <Input
          id="privacy-topology-lan"
          value={form.lanCidr}
          onChange={(event) => onChange({ lanCidr: event.target.value })}
          placeholder="10.0.3.0/24"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          The network the box itself sits on, in CIDR form. Not necessarily the network its clients are on.
        </p>
      </div>

      <PrivacyClientNetworksField
        value={form.clientNetworks}
        lanCidr={form.lanCidr || null}
        onChange={(clientNetworks) => onChange({ clientNetworks })}
      />
    </div>
  );
}

/**
 * The field that decides whose traffic this router actually handles.
 *
 * Given its own component, and its own explanation, because it is the one field
 * here that the box cannot answer and the one most likely to be wrong on first
 * setup — an operator who reads "the network this router serves" and types the
 * router's own subnet gets a router that silently ignores every other VLAN. The
 * copy comes from `privacy-router-presentation.ts` so the phone says it too.
 *
 * A textarea rather than an input: several VLANs is the normal case, and a list
 * that has to be read back is easier to check one per line.
 */
export function PrivacyClientNetworksField({
  value,
  lanCidr,
  onChange,
}: {
  value: string;
  lanCidr: string | null;
  onChange: (value: string) => void;
}) {
  // Read off the TYPED value, not the stored one, so the "only the router's own
  // subnet" note clears the moment a second network is added. Parsed rather than
  // split, so a half-typed token cannot masquerade as a network.
  const view = privacyRouterClientNetworksView({
    lanCidr: lanCidr === null ? null : normalizeIpv4Cidr(lanCidr),
    clientNetworks: parsePrivacyClientNetworks(value).networks,
  });
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="privacy-topology-clients">{view.label}</Label>
      <Textarea
        id="privacy-topology-clients"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={view.placeholder}
        rows={3}
        autoCapitalize="none"
        spellCheck={false}
        className="font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">{view.help}</p>
      <p className="text-xs text-muted-foreground">{view.distinction}</p>
      {view.warning && <p className="text-xs text-warning">{view.warning}</p>}
    </div>
  );
}

/**
 * One interface picker: a list of what the box reported, or a plain field when
 * it has not been read yet. Never a free-text box pretending to be a choice.
 */
function PrivacyInterfaceField({
  id,
  label,
  help,
  value,
  interfaces,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  interfaces: readonly PrivacyInterfaceInfo[];
  onChange: (value: string) => void;
}) {
  const known = interfaces.some((one) => one.name === value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {interfaces.length === 0 ? (
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="eth0"
          autoCapitalize="none"
          spellCheck={false}
        />
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Choose an interface" /></SelectTrigger>
          <SelectContent>
            {interfaces.map((one) => (
              <SelectItem key={one.name} value={one.name}>{privacyRouterInterfaceLabel(one)}</SelectItem>
            ))}
            {/* A stored name the current scan no longer reports still has to be
                selectable, or opening this control would silently clear it. */}
            {value && !known && <SelectItem value={value}>{value} · not in the last scan</SelectItem>}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * The Setup tab's copy of the same decision, for a router whose topology was
 * never confirmed — one created before this flow existed, or one whose add flow
 * was abandoned at step 4.
 *
 * It reads STATUS on demand rather than on mount: every read opens a real SSH
 * session to the box, and the Setup tab is not a place that should be doing
 * that by itself.
 */
export function PrivacyRouterTopologyPanel({ router }: { router: PrivacyRouterDto }) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: privacyRouterStatusQueryKey(router.id),
    queryFn: () => apiFetch<PrivacyRouterStatusReport>(privacyRouterStatusUrl(router.id)),
    enabled: false,
    retry: false,
  });
  const interfaces = statusQuery.data?.status.interfaces ?? NO_INTERFACES;
  const { form, setForm, summary } = usePrivacyTopologyForm(interfaces, router.ssh.host, router);
  const save = useMutation({
    mutationFn: () => apiFetch<PrivacyRouterDto>(privacyRouterUrl(router.id), {
      method: "PATCH",
      body: JSON.stringify(privacyRouterTopologyBody(form)),
    }),
    onSuccess: () => {
      toast.success("Topology confirmed. Apply the configuration when you are ready.");
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the topology: ${error.message}`),
  });

  const submit = () => {
    const error = privacyRouterTopologyError(form);
    if (error) { toast.error(error); return; }
    save.mutate();
  };

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="Confirm the router topology">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Confirm the router&apos;s topology</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={statusQuery.isFetching}
          onClick={() => void statusQuery.refetch()}
        >
          <RefreshCw className={cn("size-4", statusQuery.isFetching && "animate-spin")} aria-hidden="true" />
          Detect interfaces
        </Button>
      </div>

      {statusQuery.isError && (
        <p className="text-xs text-destructive">
          Could not read the router: {(statusQuery.error as Error).message}
        </p>
      )}

      <PrivacyTopologyFields
        form={form}
        interfaces={interfaces}
        summary={summary}
        exitCount={router.exitCount}
        onChange={setForm}
      />
      <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE}</p>

      <Button type="button" disabled={save.isPending} onClick={submit}>
        {save.isPending && <Loader2 className="animate-spin" />}Save topology
      </Button>
    </section>
  );
}
