"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/components/shared/api-client";

/** Trash button + confirm dialog for removing a documented SSH key. */
export function DeleteKeyButton({
  keyId,
  name,
  deploymentCount,
  variant = "icon",
}: {
  keyId: string;
  name: string;
  deploymentCount: number;
  /** "icon" for table rows, "button" for the detail page header. */
  variant?: "icon" | "button";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/keys/${keyId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Deleted ${name}`);
      setOpen(false);
      if (pathname !== "/keys") router.push("/keys");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${name}`}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" /> Delete
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The documented public key
              {deploymentCount > 0
                ? ` and its ${deploymentCount} deployment record${deploymentCount === 1 ? "" : "s"} are removed from PolySIEM. `
                : " is removed from PolySIEM. "}
              Nothing changes on your machines — authorized_keys files are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Delete key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
