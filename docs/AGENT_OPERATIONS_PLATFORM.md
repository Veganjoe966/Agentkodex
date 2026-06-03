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

If the quality gate fails, completion remains blocked through the normal `failed_gates` status.

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

- Agentguard capability-token validation is bridged through the Python package when available; the Node security gate is still a compatibility interface.
- Complexity, circular dependency, dead import, and dependency-hygiene checks are planned but not yet exhaustive.
- External agent CLIs can still emit sensitive data; Agentkodex redacts before logs, but upstream tools may also write their own files.

## Roadmap

Next integration step:

1. Move Lintguard architecture rules into a reusable rule pack.
2. Add Agentguard signed task capabilities for each agent phase.
3. Record quality/security gate evidence in audit bundles by default.
4. Add dependency hygiene, circular dependency, and dead import checks.
5. Feed quality/security outcomes into routing scorecards.
