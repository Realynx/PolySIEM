import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="hidden h-4 w-32 md:block" />
            <Skeleton className="hidden h-4 w-20 lg:block" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <div>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-8">
        <section>
          <Skeleton className="mb-3 h-4 w-36" />
          <TableSkeleton rows={4} />
        </section>
        <section>
          <Skeleton className="mb-3 h-4 w-28" />
          <TableSkeleton rows={3} />
        </section>
      </div>
    </div>
  );
}
