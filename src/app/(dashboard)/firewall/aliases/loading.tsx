import { Skeleton } from "@/components/ui/skeleton";

export default function FirewallAliasesLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </div>
  );
}
