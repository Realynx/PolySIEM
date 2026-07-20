import type { ReactNode } from "react";
import { formatBytes } from "@/lib/format";
import { PowerBadge } from "@/components/shared/badges";
import type { InterfaceRow } from "@/components/inventory/sub-tables";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";

/** Padded card for free-form content (editors, pickers) on phone screens. */
export function MobileCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border bg-card px-3.5 py-3">{children}</div>;
}

/** Muted placeholder row inside a MobileList when nothing is documented. */
export function MobileSubEmpty({ label }: { label: string }) {
  return <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">{label}</p>;
}

// ---------------- guests (VMs / containers) ----------------

interface GuestRow {
  id: string;
  name: string;
  powerState: "RUNNING" | "STOPPED" | "PAUSED" | "UNKNOWN";
  cpuCores: number | null;
  memoryBytes: bigint | null;
  osName?: string | null;
}

/** Phone stand-in for the desktop GuestsTable: tappable two-line rows. */
export function MobileGuestList({ rows, hrefBase }: { rows: GuestRow[]; hrefBase: string }) {
  return (
    <MobileList>
      {rows.length === 0 ? (
        <MobileSubEmpty label="Nothing documented here yet." />
      ) : (
        rows.map((row) => {
          const specs = [
            row.cpuCores != null ? `${row.cpuCores} vCPU` : null,
            row.memoryBytes != null ? formatBytes(row.memoryBytes) : null,
            row.osName ?? null,
          ].filter(Boolean);
          return (
            <MobileListRow
              key={row.id}
              href={`${hrefBase}/${row.id}`}
              title={row.name}
              subtitle={specs.length > 0 ? specs.join(" · ") : undefined}
              trailing={<PowerBadge state={row.powerState} className="text-xs" />}
            />
          );
        })
      )}
    </MobileList>
  );
}

// ---------------- network interfaces ----------------

/** Phone stand-in for InterfacesTable; rows link to the interface's network. */
export function MobileInterfaceList({ rows }: { rows: InterfaceRow[] }) {
  return (
    <MobileList>
      {rows.length === 0 ? (
        <MobileSubEmpty label="No network interfaces documented." />
      ) : (
        rows.map((iface) => {
          const meta = [iface.macAddress, iface.network?.name].filter(Boolean);
          return (
            <MobileListRow
              key={iface.id}
              href={iface.network ? `/network/${iface.network.id}` : undefined}
              title={<span className="font-mono text-[13px]">{iface.name}</span>}
              subtitle={
                meta.length > 0 ? <span className="font-mono">{meta.join(" · ")}</span> : undefined
              }
              trailing={
                iface.ip ? (
                  <span className="font-mono">{iface.ip.address}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
          );
        })
      )}
    </MobileList>
  );
}

// ---------------- services ----------------

interface ServiceRow {
  id: string;
  name: string;
  url: string | null;
  port: number | null;
  protocol: string | null;
}

/** Phone stand-in for ServicesTable: rows navigate to the service detail. */
export function MobileServiceList({ rows }: { rows: ServiceRow[] }) {
  return (
    <MobileList>
      {rows.length === 0 ? (
        <MobileSubEmpty label="No services documented." />
      ) : (
        rows.map((svc) => (
          <MobileListRow
            key={svc.id}
            href={`/inventory/services/${svc.id}`}
            title={svc.name}
            subtitle={svc.url ? svc.url.replace(/^https?:\/\//, "") : undefined}
            trailing={
              svc.port != null ? (
                <span>
                  {svc.port}
                  {svc.protocol && <span className="text-muted-foreground">/{svc.protocol}</span>}
                </span>
              ) : undefined
            }
          />
        ))
      )}
    </MobileList>
  );
}

// ---------------- storage pools ----------------

interface PoolRow {
  id: string;
  name: string;
  type: string | null;
  totalBytes: bigint | null;
  usedBytes: bigint | null;
}

/** Phone stand-in for PoolsTable: used / total trailing per pool. */
export function MobilePoolList({ rows }: { rows: PoolRow[] }) {
  return (
    <MobileList>
      {rows.length === 0 ? (
        <MobileSubEmpty label="No storage pools documented." />
      ) : (
        rows.map((pool) => (
          <MobileListRow
            key={pool.id}
            title={pool.name}
            subtitle={pool.type ? <span className="uppercase">{pool.type}</span> : undefined}
            trailing={
              <span>
                {formatBytes(pool.usedBytes)}
                <span className="text-muted-foreground"> / {formatBytes(pool.totalBytes)}</span>
              </span>
            }
          />
        ))
      )}
    </MobileList>
  );
}
