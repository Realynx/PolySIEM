import { getSession } from "@/lib/auth/session";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const isAdmin = session?.user.role === "ADMIN";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 md:flex-row md:gap-10">
      <SettingsNav isAdmin={isAdmin} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
