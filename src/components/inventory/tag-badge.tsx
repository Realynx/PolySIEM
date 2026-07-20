import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The 9 tag colors allowed by tagSchema, mapped to static Tailwind classes. */
export const TAG_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "emerald",
  "blue",
  "violet",
  "rose",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_DOT_CLASS: Record<TagColor, string> = {
  gray: "bg-gray-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
};

const TAG_BADGE_CLASS: Record<TagColor, string> = {
  gray: "border-border bg-muted text-muted-foreground",
  red: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  orange: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  green: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function asTagColor(color: string): TagColor {
  return (TAG_COLORS as readonly string[]).includes(color) ? (color as TagColor) : "gray";
}

export function TagDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", TAG_DOT_CLASS[asTagColor(color)], className)} />;
}

export function TagBadge({
  name,
  color,
  className,
  children,
}: {
  name: string;
  color: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1", TAG_BADGE_CLASS[asTagColor(color)], className)}>
      <TagDot color={color} className="size-1.5" />
      {name}
      {children}
    </Badge>
  );
}

/** Compact tag list for table cells: first 3 badges + “+n”. */
export function TagList({ tags }: { tags: { tag: { id: string; name: string; color: string } }[] }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = tags.slice(0, 3);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map(({ tag }) => (
        <TagBadge key={tag.id} name={tag.name} color={tag.color} />
      ))}
      {tags.length > 3 && (
        <span className="text-xs text-muted-foreground">+{tags.length - 3}</span>
      )}
    </span>
  );
}
