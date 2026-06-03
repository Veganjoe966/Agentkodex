# Agent Operations Platform

Agentkodex is the orchestrator. Agentguard is the security and permission brain. Lintguard is the engineering-quality governor.

This integration keeps those roles separate:

```text
agentkodex/
  src/integrations/lintguard/
  src/integrations/agentguard/
  src/gates/qualityGate.js
  src/gates/securityGate.js
```

Agentkodex does not vendor Lintguard or Agentguard into one large runtime. It calls them through small adapters and records their evidence under `.agentkodex/`.

## Capability Enforcement

Agentguard-scoped capabilities are issued by Agentkodex through `src/capabilities/` and verified at command launch boundaries. A capability has this shape:

```json
{
  "capabilityId": "cap_...",
  "sessionId": "sess_...",
  "agentId": "shell",
  "phase": "runtime",
  "allowedActions": ["command:start"],
  "allowedPaths": ["/repo"],
  "expiresAt": "2026-06-03T00:00:00.000Z",
  "issuedBy": "agentguard",
  "algorithm": "ed25519",
  "keyId": "ak_...",
  "signature": "..."
}
```

Checks are not helper-only. They sit directly before process execution in:

- `src/sessionRunner.js` for one-shot, custom, shell, and configured agent commands
- `src/runtime/supervisor.js` for Runtime v2 per-session process spawn
- `src/runtime/daemonServer.js` for daemon-managed Runtime v2 process spawn
- `src/swarm/run.js` for per-agent/per-phase swarm execution
- `src/tournament/index.js` for per-contestant tournament execution
- `src/audit/bundle.js` for audit helper `git` and `zip` subprocesses

Failed capability validation writes audit evidence before returning.

New capabilities are signed natively in Node with Ed25519. Agentkodex stores signing and verification keys under `.agentkodex/runtime/capability-keys.json`, chmods the key store to `0600` where supported, keeps retired public keys available for verification, and records key rotation evidence. Legacy HMAC capabilities remain accepted during migration and emit `legacy_capability_used` audit evidence.

## Governance Loop

The governance loop is:

```text
Agent execution
  -> capability validation
  -> security gate
  -> quality gate
  -> audit evidence
  -> scorecards
  -> routing decisions
  -> completion enforcement
```

`src/governance/summary.js` derives the canonical governance fields from run-local audit evidence and gate results:

```json
{
  "securityAllowed": true,
  "securityDeniedCount": 0,
  "failedCapabilityCount": 0,
  "qualityGateOk": true,
  "qualityViolationCount": 0,
  "completionBlocked": false,
  "approvalRequiredCount": 0,
  "unsafeActionAttemptCount": 0
}
```

Use:

```bash
agentkodex governance summary
agentkodex governance summary --json
```

Completion is blocked when capability validation fails, the security gate denies, quality fails, or governance evidence already marks completion as blocked.

## Quality Gate

The canonical quality gate is:

```bash
agentkodex quality check
npm run quality:gate
agentkodex gates run --gates quality
```

Internal callers use:

```js
const { runQualityGate } = require('./src/gates/qualityGate');

await runQualityGate({
  projectRoot,
  changedFiles,
  mode: 'sandbox_auto',
});
```

The result is always machine-readable:

```json
{
  "ok": true,
  "summary": "Quality gate passed.",
  "checks": [
    {
      "name": "eslint",
      "ok": true,
      "errors": 0,
      "warnings": 0,
      "details": []
    }
  ],
  "filesChecked": [],
  "blockedReason": null
}
```

Current checks:

- discovered lint command, reported as `eslint`
- discovered typecheck command
- discovered Ruff command when available
- discovered test command
- LOC budget, default 400 lines per source file
- architecture hygiene for checked-in env files and forbidden imports

Command checks run real project commands. Non-zero exits fail the gate. LOC and architecture checks run locally and do not need external packages.
Quality gate results are written to audit evidence and copied into audit bundles when attached to a run.

Lintguard remains available as an optional sidecar or local adapter:

```bash
agentkodex lintguard check --local
agentkodex gates run --gates lintguard
```

## Security Gate

The Agentguard-compatible security gate is:

```js
const { authorizeAgentAction } = require('./src/gates/securityGate');

authorizeAgentAction({
  projectRoot,
  sessionId,
  agentId,
  actionType: 'command',
  command: 'git status',
  files: [],
  capabilityToken,
  untrustedInputs: [],
});
```

It returns:

```json
{
  "allowed": true,
  "reason": "Allowed by Agentkodex policy and Agentguard capability ...",
  "requiredApproval": false,
  "auditRecord": {}
}
```

The gate is deny-by-default for unknown dangerous actions and blocked commands. Command authorization reuses Agentkodex policy plus the Agentguard JSON bridge when Agentguard is available.
Security decisions, denied actions, capability issuance/validation, legacy capability warnings, key rotations, and failed capability checks are written to `.agentkodex/audit/evidence.jsonl` and run-local `audit-evidence.jsonl` when a run directory is available.

## Agent Workflow

Agents should call the quality gate before claiming work is complete:

```bash
agentkodex quality check
```

Agentkodex run/finalize flows can also enforce it:

```bash
agentkodex run --gates quality "complete the task"
agentkodex session finalize last --gates quality
```

If the quality gate fails, completion remains blocked through the normal `failed_gates` status. Audit bundles include governance fields in `manifest.json`, and routing scorecards use governance history as modest score adjustments rather than permanent bans.

## CI Workflow

Use the npm script:

```bash
npm run quality:gate
```

It runs the same CLI path as humans and agents. The command exits non-zero on a red gate.

## Hygiene Rules

The integration must not add:

- telemetry packages
- checked-in env files
- hardcoded test project paths
- public dashboard/API binds without auth
- broad command execution bypasses
- fake pass results

## Remaining Risks

- Python Agentguard remains optional. Agentkodex now owns native issuing, signature validation, expiration checks, action/path checks, and audit evidence for capabilities.
- Complexity, circular dependency, dead import, and dependency-hygiene checks are planned but not yet exhaustive.
- External agent CLIs can still emit sensitive data; Agentkodex redacts before logs, but upstream tools may also write their own files.

## Roadmap

Next integration step:

1. Move Lintguard architecture rules into a reusable rule pack.
2. Expand evidence bundle rendering with a human-readable security timeline.
3. Add dependency hygiene, circular dependency, and dead import checks.
4. Add explicit capability key-rotation CLI controls once rotation policy is finalized.
