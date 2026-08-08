import "server-only";

/** Raised instead of silently truncating data that would make a derived view incorrect. */
export class DatasetBudgetExceededError extends Error {
  constructor(
    public dataset: string,
    public limit: number,
  ) {
    super(`${dataset} exceeds the safe processing limit of ${limit.toLocaleString()} rows.`);
    this.name = "DatasetBudgetExceededError";
  }
}

export function assertDatasetBudget<T>(dataset: string, rows: readonly T[], limit: number): void {
  if (rows.length > limit) throw new DatasetBudgetExceededError(dataset, limit);
}
