"use client";

import { useRouter } from "next/navigation";
import { pushWithNavigationFeedback } from "./navigation-feedback";

/** Sign out and land on /login. Shared by the desktop topbar and mobile nav. */
export function useLogout() {
  const router = useRouter();
  return async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    pushWithNavigationFeedback(router, "/login");
    router.refresh();
  };
}
