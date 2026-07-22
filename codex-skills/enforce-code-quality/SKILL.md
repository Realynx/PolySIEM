---
name: enforce-code-quality
description: Audit and refactor a repository to a repeatable local code-quality gate equivalent to the useful CodeFactor findings. Use for CodeFactor cleanup, maintainability sweeps, lint cleanup, cyclomatic-complexity reduction, duplicate-import cleanup, SOLID/DRY refactoring, or installing reusable quality gates in JavaScript, TypeScript, Next.js, and mixed .NET repositories.
---

# Enforce Code Quality

Build a local-first quality gate, fix every violation without changing behavior, and leave the repository able to repeat the check without CodeFactor.

## Standard

Enforce these non-negotiable outcomes:

- Cyclomatic complexity is at most 15 per function or method.
- Duplicate imports are errors.
- The repository's normal linter has zero errors and zero warnings.
- Typecheck, tests, and production build pass when the repository provides them.
- Changed code follows SOLID and DRY without speculative abstraction.
- Do not suppress rules, loosen thresholds, exclude source files, or split code into meaningless wrappers to make the metric pass.

Read [references/javascript-typescript.md](references/javascript-typescript.md) for JS/TS setup and commands. Read [references/dotnet.md](references/dotnet.md) when the repository contains C# projects.

When working in `FinBrokerCrm`, also read [references/finbrokercrm.md](references/finbrokercrm.md).

## Workflow

### 1. Discover before changing

1. Read repository instructions and architecture documents.
2. Inspect the working tree and preserve unrelated user changes.
3. Identify languages, package managers, build systems, test runners, CI workflows, and existing quality scripts.
4. Determine which commands are safe in the current environment. Never assume `npm`, a Unix shell, or a writable global tool directory.
5. Make a short plan with inventory, cleanup, and verification phases.

### 2. Install an explicit gate

Add or confirm a stable repository command named `codefactor:check` or the ecosystem-equivalent command. It must cover all maintained source files and enforce complexity 15 plus duplicate-import detection where supported.

Prefer a checked-in configuration and CI command over a developer-machine-only tool. Keep the gate separate from the ordinary linter when doing so makes its intent clearer. Do not remove stronger existing rules.

For mixed-language repositories, gate each language with its native analyzer. Do not claim ESLint covers C# or generated artifacts.

### 3. Capture the baseline

Run the ordinary linter and the strict gate before editing. Save machine-readable output in an ignored temporary directory when practical. Record:

- total violations;
- counts by rule;
- files and functions involved;
- failing typechecks/tests/builds that predate cleanup.

Treat the local analyzer output as the work inventory. Use CodeFactor only as an optional comparison source when it reports something not represented locally.

### 4. Partition the work

Group violations into bounded, non-overlapping batches:

1. duplicate imports and other mechanical lint findings;
2. pure helpers and validators;
3. services and orchestration;
4. React components and hooks;
5. API/transport boundaries;
6. C# methods when applicable.

If the user requests subagents, assign file-disjoint batches and make the coordinator own shared barrels, configuration, and the final gate. Require each agent to report changed files, targeted checks, and remaining violations.

### 5. Refactor one hotspot at a time

Before changing a complex function, identify its inputs, outputs, side effects, error behavior, and callers. Add or locate characterization tests when behavior is not already protected.

Reduce complexity with cohesive changes:

- replace nesting with guard clauses;
- extract pure decisions, parsing, validation, and transformations;
- separate orchestration from transport, persistence, and presentation;
- replace repeated condition trees with typed lookup tables or dispatch maps;
- give one module one clear reason to change;
- centralize genuinely identical policy while preserving caller-specific behavior;
- keep dependencies pointing toward domain logic and stable interfaces.

Avoid metric gaming:

- no lint-disable comments;
- no threshold increases;
- no copy/paste helpers;
- no large boolean parameter lists;
- no one-line extraction that hides rather than names a responsibility;
- no broad rewrites when a bounded refactor is sufficient.

After every batch, run the strict gate on changed files plus the closest relevant tests. Re-run the full inventory periodically so edits do not move violations elsewhere.

### 6. Verify in widening circles

Run, in order:

1. targeted lint/analyzer checks;
2. targeted tests;
3. full typecheck or compile;
4. full ordinary lint with zero warnings;
5. full complexity/duplicate-import gate;
6. full unit/integration tests;
7. production build;
8. E2E, deployment, or platform checks when relevant and available.

Do not mark the task complete because the strict gate is clean if tests or builds fail. Distinguish pre-existing failures with evidence; fix only when authorized and in scope.

### 7. Hand off evidence

Report:

- baseline and final violation counts;
- the permanent gate/configuration added;
- the main responsibility boundaries introduced;
- every verification command and result;
- any pre-existing or environment-blocked check;
- any language not yet covered by a native analyzer.

Completion means zero strict-gate violations, zero ordinary lint warnings/errors, passing required verification, and no unreviewed exclusions or suppressions.
