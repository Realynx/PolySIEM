"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, CircleX, Loader2, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { previewAuthorizedKeys } from "@/components/ssh/client-parse";

interface CreateKeysResponse {
  keys: { id: string; name: string }[];
}

/** "Add key" button + dialog: paste one or more public keys with live per-line preview. */
export function AddKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [text, setText] = useState("");

  const preview = useMemo(() => previewAuthorizedKeys(text), [text]);
  const hasPrivateKey = preview.some((p) => !p.ok && p.isPrivateKey);
  const validCount = preview.filter((p) => p.ok).length;
  const canSubmit = validCount > 0 && preview.every((p) => p.ok);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<CreateKeysResponse>("/api/keys", {
        method: "POST",
        body: JSON.stringify({
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(ownerLabel.trim() ? { ownerLabel: ownerLabel.trim() } : {}),
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
          text,
        }),
      }),
    onSuccess: (data) => {
      toast.success(
        data.keys.length === 1 ? `Documented "${data.keys[0].name}"` : `Documented ${data.keys.length} keys`,
      );
      setOpen(false);
      setName("");
      setOwnerLabel("");
      setPurpose("");
      setText("");
      if (data.keys.length === 1) router.push(`/keys/${data.keys[0].id}`);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add key
      </Button>
      <Dialog open={open} onOpenChange={(v) => !create.isPending && setOpen(v)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Document an SSH key</DialogTitle>
            <DialogDescription>
              Paste one or more <span className="font-semibold">public</span> keys (authorized_keys
              format — the contents of a <span className="font-mono text-xs">.pub</span> file). Only
              the public half is stored.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) create.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name (optional)</Label>
                <Input
                  id="key-name"
                  placeholder="Defaults to the key comment"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-owner">Owner (optional)</Label>
                <Input
                  id="key-owner"
                  placeholder="Whose key is this?"
                  value={ownerLabel}
                  onChange={(e) => setOwnerLabel(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-purpose">Purpose (optional)</Label>
              <Input
                id="key-purpose"
                placeholder="What is this key for?"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-text">Public keys</Label>
              <Textarea
                id="key-text"
                required
                spellCheck={false}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1… fox@laptop"
                className="max-h-[40vh] min-h-[120px] font-mono text-xs"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            {hasPrivateKey && (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertTitle>That&apos;s a private key</AlertTitle>
                <AlertDescription>
                  Never paste private keys — anywhere. PolySIEM only documents public keys. Paste the
                  matching <span className="font-mono">.pub</span> file instead, and consider that
                  key compromised if it was shared.
                </AlertDescription>
              </Alert>
            )}
            {!hasPrivateKey && preview.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border bg-muted/40 p-2 text-xs">
                {preview.map((p) => (
                  <li key={p.lineNumber} className="flex items-center gap-2">
                    {p.ok ? (
                      <CircleCheck className="size-3.5 shrink-0 text-primary" />
                    ) : (
                      <CircleX className="size-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="text-muted-foreground">line {p.lineNumber}:</span>
                    {p.ok ? (
                      <span className="truncate">
                        <span className="font-mono">{p.keyType}</span>
                        {p.comment && <span className="text-muted-foreground"> — {p.comment}</span>}
                      </span>
                    ) : (
                      <span className="truncate text-destructive">{p.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !canSubmit}>
                {create.isPending && <Loader2 className="animate-spin" />}
                {validCount > 1 ? `Add ${validCount} keys` : "Add key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
