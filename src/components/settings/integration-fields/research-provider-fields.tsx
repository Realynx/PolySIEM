import { ShieldCheck } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { IntegrationFieldsProps } from "./types";

export function ResearchProviderFields({ form, set }: IntegrationFieldsProps) {
  switch (form.type) {
    case "CENSYS":
      return (
        <DailyLookupLimit
          id="censys-ai-limit"
          value={form.censysAiDailyCallLimit}
          description="Cache hits are free and always allowed. Set this to 0 to make AI and MCP cache-only; workflow lookups remain cache-first but are not counted in this AI budget."
          ariaLabel="Maximum Censys AI and MCP live lookups per rolling 24 hours"
          onChange={(value) => set("censysAiDailyCallLimit", value)}
        />
      );
    case "SECURITYTRAILS":
      return (
        <DailyLookupLimit
          id="securitytrails-ai-limit"
          value={form.securityTrailsAiDailyCallLimit}
          description="Cache hits stay available. Set this to 0 for cache-only AI and MCP access; administrator-run and workflow behavior remains governed separately."
          ariaLabel="Maximum SecurityTrails AI and MCP live lookups per rolling 24 hours"
          onChange={(value) => set("securityTrailsAiDailyCallLimit", value)}
        >
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <span>SecurityTrails documents its API as read-only. This connection cannot change SecurityTrails data.</span>
          </div>
        </DailyLookupLimit>
      );
    default:
      return null;
  }
}

function DailyLookupLimit({
  id,
  value,
  description,
  ariaLabel,
  onChange,
  children,
}: {
  id: string;
  value: number;
  description: string;
  ariaLabel: string;
  onChange: (value: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id}>Maximum live AI/MCP lookups per rolling 24 hours</Label>
          <span className="min-w-10 rounded-md bg-muted px-2 py-1 text-center text-sm font-medium tabular-nums">{value}</span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Slider
        id={id}
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={([nextValue]) => onChange(nextValue ?? 0)}
        aria-label={ariaLabel}
      />
      {children}
    </div>
  );
}
