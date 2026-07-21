import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Card shell for list pages: toolbar strip, table body, pagination footer. */
export function ListCard({
  title,
  description,
  resultCount,
  headerActions,
  toolbar,
  pagination,
  children,
}: {
  title?: string;
  description?: string;
  resultCount?: number;
  headerActions?: ReactNode;
  toolbar?: ReactNode;
  pagination?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden border-0 py-0 ring-1 ring-foreground/10">
      {(title || description || resultCount !== undefined || headerActions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/10 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {resultCount !== undefined && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
                {resultCount.toLocaleString()} {resultCount === 1 ? "result" : "results"}
              </span>
            )}
            {headerActions}
          </div>
        </div>
      )}
      {toolbar && <div className="border-b border-foreground/10 p-4">{toolbar}</div>}
      {children}
      {pagination}
    </Card>
  );
}
