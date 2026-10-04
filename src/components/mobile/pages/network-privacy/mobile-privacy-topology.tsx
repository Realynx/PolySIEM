"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import { normalizeIpv4Cidr } from "@/lib/validators/privacy-router";
import {
  privacyRouterTopologyBody,
  usePrivacyTopologyForm,
  type PrivacyRouterTopologyForm,
} from "@/components/network/privacy-router-enrollment";
import {
  parsePrivacyClientNetworks,
  privacyRouterClientNetworksView,
  privacyRouterInterfaceLabel,
  privacyRouterInterfaceScopeNote,
  privacyRouterTopologyError,
  PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE,
  PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE,
  type PrivacyTopologySummary,
} from "@/components/network/privacy-router-presentation";
import {
  privacyRouterStatusQueryKey,
  privacyRouterStatusUrl,
  privacyRouterUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type PrivacyInterfaceInfo,
  type PrivacyRouterDto,
  type PrivacyRouterStatusReport,
} from "@/components/network/privacy-router-types";
import { PrivacyListNote, PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * Confirming the router's topology on a phone.
 *
 * The seeding rule, the summary sentence and every word of copy come from the
 * same modules the desktop uses, so the two cannot describe the same box
 * differently. The phone chooses only its own controls.
 *
 * The one-armed case — one `eth0` carrying both the LAN and the WireGuard
 * underlay — is rendered as INFORMATION, never as a warning. It is the normal
 * shape of the reference hardware, and an alert about something correct is how
 * this screen lost its reader the first time round.
 */

/** A stable empty list, so a null status does not re-seed the form every render. */
const NO_INTERFACES: readonly PrivacyInterfaceInfo[] = [];

export function MobilePrivacyTopologyFields({
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
    <div className="flex flex-col gap-3">
      <PrivacyNotice
        tone="info"
        title={summary.fact}
        detail={summary.gap ?? PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE}
      />

      {/* The box's own NICs, and the tunnels that are deliberately not among
          them — the second half is what a reader expecting Proton needs. */}
      <PrivacyListNote>
        {scope.fact} {scope.exclusion}
      </PrivacyListNote>

      <MobilePrivacyInterfaceField
        id="m-privacy-topology-lanif"
        label="LAN interface"
        help="The one whose subnet holds the address PolySIEM just connected to."
        value={form.lanInterface}
        interfaces={interfaces}
        onChange={(lanInterface) => onChange({ lanInterface })}
      />
      <MobilePrivacyInterfaceField
        id="m-privacy-topology-wanif"
        label="WAN interface"
        help="The one holding the default route."
        value={form.wanInterface}
        interfaces={interfaces}
        onChange={(wanInterface) => onChange({ wanInterface })}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-topology-lan">Router&apos;s own network</Label>
        <Input
          id="m-privacy-topology-lan"
          value={form.lanCidr}
          onChange={(event) => onChange({ lanCidr: event.target.value })}
          placeholder="10.0.3.0/24"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs leading-snug text-muted-foreground">
          The network the box itself sits on, in CIDR form. Not necessarily the network its clients are on.
        </p>
      </div>

      <MobilePrivacyClientNetworksField
        value={form.clientNetworks}
        lanCidr={form.lanCidr || null}
        onChange={(clientNetworks) => onChange({ clientNetworks })}
      />
    </div>
  );
}

/**
 * The field that decides whose traffic this router actually handles, on a phone.
 *
 * Every word comes from `privacy-router-presentation.ts`, so the phone and the
 * desktop make the same distinction in the same sentences. What the phone
 * chooses is only the treatment: the "only your own subnet is listed" note is a
 * `PrivacyNotice` rather than a line of small text, because on a 412px screen a
 * fourth paragraph of muted copy is a paragraph nobody reads — and this is the
 * field most likely to be wrong.
 */
export function MobilePrivacyClientNetworksField({
  value,
  lanCidr,
  onChange,
}: {
  value: string;
  lanCidr: string | null;
  onChange: (value: string) => void;
}) {
  const view = privacyRouterClientNetworksView({
    lanCidr: lanCidr === null ? null : normalizeIpv4Cidr(lanCidr),
    clientNetworks: parsePrivacyClientNetworks(value).networks,
  });
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="m-privacy-topology-clients">{view.label}</Label>
      <Textarea
        id="m-privacy-topology-clients"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={view.placeholder}
        rows={3}
        autoCapitalize="none"
        spellCheck={false}
        className="font-mono text-xs"
      />
      <p className="text-xs leading-snug text-muted-foreground">{view.help}</p>
      <p className="text-xs leading-snug text-muted-foreground">{view.distinction}</p>
      {view.warning && <PrivacyNotice tone="warning" detail={view.warning} />}
    </div>
  );
}

/** A list of what the box reported, or a plain field before it has been read. */
function MobilePrivacyInterfaceField({
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
            {value && !known && <SelectItem value={value}>{value} · not in the last scan</SelectItem>}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs leading-snug text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * The Setup tab's copy of the decision, for a router whose topology was never
 * confirmed. It reads STATUS on demand: every read opens a real SSH session,
 * and a tab should not be doing that by itself.
 */
export function MobilePrivacyTopologySection({ router }: { router: PrivacyRouterDto }) {
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
    <MobileSection title="Confirm the router's topology">
      <PrivacyListNote>{PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE}</PrivacyListNote>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={statusQuery.isFetching}
        onClick={() => void statusQuery.refetch()}
      >
        <RefreshCw className={cn("size-4", statusQuery.isFetching && "animate-spin")} aria-hidden="true" />
        Detect interfaces
      </Button>

      {statusQuery.isError && (
        <PrivacyNotice
          tone="danger"
          title="Could not read the router"
          detail={(statusQuery.error as Error).message}
        />
      )}

      <MobilePrivacyTopologyFields
        form={form}
        interfaces={interfaces}
        summary={summary}
        exitCount={router.exitCount}
        onChange={setForm}
      />

      <Button type="button" className="w-full" disabled={save.isPending} onClick={submit}>
        {save.isPending && <Loader2 className="animate-spin" />}Save topology
      </Button>
    </MobileSection>
  );
}
