"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiSend } from "@/components/inventory/client-api";
import type { AiAssistMenuProps } from "@/components/ai";
import { Markdown } from "./markdown";
import { MarkdownEditor } from "./markdown-editor";

export interface DescriptionEditorProps {
  /** PATCH target, e.g. /api/inventory/hosts/abc123 */
  apiPath: string;
  /** JSON body key to send; defaults to "description". */
  field?: string;
  initialValue: string | null;
  /** Overrides the built-in AI assist menu with custom toolbar content. */
  aiSlot?: ReactNode;
  /** Enables AI "Generate description" seeded with this entity's facts. */
  entity?: AiAssistMenuProps["entity"];
  placeholder?: string;
}

/**
 * Rendered markdown with an inline edit mode, used for entity descriptions.
 * Saves via PATCH and refreshes the server-rendered page.
 */
export function DescriptionEditor({
  apiPath,
  field = "description",
  initialValue,
  aiSlot,
  entity,
  placeholder = "Document this entity — markdown supported…",
}: DescriptionEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue ?? "");
  const [saved, setSaved] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);
  const { data: linkedDocs = [] } = useQuery<
    Array<{ id: string; title: string; slug: string; updatedAt: string }>
  >({
    queryKey: ["linked-docs", entity?.type, entity?.id],
    queryFn: async () => {
      if (!entity) return [];
      const response = await fetch(
        `/api/docs/linked?kind=${encodeURIComponent(entity.type)}&id=${encodeURIComponent(entity.id)}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to load linked documentation (${response.status})`);
      }
      const body = (await response.json()) as {
        data?: Array<{ id: string; title: string; slug: string; updatedAt: string }>;
      };
      return body.data ?? [];
    },
    enabled: Boolean(entity),
    staleTime: 30_000,
  });

  const save = async () => {
    setSaving(true);
    try {
      await apiSend(apiPath, "PATCH", { [field]: value.trim() === "" ? null : value });
      setSaved(value);
      setEditing(false);
      toast.success("Description saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="group relative">
          {saved.trim() === "" ? (
            <p className="text-sm text-muted-foreground italic">
              No description yet. Click edit to add one.
            </p>
          ) : (
            <Markdown content={saved} />
          )}
          <Button
            variant="outline"
            size="sm"
            className="absolute -top-1 right-0"
            onClick={() => {
              setValue(saved);
              setEditing(true);
            }}
          >
            <PencilLine />
            Edit
          </Button>
        </div>
        {entity && (
          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Linked documentation
            </p>
            {linkedDocs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No pages link this item yet. In a documentation page, use Link inventory item.
              </p>
            ) : (
              <ul className="space-y-1">
                {linkedDocs.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      href={`/docs/${doc.slug}`}
                      className="group/link flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate group-hover/link:text-primary">{doc.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <MarkdownEditor value={value} onChange={setValue} placeholder={placeholder} aiSlot={aiSlot} entity={entity} minHeightClass="min-h-40" />
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save description
        </Button>
      </div>
    </div>
  );
}
