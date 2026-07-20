"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiSend } from "@/components/inventory/client-api";
import { MarkdownEditor } from "./markdown-editor";

const NO_PARENT = "__none__";

export interface DocEditorProps {
  mode: "create" | "edit";
  /** All pages (for the parent selector). */
  pages: { id: string; title: string; slug: string }[];
  doc?: { id: string; slug: string; title: string; content: string; parentId: string | null };
  defaultParentId?: string | null;
  /** Forwarded to the markdown editor toolbar (AI assist menu slot). */
  aiSlot?: ReactNode;
}

/** Full-page documentation editor used by /docs/new and /docs/[slug]/edit. */
export function DocEditor({ mode, pages, doc, defaultParentId, aiSlot }: DocEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [content, setContent] = useState(doc?.content ?? "");
  const [parentId, setParentId] = useState(doc?.parentId ?? defaultParentId ?? NO_PARENT);
  const [saving, setSaving] = useState(false);

  const parentOptions = pages.filter((p) => p.id !== doc?.id);
  const cancelHref = mode === "edit" && doc ? `/docs/${doc.slug}` : "/docs";

  const save = async () => {
    if (title.trim() === "") {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        content,
        parentId: parentId === NO_PARENT ? null : parentId,
      };
      if (mode === "create") {
        const created = await apiSend<{ slug: string }>("/api/docs", "POST", body);
        toast.success(`Created “${body.title}”`);
        router.push(`/docs/${created.slug}`);
      } else if (doc) {
        await apiSend(`/api/docs/${doc.id}`, "PATCH", body);
        toast.success("Page saved");
        router.push(`/docs/${doc.slug}`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-1.5">
          <Label htmlFor="doc-title">Title</Label>
          <Input
            id="doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            autoFocus={mode === "create"}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doc-parent">Parent page</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger id="doc-parent" className="w-full">
              <SelectValue placeholder="No parent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PARENT}>No parent (top level)</SelectItem>
              {parentOptions.map((page) => (
                <SelectItem key={page.id} value={page.id}>
                  {page.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <MarkdownEditor
        value={content}
        onChange={setContent}
        placeholder="# Start documenting…"
        minHeightClass="min-h-[60svh]"
        aiSlot={aiSlot}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {mode === "create" ? "Create page" : "Save page"}
        </Button>
      </div>
    </div>
  );
}
