# Changelog

## 1.0.1 - 2026-06-03

### Added

- User-facing Ed25519 key CLI: `agentkodex keys status|list|rotate|retire`.
- Key lifecycle audit events: `ed25519_key_created`, `ed25519_key_rotated`, `ed25519_key_retired`, `ed25519_key_status_checked`, and `ed25519_key_rotation_failed`.
- Advanced quality checks for complexity, simple circular dependencies, conservative dead imports, dependency hygiene, and architecture boundaries.
- Focused tests for key CLI, key retirement, corrupt key stores, and advanced quality gate failures.

### Validation

- `npm test`: 75/75 passing.
- `npm run lint`: passing.
- `npm run typecheck`: passing.
- `npm run quality:gate`: passing.

## 1.0.0 - 2026-06-03

### Added

- Professional npm-first installer at `install.sh`, with GitHub fallback through npm and no automatic sudo path.
- Direct execution-path capability enforcement for Runtime v2, shell/custom commands, swarm phases, tournament contestants, and audit helper commands.
- Scoped Agentguard-compatible Ed25519 capabilities with session, agent, phase, action, path, expiration, key ID, and signature checks.
- HMAC capability compatibility mode with legacy-use audit warnings.
- Native capability key store with key rotation support and multiple verification keys.
- Audit evidence records for capability issuance, validation success/failure, legacy capability use, key rotation, security decisions, denied actions, and quality gate results.
- Audit bundle inclusion for run-local `audit-evidence.jsonl` and governance manifest fields.
- Governance CLI: `agentkodex governance summary [--json]`.
- Routing and scorecard signals: `securityAllowed`, `securityDeniedCount`, `failedCapabilityCount`, `qualityGateOk`, `qualityViolationCount`, `completionBlocked`, `approvalRequiredCount`, and `unsafeActionAttemptCount`.
- Regression coverage for missing, expired, wrong-session, wrong-agent, wrong-phase, wrong-path, and reused capabilities.

### Validation

- `npm test`: 64/64 passing.
- `npm run lint`: passing.
- `npm run typecheck`: passing.
- `npm run quality:gate`: passing.
