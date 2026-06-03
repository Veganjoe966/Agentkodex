# Changelog

## 2026-06-03

### Added

- Professional npm-first installer at `install.sh`, with GitHub fallback through npm and no automatic sudo path.
- Direct execution-path capability enforcement for Runtime v2, shell/custom commands, swarm phases, tournament contestants, and audit helper commands.
- Scoped Agentguard-compatible capabilities with session, agent, phase, action, path, expiration, and signature checks.
- Audit evidence records for security decisions, denied actions, failed capability validation, and quality gate results.
- Audit bundle inclusion for run-local `audit-evidence.jsonl`.
- Routing and scorecard signals: `securityAllowed`, `securityDeniedCount`, `qualityGateOk`, `qualityViolationCount`, and `completionBlocked`.
- Regression coverage for missing, expired, wrong-session, wrong-agent, wrong-phase, wrong-path, and reused capabilities.

### Validation

- `npm test`: 53/53 passing.
- `npm run lint`: passing.
- `npm run typecheck`: passing.
