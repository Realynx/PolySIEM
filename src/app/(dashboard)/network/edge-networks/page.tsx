import { requirePageUser } from "@/lib/auth/guards";
import { EdgeNetworksPanel } from "@/components/network/edge-networks-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edge networks" };

export default async function EdgeNetworksPage() {
  const { user } = await requirePageUser();
  return <EdgeNetworksPanel isAdmin={user.role === "ADMIN"} />;
}
