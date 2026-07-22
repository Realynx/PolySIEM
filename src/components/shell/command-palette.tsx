"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { Box, Container, FileText, Globe, Monitor, Network, Server, Settings, Users } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { LAB_SEARCH_REQUEST_EVENT, type LabSearchRequest } from "@/lib/lab-search";
import { NAV_GROUPS } from "./nav";
import type { SearchKind, SearchResult } from "@/lib/types";

const KIND_ICON: Record<SearchKind, typeof Server> = {
  device: Server,
  vm: Monitor,
  container: Container,
  network: Network,
  service: Box,
  doc: FileText,
  ip: Globe,
};

const KIND_LABEL: Record<SearchKind, string> = {
  device: "Hosts",
  vm: "Virtual machines",
  container: "Containers",
  network: "Networks",
  service: "Services",
  doc: "Documentation",
  ip: "IP addresses",
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
}

export function CommandPalette({ open, onOpenChange, isAdmin }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    function onLabSearch(event: Event) {
      const requestedQuery = (event as CustomEvent<LabSearchRequest>).detail?.query;
      if (!requestedQuery) return;
      setQuery(requestedQuery);
      onOpenChange(true);
    }
    window.addEventListener(LAB_SEARCH_REQUEST_EVENT, onLabSearch);
    return () => window.removeEventListener(LAB_SEARCH_REQUEST_EVENT, onLabSearch);
  }, [onOpenChange]);

  const { data: results } = useQuery<SearchResult[]>({
    queryKey: ["palette-search", query],
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const body = await res.json();
      return body.data ?? [];
    },
    enabled: open && query.trim().length >= 2,
    placeholderData: (prev) => prev,
  });

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    pushWithNavigationFeedback(router, href);
  }

  const grouped = (results ?? []).reduce<Partial<Record<SearchKind, SearchResult[]>>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search the lab">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search hosts, VMs, networks, docs…" value={query} onValueChange={setQuery} />
        <CommandList>
        <CommandEmpty>{query.trim().length >= 2 ? "No results found." : "Type at least 2 characters to search."}</CommandEmpty>

        {(Object.entries(grouped) as [SearchKind, SearchResult[]][]).map(([kind, items]) => {
          const Icon = KIND_ICON[kind];
          return (
            <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
              {items.map((item) => (
                <CommandItem key={`${kind}-${item.id}`} value={`${kind}-${item.id}`} onSelect={() => go(item.href)}>
                  <Icon className="size-4" />
                  <span>{item.name}</span>
                  {item.subtitle && <span className="text-xs text-muted-foreground">{item.subtitle}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {query.trim().length < 2 && (
          <>
            <CommandGroup heading="Go to">
              {NAV_GROUPS.flatMap((g) =>
                g.items.filter((item) => isAdmin || !item.adminOnly).map((item) => ({ ...item, group: g.title })),
              ).map((item) => (
                <CommandItem key={item.href} value={`nav-${item.href}`} onSelect={() => go(item.href)}>
                  <item.icon className="size-4" />
                  <span>{item.title}</span>
                  {item.group && <span className="text-xs text-muted-foreground">{item.group}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Settings">
              <CommandItem value="nav-settings-profile" onSelect={() => go("/settings/profile")}>
                <Settings className="size-4" /> Profile settings
              </CommandItem>
              {isAdmin && (
                <CommandItem value="nav-settings-users" onSelect={() => go("/settings/users")}>
                  <Users className="size-4" /> Manage users
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
