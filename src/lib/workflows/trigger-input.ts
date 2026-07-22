import { isTriggerParamType, type TriggerParam } from "./types";

export function validateTriggerParams(raw: unknown): { params: TriggerParam[]; errors: string[] } {
  const errors: string[] = [];
  const params: TriggerParam[] = [];
  if (!Array.isArray(raw)) {
    return { params, errors: ["Trigger config must contain a params array"] };
  }

  const seen = new Set<string>();
  raw.forEach((candidate, index) => {
    const param = candidate as Partial<TriggerParam> | null;
    if (!param || typeof param !== "object") {
      errors.push(`Param #${index + 1} is not an object`);
      return;
    }
    if (typeof param.key !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(param.key)) {
      errors.push(`Param #${index + 1} needs a key (letters/digits/_/-, starting with a letter)`);
      return;
    }
    if (seen.has(param.key)) {
      errors.push(`Duplicate param key "${param.key}"`);
      return;
    }
    seen.add(param.key);
    if (!isTriggerParamType(param.type)) {
      errors.push(`Param "${param.key}" has an invalid type "${String(param.type)}"`);
      return;
    }
    params.push({
      key: param.key,
      label: typeof param.label === "string" && param.label ? param.label : param.key,
      type: param.type,
      required: param.required === true,
      ...(typeof param.help === "string" && param.help ? { help: param.help } : {}),
    });
  });

  return { params, errors };
}

export function validateRunInput(
  params: TriggerParam[],
  input: Record<string, unknown>,
): { values: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const values: Record<string, unknown> = {};

  for (const param of params) {
    const raw = input[param.key];
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      if (param.required) errors.push(`Missing required input "${param.label}" (${param.key})`);
      continue;
    }

    validateRunValue(param, raw, values, errors);
  }

  const known = new Set(params.map((param) => param.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`Unknown input "${key}" (not a trigger param)`);
  }
  return { values, errors };
}

function validateRunValue(
  param: TriggerParam,
  raw: unknown,
  values: Record<string, unknown>,
  errors: string[],
): void {
  switch (param.type) {
      case "number": {
        const value = typeof raw === "number" ? raw : Number(String(raw).trim());
        if (Number.isNaN(value)) {
          errors.push(`Input "${param.key}" must be a number (got "${String(raw)}")`);
        } else {
          values[param.key] = value;
        }
        break;
      }
      case "boolean":
        if (typeof raw === "boolean") values[param.key] = raw;
        else if (raw === "true" || raw === "false") values[param.key] = raw === "true";
        else errors.push(`Input "${param.key}" must be a boolean (got "${String(raw)}")`);
        break;
      default:
        if (typeof raw !== "string") {
          errors.push(`Input "${param.key}" must be a string (got ${typeof raw})`);
        } else {
          values[param.key] = raw;
        }
  }
}
