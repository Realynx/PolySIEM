import { isPrivateAddress } from "@/lib/topology/access";

export const LAB_SEARCH_REQUEST_EVENT = "polysiem:lab-search";

export interface LabSearchRequest {
  query: string;
}

/** Open the global lab-search palette with a query already entered. */
export function requestLabSearch(query: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LabSearchRequest>(LAB_SEARCH_REQUEST_EVENT, {
      detail: { query: query.trim() },
    }),
  );
}

/** Private, loopback, link-local, and CGNAT addresses belong to the local lab. */
export function isLocalIpAddress(value: string): boolean {
  const address = value.trim().split("/")[0]?.split("%")[0]?.toLowerCase() ?? "";
  if (isPrivateAddress(address)) return true;

  // IPv6 loopback/unspecified, unique-local (fc00::/7), and link-local (fe80::/10).
  if (address === "::" || address === "::1") return true;
  if (!address.includes(":")) return false;
  const firstHextet = Number.parseInt(address.split(":", 1)[0] ?? "", 16);
  if (!Number.isFinite(firstHextet)) return false;
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}
