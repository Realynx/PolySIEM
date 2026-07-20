"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { apiSend } from "./client-api";
import { TAG_COLORS, TAG_DOT_CLASS, TagBadge, type TagColor } from "./tag-badge";

/** Create-tag dialog with the 9 allowed colors as swatches. */
export function CreateTagDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("gray");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      toast.error("Tag name is required");
      return;
    }
    if (trimmed.length > 48) {
      toast.error("Tag names are limited to 48 characters");
      return;
    }
    setSaving(true);
    try {
      await apiSend("/api/tags", "POST", { name: trimmed, color });
      toast.success(`Created tag “${trimmed}”`);
      setOpen(false);
      setName("");
      setColor("gray");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New tag
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New tag</DialogTitle>
          <DialogDescription>
            Tags organize hosts, VMs, containers, networks, services and docs.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Name</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="production"
              maxLength={48}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border transition-all",
                    TAG_DOT_CLASS[c],
                    color === c ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100",
                  )}
                >
                  {color === c && <Check className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="mb-1.5 text-xs text-muted-foreground">Preview</p>
            <TagBadge name={name.trim() || "tag-name"} color={color} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Create tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
