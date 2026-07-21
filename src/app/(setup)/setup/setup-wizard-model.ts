import type { SetupStage } from "@/lib/settings";

export const SETUP_STEPS = ["Welcome", "Admin", "Preferences", "AI", "Integrations", "Tour"] as const;

export function setupInitialStep(stage: SetupStage): number {
  if (stage === "tutorial") return 5;
  if (stage === "integrations") return 4;
  if (stage === "ai") return 3;
  return 0;
}

export function validateAdministrator(username: string, password: string, confirmation: string): string | null {
  if (username.trim().length < 3) return "Username must be at least 3 characters";
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return "Username may only contain letters, numbers, dots, dashes and underscores";
  }
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password !== confirmation) return "Passwords do not match";
  return null;
}
