# Lintguard Quality Gate

Lintguard is Agentkodex's engineering governor. It runs through `agentkodex quality check` and `npm run quality:gate`, producing machine-readable JSON with `ok`, `summary`, `checks`, `filesChecked`, `blockedReason`, and `totals`.

## Checks

- ESLint/lint command
- TypeScript/typecheck command
- Ruff command when discovered or configured
- test command
- LOC budgets
- function complexity budgets
- simple JS/TS circular dependency detection
- conservative dead import detection
- dependency hygiene, banned packages, duplicate dependencies, and missing dependencies
- architecture boundary rules
- forbidden imports
- checked-in `.env` files
- banned telemetry/vendor artifacts
- hardcoded banned project paths
- secret-looking output in quality logs

## Config

Put `agentkodex.quality.json` in the project root. See `examples/agentkodex-quality.example.json`.

Important keys:

- `maxFileLoc`
- `maxFunctionComplexity`
- `maxTotalViolations`
- `forbiddenImports`
- `bannedPackages`
- `architectureBoundaries`
- `failOnDeadImports`
- `failOnCircularDeps`
- `failOnMissingDeps`
- `lintCommand`, `typecheckCommand`, `ruffCommand`, `testCommand`

Required checks fail closed. Warnings remain machine-readable so teams can tighten policies over time.
