import type { TicketSeverityValue } from "@/lib/types";

export const SEVERITIES: TicketSeverityValue[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export const CATEGORIES = [
  "anomaly",
  "ids-alert",
  "correlation",
  "recon",
  "auth",
  "traffic",
  "other",
] as const;
