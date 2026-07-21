"use client";

import Link from "next/link";
import { FileSearch, Search } from "lucide-react";
import { CopyButton } from "@/components/ssh/copy-button";
import { Badge } from "@/components/ui/badge";
import { isLocalIpAddress, requestLabSearch } from "@/lib/lab-search";
import { cn } from "@/lib/utils";

/** An IP indicator that searches local addresses, researches public ones, and always supports copying. */
export function TicketIpIndicator({ value, compact = false }: { value: string; compact?: boolean }) {
  const local = isLocalIpAddress(value);
  const label = local ? `Search the lab for ${value}` : `Research ${value}`;
  const content = (
    <>
      <span className={cn(compact && "truncate")}>{value}</span>
      {local ? <Search className="size-3 shrink-0" /> : <FileSearch className="size-3 shrink-0" />}
    </>
  );

  return (
    <span className={cn("inline-flex items-center gap-0.5", compact && "max-w-full")}>
      {local ? (
        <Badge variant="secondary" className={cn("font-mono text-xs", compact && "max-w-full")} asChild>
          <button type="button" title={label} aria-label={label} onClick={() => requestLabSearch(value)}>
            {content}
          </button>
        </Badge>
      ) : (
        <Badge variant="secondary" className={cn("font-mono text-xs", compact && "max-w-full")} asChild>
          <Link href={`/security/research?subject=${encodeURIComponent(value)}`} title={label} aria-label={label}>
            {content}
          </Link>
        </Badge>
      )}
      <CopyButton value={value} label={`Copy ${value}`} className="size-5 shrink-0" />
    </span>
  );
}
