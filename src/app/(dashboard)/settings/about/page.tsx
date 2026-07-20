import { randomInt } from "node:crypto";
import { ExternalLink } from "lucide-react";
import { requirePageAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";
import { AppLogo } from "@/components/shell/app-logo";
import { UpdateCheck } from "@/components/settings/update-check";
import { BashQuoteBlock } from "@/components/settings/bash-quote";
import { getInstanceName } from "@/lib/settings";
import { getCurrentVersion, getGitHubRepository } from "@/lib/updates/release";
import { formatBytes } from "@/lib/format";
import { computeMetricsReport } from "@/lib/services/compute-metrics";
import type { ComputeMetricSummary } from "@/lib/compute/metrics";

export const metadata = { title: "About" };
export const dynamic = "force-dynamic";

interface SystemStatus {
  database: "connected" | "unreachable";
  integrations: number | null;
}

async function getSystemStatus(): Promise<SystemStatus> {
  try {
    const [, integrations] = await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      prisma.integrationConfig.count(),
    ]);
    return { database: "connected", integrations };
  } catch {
    return { database: "unreachable", integrations: null };
  }
}

interface LabSummary {
  summary: ComputeMetricSummary;
  containersRunning: number;
  containersTotal: number;
  vmsRunning: number;
  vmsTotal: number;
  /** Per-cluster collection failures, e.g. a rejected Proxmox API token. */
  errors: string[];
}

/**
 * Cluster-wide totals for the neofetch panel. Returns null only when no compute
 * integration is wired up at all — a cluster that is configured but failing
 * still comes back so the panel can say so instead of rendering nothing, which
 * is indistinguishable from having no lab.
 */
async function getLabSummary(): Promise<LabSummary | null> {
  try {
    const { summary, resources, errors } = await computeMetricsReport();
    if (summary.nodesTotal === 0 && errors.length === 0) return null;
    const guests = resources.filter((resource) => resource.kind !== "node");
    const containers = guests.filter((guest) => guest.kind === "lxc");
    const vms = guests.filter((guest) => guest.kind === "qemu");
    return {
      summary,
      containersRunning: containers.filter((c) => c.status === "running").length,
      containersTotal: containers.length,
      vmsRunning: vms.filter((vm) => vm.status === "running").length,
      vmsTotal: vms.length,
      errors,
    };
  } catch {
    return null;
  }
}

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, `${minutes}m`]
    .filter(Boolean)
    .join(" ");
}

const ASCII_FONT: Record<string, string> = {
  A: ".###./#...#/#####/#...#/#...#",
  B: "####./#...#/####./#...#/####.",
  C: ".####/#..../#..../#..../.####",
  D: "####./#...#/#...#/#...#/####.",
  E: "#####/#..../####./#..../#####",
  F: "#####/#..../####./#..../#....",
  G: ".####/#..../#.###/#...#/.###.",
  H: "#...#/#...#/#####/#...#/#...#",
  I: "#####/..#../..#../..#../#####",
  J: "..###/...#./...#./#..#./.##..",
  K: "#...#/#..#./###../#..#./#...#",
  L: "#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#..##/#...#",
  O: ".###./#...#/#...#/#...#/.###.",
  P: "####./#...#/####./#..../#....",
  Q: ".###./#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/####./#..#./#...#",
  S: ".####/#..../.###./....#/####.",
  T: "#####/..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#.#.#/##.##/#...#",
  X: "#...#/.#.#./..#../.#.#./#...#",
  Y: "#...#/.#.#./..#../..#../..#..",
  Z: "#####/...#./..#../.#.../#####",
  "0": ".###./#..##/#.#.#/##..#/.###.",
  "1": "..#../.##../..#../..#../.###.",
  "2": ".###./#...#/...#./..#../#####",
  "3": "####./....#/.###./....#/####.",
  "4": "#..#./#..#./#####/...#./...#.",
  "5": "#####/#..../####./....#/####.",
  "6": ".###./#..../####./#...#/.###.",
  "7": "#####/...#./..#../.#.../.#...",
  "8": ".###./#...#/.###./#...#/.###.",
  "9": ".###./#...#/.####/....#/.###.",
  "-": "...../...../#####/...../.....",
  _: "...../...../...../...../#####",
  ".": "...../...../...../..##./..##.",
  " ": ".../.../.../.../...",
  "?": ".###./#...#/...#./...../..#..",
};

interface InstanceArtStyle {
  name: string;
  pixel: string;
  gap: string;
  signature: (name: string) => string;
  colorClass: string;
  shadowColor: string;
}

const INSTANCE_ART_STYLES: readonly InstanceArtStyle[] = [
  {
    name: "solid block",
    pixel: "#",
    gap: "  ",
    signature: (name) => `└─ ${name} // HOMELAB`,
    colorClass: "text-primary",
    shadowColor: "var(--primary)",
  },
  {
    name: "phosphor",
    pixel: "@",
    gap: "  ",
    signature: (name) => `> ${name.toUpperCase()} :: HOMELAB`,
    colorClass: "text-chart-2",
    shadowColor: "var(--chart-2)",
  },
  {
    name: "dot matrix",
    pixel: "o",
    gap: "  ",
    signature: (name) => `[ ${name} · HOMELAB ]`,
    colorClass: "text-chart-3",
    shadowColor: "var(--chart-3)",
  },
  {
    name: "circuit",
    pixel: "+",
    gap: "  ",
    signature: (name) => `╰─ ${name} / HOMELAB`,
    colorClass: "text-chart-4",
    shadowColor: "var(--chart-4)",
  },
  {
    name: "classic terminal",
    pixel: "*",
    gap: "  ",
    signature: (name) => `${name} :: HOMELAB`,
    colorClass: "text-chart-5",
    shadowColor: "var(--chart-5)",
  },
];

interface RenderedInstanceArt {
  rows: string[];
  width: number;
  signature: string;
}

function renderInstanceArt(instanceName: string, style: InstanceArtStyle): RenderedInstanceArt {
  const name =
    Array.from(instanceName, (character) => {
      const codePoint = character.codePointAt(0) ?? 32;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
      .join("")
      .replace(/\s+/g, " ")
      .trim() || "PolySIEM";
  const glyphs = Array.from(name.toUpperCase(), (character) =>
    (ASCII_FONT[character] ?? ASCII_FONT["?"]).split("/"),
  );
  const rows = Array.from({ length: 5 }, (_, row) =>
    glyphs
      .map((glyph) =>
        Array.from(glyph[row] ?? "", (pixel) =>
          pixel === "#" ? style.pixel : " ",
        ).join(""),
      )
      .join(style.gap)
      .trimEnd(),
  );
  const width = Math.max(...rows.map((row) => row.length));

  return {
    rows: rows.map((row) => row.padEnd(width, " ")),
    width,
    signature: style.signature(name),
  };
}

const INSTALL_LABELS: Record<string, string> = {
  docker: "Docker / GHCR",
  "windows-docker": "Windows / Docker Desktop",
  native: "Native Linux",
  "docker-source": "Docker / source build",
};

const BAR_WIDTH = 16;

/** neofetch-style block meter, e.g. [███████░░░░░░░░░]. */
function UsageBar({ fraction }: { fraction: number }) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(clamped * BAR_WIDTH);
  const tone =
    clamped >= 0.9
      ? "text-destructive"
      : clamped >= 0.75
        ? "text-warning"
        : "text-primary";
  return (
    <span
      aria-hidden="true"
      className="ml-2 hidden tracking-[-0.05em] sm:inline"
    >
      <span className="text-muted-foreground">[</span>
      <span className={tone}>{"█".repeat(filled)}</span>
      <span className="text-muted-foreground/40">
        {"░".repeat(BAR_WIDTH - filled)}
      </span>
      <span className="text-muted-foreground">]</span>
    </span>
  );
}

/** `12.4 GiB / 62.7 GiB (20%)` plus a meter, or an em dash when unmeasurable. */
function Usage({ used, total }: { used: number | null; total: number | null }) {
  if (used === null || total === null || total <= 0) return <>unavailable</>;
  const fraction = used / total;
  return (
    <>
      {formatBytes(used)} / {formatBytes(total)}{" "}
      <span className="text-muted-foreground">
        ({Math.round(fraction * 100)}%)
      </span>
      <UsageBar fraction={fraction} />
    </>
  );
}

/** The aggregated-lab rows, or a diagnostic row when collection failed. */
function labFacts(lab: LabSummary): { label: string; value: React.ReactNode }[] {
  const { summary } = lab;

  if (summary.nodesTotal === 0) {
    return [
      {
        label: "Cluster",
        value: (
          <span className="text-destructive">
            unreachable — {lab.errors[0] ?? "no nodes reported"}
          </span>
        ),
      },
    ];
  }

  return [
    {
      label: "Cluster",
      value: (
        <>
          {summary.clusters} {summary.clusters === 1 ? "cluster" : "clusters"} ·{" "}
          <span
            className={
              summary.nodesOnline === summary.nodesTotal
                ? "text-success"
                : "text-warning"
            }
          >
            {summary.nodesOnline}/{summary.nodesTotal} nodes online
          </span>
          {lab.errors.length > 0 ? (
            <span className="text-destructive"> · {lab.errors.length} failing</span>
          ) : null}
        </>
      ),
    },
    {
      label: "CPU",
      value: (
        <>
          {summary.cpuTotalCores} cores
          {summary.cpuUsage !== null ? (
            <>
              {" "}
              <span className="text-muted-foreground">
                ({Math.round(summary.cpuUsage * 100)}% used)
              </span>
              <UsageBar fraction={summary.cpuUsage} />
            </>
          ) : null}
        </>
      ),
    },
    {
      label: "Memory",
      value: (
        <Usage
          used={summary.memoryUsedBytes}
          total={summary.memoryTotalBytes}
        />
      ),
    },
    // Backing pools, not node root filesystems — `diskTotalBytes` would report
    // only boot disks, which understates real lab capacity by an order of
    // magnitude. Omitted when no pool reports a size.
    ...(summary.storageTotalBytes > 0
      ? [
          {
            label: "Storage",
            value: (
              <Usage
                used={summary.storageUsedBytes}
                total={summary.storageTotalBytes}
              />
            ),
          },
        ]
      : []),
    {
      label: "Containers",
      value: (
        <>
          <span className="text-success">{lab.containersRunning}</span> running /{" "}
          {lab.containersTotal} total
        </>
      ),
    },
    {
      label: "VMs",
      value: (
        <>
          <span className="text-success">{lab.vmsRunning}</span> running /{" "}
          {lab.vmsTotal} total
        </>
      ),
    },
  ];
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <dt className="font-semibold text-primary">{label}</dt>
      <dd className="min-w-0 break-words text-card-foreground">
        <span aria-hidden="true" className="mr-2 text-muted-foreground">
          ::
        </span>
        {children}
      </dd>
    </div>
  );
}

export default async function AboutSettingsPage() {
  await requirePageAdmin();
  const [status, instanceName, lab] = await Promise.all([
    getSystemStatus(),
    getInstanceName(),
    getLabSummary(),
  ]);
  const currentVersion = getCurrentVersion();
  const repository = getGitHubRepository();
  const artStyle = INSTANCE_ART_STYLES[randomInt(INSTANCE_ART_STYLES.length)]!;
  const instanceArt = renderInstanceArt(instanceName, artStyle);
  const artSizeCqw = 96 / (instanceArt.width * 0.62);
  const installType = process.env.POLYSIEM_INSTALL_TYPE ?? "docker";
  const updateCommand =
    installType === "windows-docker"
      ? 'powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\\PolySIEM\\update.ps1"'
      : installType === "native"
        ? `curl -fsSL https://github.com/${repository}/releases/latest/download/install-vm.sh | sudo bash`
        : installType === "docker-source"
          ? `curl -fsSL https://raw.githubusercontent.com/${repository}/master/deploy/install.sh | sudo bash -s -- --source`
          : "sudo /opt/polysiem/update.sh";

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "OS", value: `${instanceName} / PolySIEM Homelab Edition` },
    { label: "Host", value: "Self-hosted infrastructure" },
    { label: "Version", value: `v${currentVersion}` },
    { label: "Install", value: INSTALL_LABELS[installType] ?? installType },
    {
      label: "Kernel",
      value: `Node.js ${process.version.replace(/^v/, "")}`,
    },
    { label: "Uptime", value: formatUptime(process.uptime()) },
    // Lab-wide hardware, aggregated across every connected cluster. Omitted
    // entirely when nothing is hooked up — an empty row beats the wrong host.
    ...(lab ? labFacts(lab) : []),
    { label: "Shell", value: "Next.js 15 App Router" },
    { label: "DE", value: "React 19 + TypeScript" },
    { label: "WM", value: "Tailwind CSS 4 + shadcn/ui" },
    {
      label: "Database",
      value: (
        <span
          className={
            status.database === "connected"
              ? "text-success"
              : "text-destructive"
          }
        >
          PostgreSQL / Prisma 6 —{" "}
          {status.database === "connected" ? "connected" : "unreachable"}
        </span>
      ),
    },
    {
      label: "Integrations",
      value:
        status.integrations === null
          ? "unknown"
          : `${status.integrations} configured`,
    },
    { label: "AI", value: "Ollama or hosted provider (optional)" },
  ];

  // Built once and shared by both presentations — the terminal already
  // degrades to a single column at phone widths.
  const terminal = (
    <section className="relative overflow-hidden rounded-xl border border-primary/20 bg-card font-mono text-[10px] leading-[1.45] shadow-xl shadow-primary/5 no-gpu:shadow-md sm:text-[11px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.025] [background-image:linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:100%_4px]"
        />

        <header className="relative flex h-11 items-center border-b bg-muted/65 px-4">
          <div aria-hidden="true" className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-destructive/80" />
            <span className="size-2.5 rounded-full bg-warning/80" />
            <span className="size-2.5 rounded-full bg-success/80" />
          </div>
          <div className="absolute inset-x-0 flex pointer-events-none items-center justify-center gap-2 text-[10px] text-muted-foreground">
            <AppLogo className="size-3.5 text-primary" />
            polysiem@homelab: ~
          </div>
        </header>

        <div className="relative p-4 sm:p-6">
          <p className="mb-6">
            <span className="font-bold text-primary">polysiem@homelab</span>
            <span className="text-muted-foreground">:</span>
            <span className="font-bold text-chart-2">~</span>
            <span className="text-muted-foreground">$</span> neofetch
          </p>

          <div className="grid items-center gap-7 lg:grid-cols-[minmax(19rem,1fr)_minmax(0,1.15fr)] lg:gap-6">
            <div
              className="flex min-w-0 justify-center lg:justify-start"
              style={{ containerType: "inline-size" }}
            >
              <div
                aria-label={`${instanceName} ASCII logo, ${artStyle.name} style`}
                role="img"
                title={`${artStyle.name} — reload for another style`}
                className={`max-w-full overflow-hidden pb-1 font-bold leading-none tracking-normal [font-variant-ligatures:none] ${artStyle.colorClass}`}
                style={{
                  fontSize: `min(9px, ${artSizeCqw}cqw)`,
                  textShadow: `0 0 18px color-mix(in oklab, ${artStyle.shadowColor} 30%, transparent)`,
                  fontFeatureSettings: '"liga" 0, "calt" 0',
                }}
              >
                <div
                  aria-hidden="true"
                  className="grid w-max"
                  style={{
                    gridTemplateColumns: `repeat(${instanceArt.width}, 1ch)`,
                    gridTemplateRows: "repeat(5, 1.15em)",
                  }}
                >
                  {instanceArt.rows.flatMap((row, rowIndex) =>
                    Array.from(row, (character, columnIndex) => (
                      <span
                        key={`${rowIndex}-${columnIndex}`}
                        className="block h-[1.15em] w-[1ch] text-center"
                      >
                        {character === " " ? "\u00a0" : character}
                      </span>
                    )),
                  )}
                </div>
                <p className="mt-3 max-w-full truncate">{instanceArt.signature}</p>
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-3">
                <p className="font-bold text-primary">polysiem@homelab</p>
                <p className="text-muted-foreground">──────────────────</p>
              </div>
              <dl className="space-y-1.5">
                {facts.map(({ label, value }) => (
                  <Fact key={label} label={label}>
                    {value}
                  </Fact>
                ))}
                <Fact label="Repository">
                  <a
                    href={`https://github.com/${repository}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                  >
                    github.com/{repository}
                    <ExternalLink className="size-3.5" />
                  </a>
                </Fact>
              </dl>

              <div
                aria-label="Current theme palette"
                className="mt-5 flex gap-1.5"
              >
                <span className="h-4 w-8 rounded-sm bg-primary" />
                <span className="h-4 w-8 rounded-sm bg-chart-2" />
                <span className="h-4 w-8 rounded-sm bg-chart-3" />
                <span className="h-4 w-8 rounded-sm bg-chart-4" />
                <span className="h-4 w-8 rounded-sm bg-chart-5" />
                <span className="h-4 w-8 rounded-sm bg-muted-foreground" />
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-dashed border-border pt-5">
            <p className="mb-4">
              <span className="font-bold text-primary">polysiem@homelab</span>
              <span className="text-muted-foreground">:</span>
              <span className="font-bold text-chart-2">~</span>
              <span className="text-muted-foreground">$</span> polysiem update
              --check
            </p>
            <div className="[&_.text-sm]:text-[11px] [&_.text-xs]:text-[10px] [&_button]:h-7 [&_button]:px-2.5 [&_button]:text-[11px]">
              <UpdateCheck
                updateCommand={updateCommand}
                automaticRollback={
                  installType === "docker" || installType === "windows-docker"
                }
              />
            </div>
          </div>

          <div className="mt-7 border-t border-dashed border-border pt-5">
            <BashQuoteBlock />
          </div>

          <p className="mt-7 text-muted-foreground">
            <span className="text-primary">❯</span> <span className="animate-pulse">_</span>
          </p>
        </div>
      </section>
  );

  if (await isMobileView()) {
    return <MobileSettingsSubpage title="About">{terminal}</MobileSettingsSubpage>;
  }

  return (
    <div>
      <PageHeader
        title="About"
        description="System information, but make it unnecessarily terminal."
      />
      {terminal}
    </div>
  );
}
