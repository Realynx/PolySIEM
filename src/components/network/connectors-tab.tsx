"use client";

import { useState } from "react";
import {
  KeyRound,
  Link2,
  Pencil,
  PlugZap,
  Plus,
  Share2,
  Terminal,
  Trash2,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { EmptyState } from "@/components/shared/empty-state";
import { CopyButton } from "@/components/ssh/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectorInstallDialog } from "./connector-install-dialog";
import { ConnectorEdgeLinks } from "./connector-link-list";
import { ConnectorSshPanel } from "./connector-ssh-panel";
import { useAllConnectorsQuery } from "./connectors-card";
import {
  CreateConnectorDialog,
  DeleteConnectorDialog,
  EditConnectorDialog,
  LinkEdgeToConnectorDialog,
  RotateTokenDialog,
  UnlinkConnectorDialog,
} from "./connector-dialogs";
import {
  connectorAgentSummary,
  connectorContactFallback,
  connectorInstallReveal,
  connectorInterfaceName,
  connectorKindOf,
  connectorKindPresentation,
  connectorLastContactAt,
  connectorLinkEdgeName,
  connectorLinkSummary,
  connectorSshPresentation,
  connectorStatusPresentation,
  connectorSummary,
  connectorTunnelProvisioned,
  isManualConnector,
  CONNECTOR_INDEPENDENCE_COPY,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorLinkDto,
  type ConnectorPeerConfigDto,
  type ConnectorPeerHandoff,
  type ConnectorTunnelProvisionedDto,
  type EdgeNatServer,
} from "./edge-networks-types";

interface ConnectorSetupState {
  connector: ConnectorDto;
  reason: ConnectorInstallReason;
  reveal: ConnectorInstallReveal | null;
  peerConfig?: ConnectorPeerConfigDto | null;
  /** Set when creating the connector also stood the edge's tunnel up. */
  tunnelProvisioned?: ConnectorTunnelProvisionedDto | null;
  /** One edge box to scope a manual connector's peer settings to. */
  focusIntegrationId?: string | null;
}

/**
 * The peer settings for the edge a link just added, opened on the spot.
 *
 * `reason` is inert for a manual connector — it has no token and no install
 * steps — so the flow reads as "here is what to paste", not "here is an
 * install".
 */
function peerSetupFromHandoff(handoff: ConnectorPeerHandoff): ConnectorSetupState {
  return {
    connector: handoff.connector,
    reason: "created",
    reveal: null,
    peerConfig: handoff.peerConfig,
    tunnelProvisioned: handoff.tunnelProvisioned,
    focusIntegrationId: handoff.integrationId,
  };
}

interface ConnectorTabDialogs {
  editing: ConnectorDto | null;
  rotating: ConnectorDto | null;
  deleting: ConnectorDto | null;
  linking: ConnectorDto | null;
  unlinking: { connector: ConnectorDto; link: ConnectorLinkDto } | null;
}

const NO_DIALOGS: ConnectorTabDialogs = {
  editing: null, rotating: null, deleting: null, linking: null, unlinking: null,
};

/**
 * The page-level Connectors tab: every connector PolySIEM knows about, and the
 * edge boxes each one serves.
 *
 * This tab exists because a connector is not part of an edge box. It is
 * installed once on a machine inside your network and can carry traffic for
 * several edge boxes at the same time, each with its own tunnel address — so it
 * needs somewhere to live that is not inside any one server's card.
 */
export function ConnectorsTab({ servers, isAdmin }: { servers: EdgeNatServer[]; isAdmin: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [setup, setSetup] = useState<ConnectorSetupState | null>(null);
  const [dialogs, setDialogs] = useState<ConnectorTabDialogs>(NO_DIALOGS);
  const close = () => setDialogs(NO_DIALOGS);

  const query = useAllConnectorsQuery({
    // While an agent is installing, watch it flip to "connected".
    refetchInterval: setup && !isManualConnector(setup.connector) ? 5_000 : false,
  });
  const connectors = query.data ?? [];
  const summary = connectorSummary(connectors);

  return (
    <section className="space-y-4" aria-labelledby="connectors-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="connectors-heading" className="text-lg font-semibold">Connectors</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{CONNECTOR_INDEPENDENCE_COPY}</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Add connector
          </Button>
        )}
      </div>

      {connectors.length > 0 && <ConnectorsSummaryCards summary={summary} edgeCount={servers.length} />}

      {query.isLoading && <Skeleton className="h-48 w-full rounded-xl" />}
      {query.isError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Could not load connectors</AlertTitle>
          <AlertDescription>{(query.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {!query.isLoading && !query.isError && connectors.length === 0 && (
        <ConnectorsTabEmpty isAdmin={isAdmin} onAdd={() => setCreateOpen(true)} />
      )}

      <div className="space-y-4">
        {connectors.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            servers={servers}
            isAdmin={isAdmin}
            onEdit={() => setDialogs({ ...NO_DIALOGS, editing: connector })}
            onRotate={() => setDialogs({ ...NO_DIALOGS, rotating: connector })}
            onDelete={() => setDialogs({ ...NO_DIALOGS, deleting: connector })}
            onLink={() => setDialogs({ ...NO_DIALOGS, linking: connector })}
            onUnlink={(link) => setDialogs({ ...NO_DIALOGS, unlinking: { connector, link } })}
            onSetup={() => setSetup({ connector, reason: "created", reveal: null })}
            onPeerSettings={(link) => setSetup({
              connector,
              reason: "created",
              reveal: null,
              focusIntegrationId: link.integrationId,
            })}
          />
        ))}
      </div>

      {isAdmin && (
        <>
          <CreateConnectorDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            servers={servers}
            onCreated={(result) => {
              setCreateOpen(false);
              setSetup({
                connector: result.connector,
                reason: "created",
                reveal: connectorInstallReveal(result),
                peerConfig: result.peerConfig ?? null,
                tunnelProvisioned: connectorTunnelProvisioned(result),
              });
            }}
          />
          <ConnectorTabDialogSet
            dialogs={dialogs}
            servers={servers}
            onClose={close}
            onSetup={(next) => setSetup(next)}
          />
        </>
      )}

      {setup && (
        <ConnectorSetupHost
          setup={setup}
          connectors={connectors}
          servers={servers}
          onClose={() => setSetup(null)}
          onLinkEdge={() => setDialogs({ ...NO_DIALOGS, linking: setup.connector })}
        />
      )}
    </section>
  );
}

/**
 * The open setup surface — the agent install steps, or a manual connector's peer
 * settings. Remounted whenever the token or the edge it is scoped to changes, so
 * a second edge box never inherits the first one's state.
 */
function ConnectorSetupHost({
  setup,
  connectors,
  servers,
  onClose,
  onLinkEdge,
}: {
  setup: ConnectorSetupState;
  connectors: ConnectorDto[];
  servers: EdgeNatServer[];
  onClose: () => void;
  onLinkEdge: () => void;
}) {
  return (
    <ConnectorInstallDialog
      key={setup.reveal?.installToken ?? `${setup.connector.id}:${setup.focusIntegrationId ?? "all"}`}
      open
      onOpenChange={(open) => !open && onClose()}
      reveal={setup.reveal}
      peerConfig={setup.peerConfig}
      reason={setup.reason}
      tunnelProvisioned={setup.tunnelProvisioned}
      connector={setup.connector}
      liveConnector={connectors.find((entry) => entry.id === setup.connector.id)}
      servers={servers}
      focusIntegrationId={setup.focusIntegrationId}
      onLinkEdge={onLinkEdge}
    />
  );
}

function ConnectorTabDialogSet({
  dialogs,
  servers,
  onClose,
  onSetup,
}: {
  dialogs: ConnectorTabDialogs;
  servers: EdgeNatServer[];
  onClose: () => void;
  onSetup: (setup: ConnectorSetupState) => void;
}) {
  return (
    <>
      {dialogs.editing && (
        <EditConnectorDialog
          key={dialogs.editing.id}
          connector={dialogs.editing}
          servers={servers}
          open
          onOpenChange={(open) => !open && onClose()}
        />
      )}
      {dialogs.rotating && (
        <RotateTokenDialog
          key={dialogs.rotating.id}
          connector={dialogs.rotating}
          onOpenChange={(open) => !open && onClose()}
          onRotated={(connector, reveal) => {
            onClose();
            onSetup({ connector, reason: "rotated", reveal });
          }}
        />
      )}
      {dialogs.deleting && (
        <DeleteConnectorDialog
          key={dialogs.deleting.id}
          connector={dialogs.deleting}
          servers={servers}
          onOpenChange={(open) => !open && onClose()}
        />
      )}
      {dialogs.linking && (
        <LinkEdgeToConnectorDialog
          key={dialogs.linking.id}
          connector={dialogs.linking}
          servers={servers}
          open
          onOpenChange={(open) => !open && onClose()}
          // A manual connector was linked FOR these values; end there, not on a toast.
          onPeerSettings={(handoff) => {
            onClose();
            onSetup(peerSetupFromHandoff(handoff));
          }}
        />
      )}
      {dialogs.unlinking && (
        <UnlinkConnectorDialog
          key={dialogs.unlinking.link.id}
          connector={dialogs.unlinking.connector}
          link={dialogs.unlinking.link}
          edgeName={connectorLinkEdgeName(dialogs.unlinking.link, servers)}
          onOpenChange={(open) => !open && onClose()}
        />
      )}
    </>
  );
}

function ConnectorsSummaryCards({
  summary,
  edgeCount,
}: {
  summary: ReturnType<typeof connectorSummary>;
  edgeCount: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SummaryTile
        label="Connectors ready"
        value={`${summary.ready}/${summary.total}`}
        detail="Installed and able to carry routes"
        icon={PlugZap}
      />
      {/* Not "how many are shared" as a bare number — that reads as a score.
          It answers "am I running duplicate installs I do not need?" */}
      <SummaryTile
        label="Shared by several edges"
        value={`${summary.shared}/${summary.total}`}
        detail={edgeCount === 1
          ? "One install can serve every edge box you add"
          : `One install can serve all ${edgeCount} edge boxes`}
        icon={Share2}
      />
      <SummaryTile
        label="Not linked yet"
        value={String(summary.unlinked)}
        detail="Installed, but no edge box routes through them"
        icon={Link2}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof PlugZap;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </CardContent>
    </Card>
  );
}

function ConnectorsTabEmpty({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <EmptyState
      icon={PlugZap}
      title="No connectors installed"
      description="A connector runs inside your network and dials out to your edge boxes, so nothing at home needs a public IP or an inbound port. Install one and link it to as many edge boxes as you like — you never need a second copy for a second edge."
      action={isAdmin ? <Button onClick={onAdd}><Plus className="size-4" /> Add connector</Button> : undefined}
    />
  );
}

/** One connector, with every edge box it serves. */
function ConnectorCard({
  connector,
  servers,
  isAdmin,
  onEdit,
  onRotate,
  onDelete,
  onLink,
  onUnlink,
  onSetup,
  onPeerSettings,
}: {
  connector: ConnectorDto;
  servers: EdgeNatServer[];
  isAdmin: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onLink: () => void;
  onUnlink: (link: ConnectorLinkDto) => void;
  onSetup: () => void;
  /** Peer settings for ONE of the edges this connector serves. */
  onPeerSettings: (link: ConnectorLinkDto) => void;
}) {
  const manual = isManualConnector(connector);
  const links = connectorLinkSummary(connector);
  const agent = connectorAgentSummary(connector);

  return (
    <Card className={cn(connector.status === "disabled" && "bg-muted/20")}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <ConnectorCardIdentity connector={connector} manual={manual} linksLabel={links.label} />
          {isAdmin && (
            <ConnectorCardActions
              connector={connector}
              manual={manual}
              canLinkMore={servers.length > links.total}
              onEdit={onEdit}
              onRotate={onRotate}
              onDelete={onDelete}
              onLink={onLink}
              onSetup={onSetup}
            />
          )}
        </div>
        <ConnectorCardFacts connector={connector} manual={manual} />
        {(agent || connector.notes) && (
          <p className="truncate text-xs text-muted-foreground">
            {agent}
            {agent && connector.notes ? " · " : ""}
            {connector.notes}
          </p>
        )}
      </CardHeader>

      <CardContent>
        <ConnectorEdgeLinks
          connector={connector}
          servers={servers}
          isAdmin={isAdmin}
          onLink={onLink}
          onUnlink={onUnlink}
          onPeerSettings={onPeerSettings}
        />
        {manual ? (
          <ManualConnectorNote connector={connector} isAdmin={isAdmin} onSetup={onSetup} />
        ) : isAdmin ? (
          <ConnectorSshPanel connector={connector} />
        ) : (
          <ConnectorSshReadOnly connector={connector} />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectorCardIdentity({
  connector,
  manual,
  linksLabel,
}: {
  connector: ConnectorDto;
  manual: boolean;
  linksLabel: string;
}) {
  const status = connectorStatusPresentation(connector);
  const kind = connectorKindPresentation(connectorKindOf(connector));
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {manual ? <Waypoints className="size-5" /> : <PlugZap className="size-5" />}
      </div>
      <div className="min-w-0">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {connector.name}
          <Badge variant="outline" className="font-normal" title={kind.detail}>{kind.label}</Badge>
          <Badge variant={status.variant} className={cn("font-normal", status.tone === "warning" && "text-warning")}>
            {status.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
            {status.label}
          </Badge>
        </CardTitle>
        <CardDescription className="mt-1">{linksLabel} · {status.hint}</CardDescription>
      </div>
    </div>
  );
}

/**
 * The whole-connector action. Once a connector serves several edge boxes it
 * covers all of them at once, and the per-edge blocks live on the rows — so it
 * says which it is rather than competing with them.
 */
function peerSettingsLabel(connector: ConnectorDto): string {
  return connectorLinkSummary(connector).total > 1 ? "Peer settings (all edges)" : "Peer settings";
}

function ConnectorCardActions({
  connector,
  manual,
  canLinkMore,
  onEdit,
  onRotate,
  onDelete,
  onLink,
  onSetup,
}: {
  connector: ConnectorDto;
  manual: boolean;
  canLinkMore: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onLink: () => void;
  onSetup: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {canLinkMore && (
        <Button variant="outline" size="sm" onClick={onLink}>
          <Link2 /> Link to an edge box
        </Button>
      )}
      {/* The per-edge blocks live on the rows below; this one shows every edge. */}
      <Button variant="outline" size="sm" onClick={onSetup}>
        {manual ? <Waypoints /> : <Terminal />} {manual ? peerSettingsLabel(connector) : "Setup steps"}
      </Button>
      {!manual && (
        <Button variant="outline" size="icon-sm" aria-label={`Rotate install token for ${connector.name}`} onClick={onRotate}>
          <KeyRound />
        </Button>
      )}
      <Button variant="outline" size="icon-sm" aria-label={`Edit ${connector.name}`} onClick={onEdit}>
        <Pencil />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        aria-label={`Delete ${connector.name}`}
        title={`Remove ${connector.name} from every edge box`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function ConnectorCardFacts({ connector, manual }: { connector: ConnectorDto; manual: boolean }) {
  const contactAt = connectorLastContactAt(connector);
  const ssh = connectorSshPresentation(connector);
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Connector ID</p>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{connector.connectorId}</code>
          <CopyButton value={connector.connectorId} label={`Copy the connector ID for ${connector.name}`} />
        </div>
      </div>
      <ConnectorFact
        label="Tunnel interface"
        value={connectorInterfaceName(connector)}
        hint="One interface, one peer per edge box"
        mono
      />
      <ConnectorFact
        label={manual ? "Far-side public key" : "Latest handshake"}
        value={manual
          ? connector.publicKey ? "Registered" : "Not pasted back yet"
          : contactAt ? formatRelative(contactAt) : connectorContactFallback(connector)}
        tone={manual && !connector.publicKey ? "warning" : undefined}
      />
      <ConnectorFact
        label="SSH management"
        value={manual ? "Not applicable" : ssh.label}
        hint={manual ? "Hand-configured peer" : ssh.endpoint ?? undefined}
        tone={manual ? undefined : ssh.tone === "warning" ? "warning" : undefined}
      />
    </div>
  );
}

function ConnectorFact({
  label,
  value,
  hint,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  tone?: "warning";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate font-medium", mono && "font-mono text-xs", tone === "warning" && "text-warning")}>
        {value}
      </p>
      {hint && <p className="truncate text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ManualConnectorNote({
  connector,
  isAdmin,
  onSetup,
}: {
  connector: ConnectorDto;
  isAdmin: boolean;
  onSetup: () => void;
}) {
  const kind = connectorKindPresentation(connectorKindOf(connector));
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {connector.publicKey
          ? <>Configured by hand on {kind.farSide}. Every edge box it serves trusts the same public key — but each one gives it a different tunnel address, so the far side needs one interface address per edge.</>
          : <>PolySIEM is waiting for {kind.farSide}&apos;s public key. Until then it is not a tunnel peer anywhere and cannot carry a route.</>}
      </p>
      {isAdmin && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Every edge box this connector serves, each with its own block"
          onClick={onSetup}
        >
          <Waypoints /> {connector.publicKey ? peerSettingsLabel(connector) : "Finish setup"}
        </Button>
      )}
    </div>
  );
}

function ConnectorSshReadOnly({ connector }: { connector: ConnectorDto }) {
  const ssh = connectorSshPresentation(connector);
  if (!ssh.endpoint) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
      <code className="font-mono">{ssh.username}@{ssh.endpoint}</code>
      <span>· {ssh.label.toLowerCase()}</span>
    </p>
  );
}
