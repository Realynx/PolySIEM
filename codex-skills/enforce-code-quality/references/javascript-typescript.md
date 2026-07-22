# JavaScript and TypeScript gate

## Repository scripts

Add these scripts when equivalent commands do not already exist:

```json
{
  "scripts": {
    "codefactor:check": "eslint . --max-warnings=0 --rule \"complexity: [error, 15]\" --rule \"no-duplicate-imports: error\"",
    "quality:check": "npm run typecheck && npm run lint -- --max-warnings=0 && npm run codefactor:check && npm test && npm run build"
  }
}
```

Adapt `quality:check` to the scripts the repository actually provides. Do not invent a typecheck, test, or build command without inspecting the project.

The command-line rules make the CodeFactor-equivalent gate explicit even when the base ESLint configuration changes. It is also valid to place the same rules in a flat-config block:

```js
{
  files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
  rules: {
    complexity: ["error", 15],
    "no-duplicate-imports": "error",
  },
}
```

Keep the dedicated script even when rules are in config so CI and agents have one unambiguous gate.

## Baseline commands

```powershell
New-Item -ItemType Directory -Force .codex-tmp | Out-Null
npm run lint -- --max-warnings=0
npm run codefactor:check -- --format json --output-file .codex-tmp/code-quality-baseline.json
```

If the script has not been added yet:

```powershell
npx eslint . --max-warnings=0 --rule "complexity: [error, 15]" --rule "no-duplicate-imports: error"
```

Use targeted checks while iterating:

```powershell
npx eslint src/path/to/file.ts --max-warnings=0 --rule "complexity: [error, 15]" --rule "no-duplicate-imports: error"
npm test -- path/to/related.test.ts
```

## Complexity refactoring patterns

- Move normalization and validation into pure helpers with direct tests.
- Convert long provider/type/status branches into typed dispatch maps.
- Split controller hooks into transport, state-transition, and presentation responsibilities.
- Keep route handlers thin: authenticate, parse, delegate, translate the result.
- Preserve stable public exports when moving implementations.
- Consolidate imports from the same module into one declaration, including type specifiers where supported.

Do not trade one complex function for a new helper that still mixes the same unrelated decisions.

## CI step

Run the gate after ordinary lint and before tests/build:

```yaml
- name: Code quality gate
  run: npm run codefactor:check
```

