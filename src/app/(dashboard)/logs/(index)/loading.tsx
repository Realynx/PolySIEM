import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function LogsLoading() {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-wrap gap-3">
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-12 w-28" />
            <Skeleton className="h-12 w-36" />
            <Skeleton className="h-12 min-w-48 flex-1" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
        <div className="space-y-2 rounded-lg border p-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
