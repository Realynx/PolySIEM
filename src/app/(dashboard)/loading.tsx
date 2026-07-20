import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/*
 * Mirrors the dashboard's real layout section-for-section (header, stat tiles,
 * footprint map, integrations, storage) and reuses the same Card wrappers, so
 * the placeholders occupy the same boxes the loaded content will. Keep this in
 * step with page.tsx when sections are added, reordered, or resized.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader */}
      <div className="mb-6 flex flex-col gap-4">
        <div className="space-y-1">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-5 w-full max-w-md" />
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="h-full gap-2 py-3">
            <CardContent className="flex items-center gap-3 px-4">
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-5 w-8" />
                <Skeleton className="h-3 w-14" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Footprint map — same height as FootprintMap's own wrapper */}
      <Skeleton className="h-[clamp(600px,72vh,820px)] w-full rounded-xl" />

      {/* Integration health */}
      <section>
        <Skeleton className="mb-3 h-5 w-28" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="gap-3 py-4">
              <CardHeader className="flex flex-row items-center gap-3 space-y-0 px-4">
                <Skeleton className="size-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2 px-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Storage strip */}
      <section>
        <Skeleton className="mb-3 h-5 w-20" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="gap-2 py-4">
              <CardContent className="space-y-2 px-4">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-1 w-full rounded-full" />
                <Skeleton className="h-4 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
