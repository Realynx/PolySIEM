"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Download, KeyRound, Loader2, TriangleAlert } from "lucide-react";
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
import { apiFetch } from "@/components/shared/api-client";
import { CopyButton } from "@/components/ssh/copy-button";

interface GenerateResponse {
  key: { id: string; name: string; publicKey: string; fingerprint: string };
  privateKeyPem: string;
}

/**
 * "Generate key" dialog. Phase 1 collects a name/comment; phase 2 shows the
 * public key and the private key ONCE — the server never stores the private half.
 */
export function GenerateKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<GenerateResponse>("/api/keys/generate", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          ...(ownerLabel.trim() ? { ownerLabel: ownerLabel.trim() } : {}),
        }),
      }),
    onSuccess: (data) => {
      setResult(data);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function downloadPrivateKey() {
    if (!result) return;
    const blob = new Blob([result.privateKeyPem], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.key.name.replace(/[^a-zA-Z0-9._-]+/g, "-") || "id_ed25519"}.key`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function close() {
    setOpen(false);
    // Drop the private key from memory as soon as the dialog closes.
    const keyId = result?.key.id;
    setResult(null);
    setName("");
    setComment("");
    setOwnerLabel("");
    if (keyId) router.push(`/keys/${keyId}`);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <KeyRound className="size-4" /> Generate key
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (generate.isPending) return;
          if (!v && result) close();
          else setOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          {!result ? (
            <>
              <DialogHeader>
                <DialogTitle>Generate an SSH key</DialogTitle>
                <DialogDescription>
                  Creates a fresh ed25519 keypair. PolySIEM documents the public key; the private key
                  is handed to you once and never stored.
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) generate.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="gen-name">Name</Label>
                  <Input
                    id="gen-name"
                    required
                    placeholder="e.g. fox workstation → cluster"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="gen-comment">Key comment (optional)</Label>
                    <Input
                      id="gen-comment"
                      placeholder="fox@workstation"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gen-owner">Owner (optional)</Label>
                    <Input
                      id="gen-owner"
                      placeholder="Whose key is this?"
                      value={ownerLabel}
                      onChange={(e) => setOwnerLabel(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={generate.isPending}
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={generate.isPending || !name.trim()}>
                    {generate.isPending && <Loader2 className="animate-spin" />}
                    Generate keypair
                  </Button>
                </DialogFooter>
              </form>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Keypair generated</DialogTitle>
                <DialogDescription>
                  The public key is documented as &quot;{result.key.name}&quot; ({result.key.fingerprint}).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Public key</Label>
                    <CopyButton value={result.key.publicKey} label="Copy public key" />
                  </div>
                  <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
                    {result.key.publicKey}
                  </pre>
                </div>
                <Alert variant="destructive">
                  <TriangleAlert className="size-4" />
                  <AlertTitle>Private key — shown once, never stored</AlertTitle>
                  <AlertDescription>
                    Save it now (e.g. to <span className="font-mono">~/.ssh/</span>, then{" "}
                    <span className="font-mono">chmod 600</span>). When this dialog closes it is gone
                    for good — PolySIEM keeps only the public key.
                  </AlertDescription>
                </Alert>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Private key</Label>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={downloadPrivateKey}>
                        <Download className="size-3.5" /> Download .key
                      </Button>
                      <CopyButton value={result.privateKeyPem} label="Copy private key" />
                    </div>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
                    {result.privateKeyPem}
                  </pre>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={close}>I saved it — open the key page</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
