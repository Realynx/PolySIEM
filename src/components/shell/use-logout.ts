"use client";

import { useRouter } from "next/navigation";

/** Sign out and land on /login. Shared by the desktop topbar and mobile nav. */
export function useLogout() {
  const router = useRouter();
  return async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };
}
