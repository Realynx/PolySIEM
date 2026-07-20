"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/components/shared/api-client";

/** Edit dialog for the user-editable SSH key fields (name, owner, purpose). */
export function EditKeyDialog({
  keyId,
  initial,
}: {
  keyId: string;
  initial: { name: string; ownerLabel: string | null; purpose: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [ownerLabel, setOwnerLabel] = useState(initial.ownerLabel ?? "");
  const [purpose, setPurpose] = useState(initial.purpose ?? "");

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/keys/${keyId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          ownerLabel: ownerLabel.trim() || null,
          purpose: purpose.trim() || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Key updated");
      setOpen(false);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> Edit
      </Button>
      <Dialog open={open} onOpenChange={(v) => !save.isPending && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit key</DialogTitle>
            <DialogDescription>
              The key material itself never changes — delete and re-add to replace a key.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="edit-key-name">Name</Label>
              <Input id="edit-key-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-key-owner">Owner</Label>
              <Input
                id="edit-key-owner"
                placeholder="Whose key is this?"
                value={ownerLabel}
                onChange={(e) => setOwnerLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-key-purpose">Purpose</Label>
              <Textarea
                id="edit-key-purpose"
                placeholder="What is this key for?"
                className="min-h-24"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={save.isPending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending || !name.trim()}>
                {save.isPending && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
