"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Laptop, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { THEME_COLORS, type ThemeColor, type ThemeMode } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/components/shared/api-client";

const SWATCHES: Record<ThemeColor, { label: string; className: string }> = {
  blue: { label: "Blue", className: "bg-blue-600" },
  emerald: { label: "Emerald", className: "bg-emerald-600" },
  violet: { label: "Violet", className: "bg-violet-600" },
  amber: { label: "Amber", className: "bg-amber-500" },
  rose: { label: "Rose", className: "bg-rose-600" },
};

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
];

export function AppearanceForm({ initialColor }: { initialColor: ThemeColor }) {
  const { theme, setTheme } = useTheme();
  const [color, setColor] = useState<ThemeColor>(initialColor);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function pickColor(next: ThemeColor) {
    const previous = color;
    setColor(next);
    document.documentElement.dataset.theme = next; // live preview
    try {
      await apiFetch("/api/me", { method: "PATCH", body: JSON.stringify({ themeColor: next }) });
      toast.success(`Theme color set to ${SWATCHES[next].label.toLowerCase()}`);
    } catch (err) {
      setColor(previous);
      document.documentElement.dataset.theme = previous;
      toast.error(err instanceof Error ? err.message : "Failed to save theme color");
    }
  }

  async function pickMode(next: ThemeMode) {
    setTheme(next);
    try {
      await apiFetch("/api/me", { method: "PATCH", body: JSON.stringify({ themeMode: next }) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save theme mode");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Accent color</CardTitle>
          <CardDescription>Applied instantly across the whole dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {THEME_COLORS.map((c) => {
              const active = color === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickColor(c)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    active && "border-primary ring-2 ring-primary/30",
                  )}
                >
                  <span
                    className={cn(
                      "relative flex size-10 items-center justify-center rounded-full",
                      SWATCHES[c].className,
                    )}
                  >
                    {active && <Check className="size-5 text-white" />}
                  </span>
                  <span className="text-sm font-medium">{SWATCHES[c].label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mode</CardTitle>
          <CardDescription>Light, dark, or follow your operating system.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="inline-flex rounded-lg border bg-muted p-1" role="radiogroup" aria-label="Theme mode">
            {MODES.map((m) => {
              const active = mounted && theme === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => pickMode(m.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <m.icon className="size-4" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>A sample of the current theme.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-background p-4">
            <Button size="sm">Primary action</Button>
            <Button size="sm" variant="outline">
              Secondary
            </Button>
            <Badge>Badge</Badge>
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
              Accent badge
            </Badge>
            <p className="text-sm">
              Body text with a <span className="font-medium text-primary">primary highlight</span> and{" "}
              <span className="text-muted-foreground">muted text</span>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
