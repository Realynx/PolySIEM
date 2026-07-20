import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Two-column responsive detail layout: main sections left, facts right. */
export function DetailGrid({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">{main}</div>
      <div className="min-w-0 space-y-6">{side}</div>
    </div>
  );
}

export function SectionCard({
  title,
  count,
  action,
  children,
  flush,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  /** Remove content padding (for full-bleed tables). */
  flush?: boolean;
}) {
  return (
    <Card className={cn(flush && "gap-3 overflow-hidden pb-0")}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            {title}
            {count !== undefined && (
              <Badge variant="secondary" className="tabular-nums">
                {count}
              </Badge>
            )}
          </span>
          {action}
        </CardTitle>
      </CardHeader>
      {flush ? <div className="border-t">{children}</div> : <CardContent>{children}</CardContent>}
    </Card>
  );
}

/** Definition-list style fact rows for the details card. */
export function SpecList({ children }: { children: ReactNode }) {
  return <dl className="divide-y">{children}</dl>;
}

export function SpecItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words">{children ?? "—"}</dd>
    </div>
  );
}

/** Internal entity link used across tables and spec lists. */
export function EntityLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
      {children}
    </Link>
  );
}

export function Muted({ children }: { children?: ReactNode }) {
  if (children == null || children === "") return <span className="text-muted-foreground">—</span>;
  return <>{children}</>;
}
