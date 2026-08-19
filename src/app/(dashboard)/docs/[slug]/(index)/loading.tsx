import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <Skeleton className="mb-4 h-4 w-64" />
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 pt-6">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-2/3" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 pt-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
