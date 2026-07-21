import type { PulseView, ThreatIntelPulseView } from "@/lib/types";

/** Merge persisted receipts into feed pulses; later report edits make a pulse unread again. */
export function withThreatIntelReadState(
  pulses: PulseView[],
  readAtByPulse: Map<string, string>,
): ThreatIntelPulseView[] {
  return pulses.map((pulse) => {
    const readAt = readAtByPulse.get(pulse.id) ?? null;
    const changedAfterRead = readAt !== null && Date.parse(pulse.modified) > Date.parse(readAt);
    return { ...pulse, readAt: changedAfterRead ? null : readAt };
  });
}
