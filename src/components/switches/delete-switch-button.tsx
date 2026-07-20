"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

/** Trash button + confirm dialog for removing a parsed switch config. */
export function DeleteSwitchButton({ switchId, name }: { switchId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/network/switches/${switchId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Deleted ${name}`);
      setOpen(false);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The parsed configuration (VLANs, ports, port-channels) is removed. The switch stays in
              your inventory — repaste a config any time to bring it back.
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
              Delete switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
