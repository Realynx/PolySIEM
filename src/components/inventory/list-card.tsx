import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Card shell for list pages: toolbar strip, table body, pagination footer. */
export function ListCard({
  toolbar,
  pagination,
  children,
}: {
  toolbar?: ReactNode;
  pagination?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      {toolbar && <div className="border-b p-4">{toolbar}</div>}
      {children}
      {pagination}
    </Card>
  );
}
