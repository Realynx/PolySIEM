"use client";

import { useState } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Collapsible raw running-config viewer. */
export function RawConfig({ rawConfig }: { rawConfig: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="py-3">
      <CardContent className="px-3">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <FileCode2 className="size-4" />
              Raw configuration
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre">
              {rawConfig}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
