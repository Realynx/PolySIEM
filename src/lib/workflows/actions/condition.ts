import { z } from "zod";
import { CONDITION_OPS, evaluateCondition, type ConditionOp } from "../engine";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  left: z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v)),
  op: z.enum(CONDITION_OPS as [ConditionOp, ...ConditionOp[]]),
  right: z
    .union([z.string(), z.number(), z.boolean()])
    .transform((v) => String(v))
    .optional()
    .default(""),
});

/**
 * control.condition — branches the flow. Outgoing edges carry a "true" or
 * "false" branch; the untaken branch's downstream nodes are SKIPPED.
 */
export const controlCondition: ActionDefinition = {
  meta: {
    kind: "control.condition",
    title: "Condition",
    description:
      "Compares two values and routes the run down the true or false branch. The untaken branch is skipped. gt/lt compare numerically.",
    category: "control",
    inputs: [
      {
        key: "left",
        label: "Left value",
        type: "string",
        required: true,
        placeholder: "{{nodes.step1.ip}}",
        help: "Value to test; template refs are resolved first.",
      },
      {
        key: "op",
        label: "Operator",
        type: "select",
        required: true,
        options: [
          { value: "eq", label: "equals" },
          { value: "neq", label: "does not equal" },
          { value: "contains", label: "contains" },
          { value: "gt", label: "is greater than (numeric)" },
          { value: "lt", label: "is less than (numeric)" },
          { value: "empty", label: "is empty" },
          { value: "not-empty", label: "is not empty" },
        ],
      },
      {
        key: "right",
        label: "Right value",
        type: "string",
        required: false,
        help: "Ignored for the empty / not-empty operators.",
      },
    ],
    outputs: [{ key: "result", label: "Result (\"true\" or \"false\")" }],
  },
  configSchema,
  async run({ config }) {
    const { left, op, right } = configSchema.parse(config);
    const result = evaluateCondition(op, left, right);
    return { result: result ? "true" : "false" };
  },
};
