import { requirePageAdmin } from "@/lib/auth/guards";
import { isWebUpdateCapable } from "@/lib/updates/auto-update";
import { getCurrentVersion } from "@/lib/updates/release";
import { UpdateWindow } from "@/components/settings/update-window";

export const metadata = { title: "Update" };
export const dynamic = "force-dynamic";

export default async function UpdatePage() {
  await requirePageAdmin();
  return <UpdateWindow currentVersion={getCurrentVersion()} capable={isWebUpdateCapable()} />;
}
