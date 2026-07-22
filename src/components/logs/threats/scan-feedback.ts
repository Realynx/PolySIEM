import { toast } from "sonner";
import type { AiScanRunDto } from "@/lib/types";

export function announceScan(run: AiScanRunDto) {
  const created = run.stats?.ticketsCreated ?? 0;
  const updated = run.stats?.ticketsUpdated ?? 0;
  if (run.status === "FAILED") toast.error(run.error ?? "The scan failed.");
  else if (created === 0 && updated === 0) toast.success("Scan complete — nothing suspicious found.");
  else toast.success(`Scan complete — ${created} new ticket${created === 1 ? "" : "s"}${updated > 0 ? `, ${updated} updated` : ""}.`);
}

export function announceScanError(error: Error) {
  if (/already running/i.test(error.message)) toast.info("A scan is already running — hang tight.");
  else toast.error(error.message);
}
