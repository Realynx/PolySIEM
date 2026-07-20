import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/badges";
import type { SsidRow } from "@/components/wifi/ssid-table";
import type { ApRow } from "@/components/wifi/ap-table";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { cn } from "@/lib/utils";

/** Compact label + tone for an SSID's security mode (mirrors the desktop table). */
function securityInfo(
  security: string | null,
  wpaMode: string | null,
): { label: string; className: string } | null {
  switch (security) {
    case "open":
      return { label: "Open", className: "border-warning/40 bg-warning/10 text-warning" };
    case "wpapsk":
    case "wpa-psk": {
      const label =
        wpaMode === "wpa3" ? "WPA3" : wpaMode === "wpa3-transition" ? "WPA2/3" : "WPA2";
      return { label, className: "border-success/40 bg-success/10 text-success" };
    }
    case "wpaeap":
    case "wpa-enterprise":
      return { label: "Enterprise", className: "border-info/40 bg-info/10 text-info" };
    default:
      return null;
  }
}

function bandLabel(band: string | null): string | null {
  switch (band) {
    case "both":
      return "2.4 + 5 GHz";
    case "2g":
      return "2.4 GHz";
    case "5g":
      return "5 GHz";
    case "6e":
      return "6 GHz";
    default:
      return null;
  }
}

/** Phone WiFi inventory: SSIDs then access points as touch rows. */
export function MobileWifi({ ssids, aps }: { ssids: SsidRow[]; aps: ApRow[] }) {
  return (
    <>
      <MobilePageHeader title="WiFi" />
      <MobilePage>
        <MobileSection title={`Networks · ${ssids.length}`}>
          {ssids.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              No wireless networks documented yet.
            </p>
          ) : (
            <MobileList>
              {ssids.map((ssid) => {
                const security = securityInfo(ssid.security, ssid.wpaMode);
                const band = bandLabel(ssid.band);
                const vlanNetwork = ssid.network
                  ? `${ssid.vlanId != null ? `VLAN ${ssid.vlanId} · ` : ""}${ssid.network.name}`
                  : ssid.vlanId != null
                    ? `VLAN ${ssid.vlanId}`
                    : "untagged";
                return (
                  <MobileListRow
                    key={ssid.id}
                    className={cn(!ssid.enabled && "opacity-60")}
                    href={ssid.network ? `/network/${ssid.network.id}` : undefined}
                    title={
                      <>
                        <span className="truncate">{ssid.name}</span>
                        {security && (
                          <Badge variant="outline" className={cn("text-[10px]", security.className)}>
                            {security.label}
                          </Badge>
                        )}
                        {ssid.hidden && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            Hidden
                          </Badge>
                        )}
                        {ssid.isGuest && (
                          <Badge variant="outline" className="border-info/40 bg-info/10 text-[10px] text-info">
                            Guest
                          </Badge>
                        )}
                        {!ssid.enabled && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            Disabled
                          </Badge>
                        )}
                        <StatusBadge status={ssid.status} className="text-[10px]" />
                      </>
                    }
                    subtitle={[band, vlanNetwork].filter(Boolean).join(" · ")}
                    trailing={
                      ssid.apCount != null ? (
                        <span>
                          {ssid.apCount} {ssid.apCount === 1 ? "AP" : "APs"}
                        </span>
                      ) : undefined
                    }
                  />
                );
              })}
            </MobileList>
          )}
        </MobileSection>

        <MobileSection title={`Access points · ${aps.length}`}>
          {aps.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              No access points documented yet.
            </p>
          ) : (
            <MobileList>
              {aps.map((ap) => (
                <MobileListRow
                  key={ap.id}
                  href={ap.device ? `/inventory/hosts/${ap.device.id}` : undefined}
                  leading={
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        ap.state === "online"
                          ? "bg-success"
                          : ap.state === "pending"
                            ? "bg-warning"
                            : "bg-muted-foreground/50",
                      )}
                      aria-label={ap.state ?? "unknown"}
                    />
                  }
                  title={
                    <>
                      <span className="truncate">{ap.name}</span>
                      {!ap.adopted && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Not adopted
                        </Badge>
                      )}
                      <StatusBadge status={ap.status} className="text-[10px]" />
                    </>
                  }
                  subtitle={
                    <>
                      {ap.model ?? "Unknown model"}
                      {ap.ipAddress && <span className="font-mono"> · {ap.ipAddress}</span>}
                    </>
                  }
                  trailing={<span>{formatRelative(ap.lastSeenAt)}</span>}
                />
              ))}
            </MobileList>
          )}
        </MobileSection>
      </MobilePage>
    </>
  );
}
