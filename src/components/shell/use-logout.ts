"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { pushWithNavigationFeedback } from "./navigation-feedback";

/** Sign out and land on /login. Shared by the desktop topbar and mobile nav. */
export function useLogout() {
  const router = useRouter();
  const signingOutRef = useRef(false);

  return useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;

    try {
      await apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
      pushWithNavigationFeedback(router, "/login");
      router.refresh();
    } catch (err) {
      signingOutRef.current = false;
      toast.error(err instanceof Error ? err.message : "Could not sign out");
    }
  }, [router]);
}
