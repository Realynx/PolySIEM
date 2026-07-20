import { redirect } from "next/navigation";

/** Threat intel merged into the combined /logs/threats page (Intel tab). */
export default function ThreatIntelRedirect() {
  redirect("/logs/threats?tab=intel");
}
