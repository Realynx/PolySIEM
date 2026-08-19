"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfigSelect } from "./config-select";
import {
  edgeInterfaceChoices,
  EDGE_NETWORKS_QUERY_KEY,
  isEdgeInterfaceFormValid,
  isValidEdgeInterfaceName,
  seedEdgeInterfaceForm,
  type ConfigChoice,
  type EdgeInterfaceFormState,
  type EdgeNatServer,
} from "./edge-networks-types";

/**
 * Which interfaces the edge publishes on and forwards out of.
 *
 * The options are the host's REAL interfaces, parsed from the last synced
 * snapshot (`ip -o -4 addr`) plus the configured WireGuard interface, so this is
 * a list of names that exist rather than a field to guess into. Anything not in
 * the list — including whatever is stored today — stays reachable through
 * "Custom…", and with no snapshot yet it degrades to the plain text inputs.
 */
export function EdgeInterfacesTab({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  if (!isAdmin) return <EdgeInterfacesReadOnly server={server} />;
  return <EdgeInterfacesForm server={server} />;
}

function EdgeInterfacesReadOnly({ server }: { server: EdgeNatServer }) {
  const settings = server.settings ?? {};
  return (
    <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
      <InterfaceFact label="Public interface" value={settings.publicInterface ?? "Not set"} />
      <InterfaceFact label="Outbound interface" value={settings.outboundInterface ?? "Not set"} />
    </div>
  );
}

function InterfaceFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs font-medium">{value}</p>
    </div>
  );
}

function EdgeInterfacesForm({ server }: { server: EdgeNatServer }) {
  const queryClient = useQueryClient();
  const seeded = useMemo(() => seedEdgeInterfaceForm(server), [server]);
  const choices = useMemo(() => edgeInterfaceChoices(server), [server]);
  const [form, setForm] = useState<EdgeInterfaceFormState>(seeded);
  const [seed, setSeed] = useState<EdgeInterfaceFormState>(seeded);
  // Re-seed when the server itself changes underneath the form (a refetch, or a
  // save elsewhere), without clobbering edits in progress on identical values.
  if (seed.publicInterface !== seeded.publicInterface || seed.outboundInterface !== seeded.outboundInterface) {
    setSeed(seeded);
    setForm(seeded);
  }

  const mutation = useMutation({
    mutationFn: (input: EdgeInterfaceFormState) =>
      apiFetch(`/api/admin/integrations/${server.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            publicInterface: input.publicInterface.trim(),
            outboundInterface: input.outboundInterface.trim(),
          },
        }),
      }),
    onSuccess: () => {
      toast.success(`Interfaces saved for ${server.name}. Apply changes to push them.`);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Could not save the interfaces: ${error.message}`),
  });

  const dirty = form.publicInterface !== seed.publicInterface || form.outboundInterface !== seed.outboundInterface;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dirty || !isEdgeInterfaceFormValid(form) || mutation.isPending}
          onClick={() => mutation.mutate(form)}
        >
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save interfaces
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <EdgeInterfaceField
          id={`public-if-${server.id}`}
          label="Public interface"
          value={form.publicInterface}
          onChange={(publicInterface) => setForm((current) => ({ ...current, publicInterface }))}
          choices={choices}
          customAriaLabel="Custom public interface name"
          inputPlaceholder="eth0"
          help="Where published traffic arrives — usually the WAN-facing NIC."
        />
        <EdgeInterfaceField
          id={`outbound-if-${server.id}`}
          label="Outbound interface"
          value={form.outboundInterface}
          onChange={(outboundInterface) => setForm((current) => ({ ...current, outboundInterface }))}
          choices={choices}
          customAriaLabel="Custom outbound interface name"
          inputPlaceholder="wg0"
          help="How the edge reaches the target — the tunnel interface for connector routes. It may legitimately be the same interface as above."
        />
      </div>
      <EdgeInterfacesNote choiceCount={choices.length} snapshotAt={server.settings?.syncedSnapshot?.capturedAt} />
    </div>
  );
}

function EdgeInterfaceField({
  id,
  label,
  value,
  onChange,
  choices,
  customAriaLabel,
  inputPlaceholder,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  choices: ConfigChoice[];
  customAriaLabel: string;
  inputPlaceholder: string;
  help: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <ConfigSelect
        id={id}
        value={value}
        onChange={onChange}
        choices={choices}
        placeholder="Choose an interface"
        customLabel="Custom interface…"
        customAriaLabel={customAriaLabel}
        inputPlaceholder={inputPlaceholder}
        invalid={Boolean(value) && !isValidEdgeInterfaceName(value)}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

function EdgeInterfacesNote({ choiceCount, snapshotAt }: { choiceCount: number; snapshotAt?: string | null }) {
  if (choiceCount === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        PolySIEM has not synced this server&apos;s interfaces yet, so type the names. Once a sync lands, this becomes a
        list of the interfaces that actually exist.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Options come from this server&apos;s own addresses{snapshotAt ? <> (observed {formatRelative(snapshotAt)})</> : null}.
      Saving records a pending change; use <span className="font-medium">Apply</span> to push it.
    </p>
  );
}
