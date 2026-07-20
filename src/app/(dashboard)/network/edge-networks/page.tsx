import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { EdgeNetworksPanel } from "@/components/network/edge-networks-panel";
import { MobileEdgeNetworks } from "@/components/mobile/pages/network-edge/mobile-edge-networks";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edge networks" };

export default async function EdgeNetworksPage() {
  const { user } = await requirePageUser();
  if (await isMobileView()) return <MobileEdgeNetworks isAdmin={user.role === "ADMIN"} />;
  return <EdgeNetworksPanel isAdmin={user.role === "ADMIN"} />;
}
