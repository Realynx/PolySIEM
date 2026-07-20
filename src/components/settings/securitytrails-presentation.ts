export const DEFAULT_SECURITYTRAILS_AI_DAILY_LIMIT = 10;

export function securityTrailsAiDailyLimit(settings: Record<string, unknown> | null | undefined): number {
  const value = settings?.aiDailyCallLimit;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_SECURITYTRAILS_AI_DAILY_LIMIT;
}

export function securityTrailsBudgetLabel(limit: number): string {
  return limit === 0 ? "AI/MCP cache-only" : `AI/MCP · ${limit} live / 24h`;
}
