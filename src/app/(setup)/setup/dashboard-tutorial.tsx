import {
  Activity,
  Box,
  Container,
  LayoutDashboard,
  Network,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const DASHBOARD_TOUR_SLIDES = [
  {
    title: "Your lab at a glance",
    description:
      "The dashboard summarizes inventory, health, and recent activity. These numbers are a preview only.",
    focus: "summary",
  },
  {
    title: "Follow the network path",
    description:
      "The topology starts at the gateway and follows networks, hosts, and workloads. Select a node to trace its connected circuit.",
    focus: "topology",
  },
  {
    title: "Investigate and document",
    description:
      "Open inventory details, review security activity, or ask the AI assistant to correlate what PolySIEM knows.",
    focus: "actions",
  },
] as const;

export function DashboardTutorialPreview({ slide }: { slide: number }) {
  const current = DASHBOARD_TOUR_SLIDES[slide] ?? DASHBOARD_TOUR_SLIDES[0];

  return (
    <div className="space-y-4">
      <div
        className="overflow-hidden rounded-xl border bg-background shadow-sm"
        aria-label="Mock dashboard preview"
      >
        <div className="grid min-h-[390px] grid-cols-[68px_1fr] sm:grid-cols-[150px_1fr]">
          <aside className="border-r bg-muted/35 p-3">
            <div className="mb-5 flex items-center gap-2 font-semibold">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Network className="size-4" />
              </div>
              <span className="hidden text-sm sm:inline">PolySIEM</span>
            </div>
            <div className="space-y-1.5 text-xs">
              {[
                [LayoutDashboard, "Dashboard"],
                [Server, "Inventory"],
                [Network, "Network"],
                [ShieldCheck, "Security"],
                [Sparkles, "AI assistant"],
              ].map(([Icon, label], index) => (
                <div
                  key={label as string}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-2 text-muted-foreground",
                    (index === 0 || (current.focus === "actions" && index >= 3)) &&
                      "bg-primary/10 font-medium text-primary",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="hidden sm:inline">{label as string}</span>
                </div>
              ))}
            </div>
          </aside>

          <div className="min-w-0 p-3 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-semibold">Dashboard</p>
                <p className="text-[11px] text-muted-foreground">Demo lab · mock preview</p>
              </div>
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Activity className="size-4" />
              </div>
            </div>

            <div
              className={cn(
                "grid grid-cols-2 gap-2 rounded-lg transition-all sm:grid-cols-4",
                current.focus === "summary" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            >
              {[
                [Server, "Hosts", "5"],
                [Box, "Virtual machines", "4"],
                [Container, "Containers", "44"],
                [ShieldCheck, "Open issues", "2"],
              ].map(([Icon, label, value]) => (
                <div key={label as string} className="rounded-lg border bg-card p-2.5">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="text-[10px]">{label as string}</span>
                    <Icon className="size-3.5" />
                  </div>
                  <p className="mt-1 text-xl font-semibold">{value as string}</p>
                </div>
              ))}
            </div>

            <div
              className={cn(
                "relative mt-3 h-[205px] overflow-hidden rounded-lg border bg-muted/20 transition-all",
                current.focus === "topology" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            >
              <div className="absolute inset-x-0 top-2 text-center text-[10px] font-medium text-muted-foreground">
                Network topology
              </div>
              <div className="absolute left-1/2 top-8 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-[10px] font-medium shadow-sm">
                Gateway
              </div>
              <div className="absolute left-1/2 top-[65px] h-5 w-px -translate-x-1/2 bg-primary/60" />
              <div className="absolute left-[25%] right-[25%] top-[84px] h-px bg-primary/60" />
              <div className="absolute left-[25%] top-[84px] h-5 w-px bg-primary/60" />
              <div className="absolute right-[25%] top-[84px] h-5 w-px bg-primary/60" />
              <div className="absolute left-[25%] top-[102px] -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-[10px] shadow-sm">
                Servers VLAN
              </div>
              <div className="absolute right-[25%] top-[102px] translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-[10px] shadow-sm">
                Services VLAN
              </div>
              <div className="absolute left-[25%] top-[133px] h-4 w-px bg-border" />
              <div className="absolute right-[25%] top-[133px] h-4 w-px bg-border" />
              <div className="absolute bottom-5 left-[25%] -translate-x-1/2 rounded-md border bg-card px-2.5 py-1.5 text-[10px] shadow-sm">
                pve-01 · 18 guests
              </div>
              <div className="absolute bottom-5 right-[25%] translate-x-1/2 rounded-md border bg-card px-2.5 py-1.5 text-[10px] shadow-sm">
                cloudflared
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
        <p className="font-medium">{current.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
      </div>
    </div>
  );
}
