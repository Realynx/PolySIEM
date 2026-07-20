"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
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

interface CreateSwitchResponse {
  config: { id: string };
  warnings: string[];
}

/** "Add switch" button + dialog: paste a Cisco running-config, parse, redirect. */
export function AddSwitchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rawConfig, setRawConfig] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiFetch<CreateSwitchResponse>("/api/network/switches", {
        method: "POST",
        body: JSON.stringify({
          ...(name.trim() ? { name: name.trim() } : {}),
          rawConfig,
        }),
      }),
    onSuccess: (data) => {
      toast.success("Switch configuration parsed");
      if (data.warnings.length > 0) {
        toast.info(
          `${data.warnings.length} parser warning${data.warnings.length === 1 ? "" : "s"}`,
          { description: data.warnings.slice(0, 5).join("\n") },
        );
      }
      setOpen(false);
      setName("");
      setRawConfig("");
      router.push(`/network/switches/${data.config.id}`);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add switch
      </Button>
      <Dialog open={open} onOpenChange={(v) => !create.isPending && setOpen(v)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a switch</DialogTitle>
            <DialogDescription>
              Paste the running-config from your Cisco IOS switch (<span className="font-mono text-xs">show running-config</span>).
              PolySIEM parses VLANs, ports, and port-channels — nothing is sent to the device.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (rawConfig.trim()) create.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="switch-name">Name (optional)</Label>
              <Input
                id="switch-name"
                placeholder="Defaults to the hostname in the config"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="switch-config">Configuration</Label>
              <Textarea
                id="switch-config"
                required
                spellCheck={false}
                placeholder={"hostname my-switch\n!\ninterface GigabitEthernet1/0/1\n description uplink\n switchport mode trunk\n…"}
                className="max-h-[50vh] min-h-[300px] font-mono text-xs"
                value={rawConfig}
                onChange={(e) => setRawConfig(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !rawConfig.trim()}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Parse config
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
