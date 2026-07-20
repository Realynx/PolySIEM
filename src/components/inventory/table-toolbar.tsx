"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

/**
 * URL-synced list filters: debounced text search and an optional source
 * selector. Server components re-query when the URL changes.
 */
export function TableToolbar({
  searchPlaceholder = "Filter by name…",
  showSource = true,
  children,
}: {
  searchPlaceholder?: string;
  showSource?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local state in sync when the URL changes externally (back button).
  useEffect(() => setQ(urlQ), [urlQ]);

  const apply = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page"); // filters reset pagination
    router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, { scroll: false });
  };

  const onSearch = (value: string) => {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply({ q: value }), 300);
  };

  const source = searchParams.get("source") ?? ALL;
  const hasFilters = urlQ !== "" || source !== ALL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 pl-8"
          aria-label="Filter"
        />
      </div>
      {showSource && (
        <Select value={source} onValueChange={(v) => apply({ source: v === ALL ? null : v })}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by source">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sources</SelectItem>
            <SelectItem value="MANUAL">Manual</SelectItem>
            <SelectItem value="PROXMOX">Proxmox</SelectItem>
            <SelectItem value="OPNSENSE">OPNsense</SelectItem>
            <SelectItem value="UNIFI">UniFi</SelectItem>
            <SelectItem value="CLOUDFLARE">Cloudflare</SelectItem>
            <SelectItem value="TAILSCALE">Tailscale</SelectItem>
            <SelectItem value="EDGE_NAT_SERVER">Edge NAT</SelectItem>
          </SelectContent>
        </Select>
      )}
      {children}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => apply({ q: null, source: null })}>
          <X data-icon="inline-start" />
          Clear
        </Button>
      )}
    </div>
  );
}
