import { randomInt } from "node:crypto";
import { ExternalLink } from "lucide-react";
import { requirePageAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { AppLogo } from "@/components/shell/app-logo";
import { UpdateCheck } from "@/components/settings/update-check";
import { getInstanceName } from "@/lib/settings";
import { getCurrentVersion, getGitHubRepository } from "@/lib/updates/release";

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
  const [status, instanceName] = await Promise.all([
    getSystemStatus(),
    getInstanceName(),
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
          ? `curl -fsSL https://raw.githubusercontent.com/${repository}/main/deploy/install.sh | sudo bash -s -- --source`
          : "sudo /opt/polysiem/update.sh";

  const facts = [
    ["OS", `${instanceName} / PolySIEM Homelab Edition`],
    ["Host", "Self-hosted infrastructure"],
    ["Version", `v${currentVersion}`],
    ["Install", INSTALL_LABELS[installType] ?? installType],
    ["Kernel", `Node.js ${process.version.replace(/^v/, "")}`],
    ["Uptime", formatUptime(process.uptime())],
    ["Shell", "Next.js 15 App Router"],
    ["DE", "React 19 + TypeScript"],
    ["WM", "Tailwind CSS 4 + shadcn/ui"],
    [
      "Database",
      status.database === "connected"
        ? "PostgreSQL / Prisma 6 — connected"
        : "PostgreSQL / Prisma 6 — unreachable",
    ],
    [
      "Integrations",
      status.integrations === null
        ? "unknown"
        : `${status.integrations} configured`,
    ],
    ["AI", "Ollama or hosted provider (optional)"],
  ] as const;

  return (
    <div>
      <PageHeader
        title="About"
        description="System information, but make it unnecessarily terminal."
      />

      <section className="relative overflow-hidden rounded-xl border border-primary/20 bg-card font-mono text-[10px] leading-[1.45] shadow-xl shadow-primary/5 sm:text-[11px]">
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
                {facts.map(([label, value]) => (
                  <Fact key={label} label={label}>
                    <span
                      className={
                        label === "Database"
                          ? status.database === "connected"
                            ? "text-success"
                            : "text-destructive"
                          : undefined
                      }
                    >
                      {value}
                    </span>
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
            <p className="mb-3">
              <span className="font-bold text-primary">polysiem@homelab</span>
              <span className="text-muted-foreground">:</span>
              <span className="font-bold text-chart-2">~</span>
              <span className="text-muted-foreground">$</span> cat
              ~/.polysiem/roadmap
            </p>
            <div className="space-y-1.5">
              <p>
                <span className="text-success">[✓]</span> backups &amp; export
                <span className="text-muted-foreground"> # shipped</span>
              </p>
              <p>
                <span className="text-warning">[ ]</span> active network
                discovery
                <span className="text-muted-foreground">
                  {" "}# scanner VM is still compiling excuses
                </span>
              </p>
              <p>
                <span className="text-primary">[~]</span> more integrations
                <span className="text-muted-foreground">
                  {" "}# the homelab is never truly finished
                </span>
              </p>
            </div>
          </div>

          <p className="mt-7 text-muted-foreground">
            <span className="text-primary">❯</span> <span className="animate-pulse">_</span>
          </p>
        </div>
      </section>
    </div>
  );
}
