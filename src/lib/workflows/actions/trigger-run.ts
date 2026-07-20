import { validateRunInput, validateTriggerParams } from "../engine";

/**
 * Validate a parameterized trigger's declaration and submitted input.
 * Callers provide their established input-error prefix; declaration errors
 * are shared by every parameterized trigger.
 */
export function executeParameterizedTrigger(
  config: unknown,
  input: Record<string, unknown>,
  inputErrorPrefix: string,
): Record<string, unknown> {
  const { params, errors: paramErrors } = validateTriggerParams(
    (config as { params?: unknown }).params ?? [],
  );
  if (paramErrors.length > 0) {
    throw new Error(`Invalid trigger params: ${paramErrors.join("; ")}`);
  }

  const { values, errors } = validateRunInput(params, input);
  if (errors.length > 0) {
    throw new Error(`${inputErrorPrefix}: ${errors.join("; ")}`);
  }
  return values;
}
