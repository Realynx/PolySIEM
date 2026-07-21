export type ConditionOp = "eq" | "neq" | "contains" | "gt" | "lt" | "empty" | "not-empty";

export const CONDITION_OPS: ConditionOp[] = [
  "eq",
  "neq",
  "contains",
  "gt",
  "lt",
  "empty",
  "not-empty",
];

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

export function evaluateCondition(op: ConditionOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case "empty":
      return isEmptyValue(left);
    case "not-empty":
      return !isEmptyValue(left);
    case "eq":
      return String(left ?? "") === String(right ?? "");
    case "neq":
      return String(left ?? "") !== String(right ?? "");
    case "contains":
      return String(left ?? "").includes(String(right ?? ""));
    case "gt":
    case "lt": {
      const numericLeft = Number(left);
      const numericRight = Number(right);
      if (Number.isNaN(numericLeft) || Number.isNaN(numericRight)) {
        throw new Error(
          `Cannot compare non-numeric values ("${String(left)}" ${op} "${String(right)}")`,
        );
      }
      return op === "gt" ? numericLeft > numericRight : numericLeft < numericRight;
    }
  }
}
