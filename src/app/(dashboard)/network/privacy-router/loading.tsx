import { Skeleton } from "@/components/ui/skeleton";

export default function PrivacyRouterLoading() {
  return (
    <div className="space-y-6" aria-label="Loading the privacy router">
      <div className="space-y-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
