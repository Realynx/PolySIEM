import { requirePageAdmin } from "@/lib/auth/guards";
import { listUsers } from "@/lib/services/users";
import { isMobileView } from "@/lib/device";
import { UsersManager, type AdminUser } from "@/components/settings/users-manager";
import { MobileUsersSettingsPage } from "@/components/mobile/pages/settings/mobile-users";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const session = await requirePageAdmin();
  const users = await listUsers();
  const initialUsers: AdminUser[] = users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    disabled: u.disabled,
    createdAt: u.createdAt.toISOString(),
  }));

  if (await isMobileView()) {
    return <MobileUsersSettingsPage initialUsers={initialUsers} currentUserId={session.user.id} />;
  }

  return <UsersManager initialUsers={initialUsers} currentUserId={session.user.id} />;
}
