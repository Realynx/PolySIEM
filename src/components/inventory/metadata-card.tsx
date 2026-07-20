import { ChevronsUpDown, Braces } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Collapsible raw-JSON view of an entity's integration metadata. */
export function MetadataCard({ metadata }: { metadata: unknown }) {
  if (metadata == null) return null;
  return (
    <Card>
      <Collapsible>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Braces className="size-4 text-muted-foreground" />
              Raw metadata
            </span>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Toggle raw metadata">
                <ChevronsUpDown />
              </Button>
            </CollapsibleTrigger>
          </CardTitle>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
