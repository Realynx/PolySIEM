import type { SegmentItem } from "@/components/mobile/ui/mobile-segmented";

/** Sibling tabs shared by the phone Hosts / VMs / Containers pages. */
export const COMPUTE_SEGMENTS: SegmentItem[] = [
  { label: "Hosts", href: "/inventory/hosts" },
  { label: "VMs", href: "/inventory/vms" },
  { label: "Containers", href: "/inventory/containers" },
];
