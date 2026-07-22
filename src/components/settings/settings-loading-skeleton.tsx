import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type SettingsSkeletonSection =
  | "about"
  | "ai"
  | "api-tokens"
  | "appearance"
  | "backup"
  | "certificate"
  | "danger"
  | "index"
  | "integrations"
  | "privacy"
  | "profile"
  | "system"
  | "users";

function SettingsHeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <>
      <div className="mb-5 flex items-center gap-3 md:hidden">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="h-6 w-40" />
        {action && <Skeleton className="ml-auto size-9 rounded-full" />}
      </div>
      <div className="mb-6 hidden items-start justify-between gap-3 md:flex">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-44 max-w-2/3" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        {action && <Skeleton className="h-9 w-32 shrink-0" />}
      </div>
    </>
  );
}

function FormCardSkeleton({ height = "h-56" }: { height?: string }) {
  return (
    <Card className={`space-y-5 p-6 ${height}`}>
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
      <Skeleton className="h-9 w-24" />
    </Card>
  );
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="flex gap-4 border-b px-4 py-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-4 min-w-12 flex-1" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 min-w-16 flex-1" />
            <Skeleton className="hidden h-5 w-20 sm:block" />
            <Skeleton className="hidden h-4 w-24 lg:block" />
            <Skeleton className="ml-auto size-7" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsIndexSkeleton() {
  return (
    <>
      <div className="hidden md:block">
        <SettingsHeaderSkeleton />
        <div className="space-y-6">
          <FormCardSkeleton height="h-48" />
          <FormCardSkeleton height="h-72" />
          <FormCardSkeleton height="h-52" />
        </div>
      </div>
      <div className="space-y-6 md:hidden">
        <Skeleton className="h-8 w-36" />
        {Array.from({ length: 3 }, (_, group) => (
          <section key={group} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Card className="divide-y overflow-hidden py-0">
              {Array.from({ length: group === 1 ? 5 : 3 }, (_, row) => (
                <div key={row} className="flex items-center gap-3 px-4 py-3.5">
                  <Skeleton className="size-8 rounded-lg" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="ml-auto size-4" />
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}

export function SettingsContentSkeleton({ section }: { section: SettingsSkeletonSection }) {
  if (section === "index") return <SettingsIndexSkeleton />;

  if (section === "about") {
    return (
      <div>
        <SettingsHeaderSkeleton />
        <Skeleton className="h-[42rem] w-full rounded-xl" />
      </div>
    );
  }

  if (section === "api-tokens" || section === "users") {
    return (
      <div>
        <SettingsHeaderSkeleton action />
        {section === "api-tokens" && <Skeleton className="mb-6 h-28 w-full rounded-xl" />}
        <TableSkeleton />
      </div>
    );
  }

  if (section === "integrations") {
    return (
      <div>
        <SettingsHeaderSkeleton action />
        <Skeleton className="mb-6 h-52 w-full rounded-xl" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  if (section === "danger") {
    return (
      <div>
        <SettingsHeaderSkeleton />
        <Skeleton className="mb-4 h-40 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (section === "backup") {
    return (
      <div className="space-y-8">
        <SettingsHeaderSkeleton />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-4 w-80" /></div>
            <Skeleton className="h-9 w-36" />
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </section>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const cardHeights: Record<Exclude<SettingsSkeletonSection, "about" | "api-tokens" | "backup" | "danger" | "index" | "integrations" | "users">, string[]> = {
    ai: ["h-72", "h-64"],
    appearance: ["h-44", "h-32", "h-40"],
    certificate: ["h-36", "h-64", "h-72"],
    privacy: ["h-32", "h-48", "h-36"],
    profile: ["h-48", "h-72", "h-52"],
    system: ["h-80"],
  };

  return (
    <div>
      <SettingsHeaderSkeleton />
      <div className="space-y-6">
        {cardHeights[section].map((height, index) => (
          <FormCardSkeleton key={index} height={height} />
        ))}
      </div>
    </div>
  );
}

function sectionFromPathname(pathname: string): SettingsSkeletonSection {
  const segment = pathname.split("/")[2];
  const sections: SettingsSkeletonSection[] = [
    "about", "ai", "api-tokens", "appearance", "backup", "certificate", "danger",
    "integrations", "privacy", "profile", "system", "users",
  ];
  return sections.includes(segment as SettingsSkeletonSection)
    ? (segment as SettingsSkeletonSection)
    : "index";
}

/** Full Settings frame used by the instant, root-level navigation overlay. */
export function SettingsRouteSkeleton({ pathname }: { pathname: string }) {
  const section = sectionFromPathname(pathname);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 md:flex-row md:gap-10" aria-hidden="true">
      <aside className="hidden w-44 shrink-0 space-y-5 md:block">
        <Skeleton className="h-5 w-24" />
        {Array.from({ length: 3 }, (_, group) => (
          <div key={group} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: group === 1 ? 5 : 3 }, (_, row) => (
              <Skeleton key={row} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1">
        <SettingsContentSkeleton section={section} />
      </div>
    </div>
  );
}
