"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PencilLine } from "lucide-react";
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
