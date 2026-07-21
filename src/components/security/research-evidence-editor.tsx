"use client";

import { useMemo, useState } from "react";
import { Braces, FileText, Link2, Search } from "lucide-react";
import { MarkdownEditor } from "@/components/docs/markdown-editor";
import { Markdown } from "@/components/docs/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { expandEvidenceReferences, type ResearchEvidenceReference } from "@/lib/security/research-evidence-links";

function EvidencePicker({
  evidence,
  onInsert,
  disabled,
}: {
  evidence: ResearchEvidenceReference[];
  onInsert: (text: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return evidence;
    return evidence.filter((item) =>
      [item.title, item.summary, item.provider, item.kind].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [evidence, query]);

  const insert = (item: ResearchEvidenceReference, embed: boolean) => {
    onInsert(`${embed ? "!" : ""}[[evidence:${item.id}|${item.title}]]`);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={disabled || evidence.length === 0}>
          <Braces className="size-4" /> Evidence
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search captured evidence…"
              className="pl-8"
              autoFocus
            />
          </div>
        </div>
        <ScrollArea className="h-72">
          <div className="space-y-1 p-2">
            {filtered.length === 0 ? (
              <p className="p-5 text-center text-sm text-muted-foreground">No evidence matches that search.</p>
            ) : filtered.map((item) => (
              <div key={item.id} className="rounded-lg border bg-background p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.summary || "No summary captured."}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">{item.provider}</Badge>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Button type="button" variant="outline" size="xs" onClick={() => insert(item, false)}>
                    <Link2 className="size-3" /> Cite
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={() => insert(item, true)}>
                    <FileText className="size-3" /> Embed card
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function ResearchEvidenceEditor({
  value,
  onChange,
  evidence,
  onSave,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  evidence: ResearchEvidenceReference[];
  onSave: () => void;
  compact?: boolean;
}) {
  return (
    <MarkdownEditor
      value={value}
      onChange={onChange}
      placeholder={"# Investigation notes\n\nRecord hypotheses, pivots, and conclusions. Use Evidence to cite or embed a captured result."}
      minHeightClass={compact ? "min-h-48" : "min-h-[52svh]"}
      defaultMode="write"
      showNodePicker={false}
      onSave={onSave}
      insertSlot={({ insertAtCursor, disabled }) => <EvidencePicker evidence={evidence} onInsert={insertAtCursor} disabled={disabled} />}
      renderPreview={(content) => <Markdown content={expandEvidenceReferences(content, evidence)} />}
    />
  );
}
