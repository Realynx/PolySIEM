"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiSend } from "./client-api";

interface DeleteEntityButtonProps {
  /** e.g. /api/inventory/hosts/abc123 */
  apiPath: string;
  /** Human label, e.g. `host “pve-01”` */
  entityLabel: string;
  /** Where to navigate after deletion; omit to just refresh (list rows). */
  redirectTo?: string;
  /** Render as a small icon button (for table rows). */
  iconOnly?: boolean;
}

/** AlertDialog-confirmed delete, used from detail headers and table rows. */
export function DeleteEntityButton({ apiPath, entityLabel, redirectTo, iconOnly }: DeleteEntityButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setBusy(true);
    try {
      await apiSend(apiPath, "DELETE");
      toast.success(`Deleted ${entityLabel}`);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const trigger = iconOnly ? (
    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${entityLabel}`}>
      <Trash2 className="text-muted-foreground" />
    </Button>
  ) : (
    <Button variant="destructive">
      <Trash2 />
      Delete
    </Button>
  );

  return (
    <AlertDialog>
      {iconOnly ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      ) : (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {entityLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes {entityLabel} and its tag assignments from PolySIEM. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void onDelete();
            }}
            disabled={busy}
            variant="destructive"
          >
            {busy && <Loader2 className="animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
