import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Traffic Light Protocol sharing markings. TLP 2.0 renamed "white" to
 * "clear" — both spellings appear in OTX pulses and share a style.
 */
const TLP_STYLES: Record<string, string> = {
  white: "border-border bg-muted text-muted-foreground",
  clear: "border-border bg-muted text-muted-foreground",
  green: "border-success/40 bg-success/10 text-success",
  amber: "border-warning/40 bg-warning/10 text-warning",
  "amber+strict": "border-warning/40 bg-warning/10 text-warning",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** TLP marking badge — always carries the marking as text, never color alone. */
export function TlpBadge({ tlp, className }: { tlp: string; className?: string }) {
  const style = TLP_STYLES[tlp.toLowerCase()] ?? TLP_STYLES.white;
  return (
    <Badge variant="outline" className={cn("font-mono uppercase", style, className)}>
      TLP:{tlp}
    </Badge>
  );
}
