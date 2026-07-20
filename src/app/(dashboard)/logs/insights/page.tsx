import { redirect } from "next/navigation";

/** Preserve old bookmarks after Network insights moved into the Network section. */
export default function LegacyNetworkInsightsPage() {
  redirect("/network/insights");
}
