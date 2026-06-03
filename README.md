# Agentkodex

**Agentkodex is the local control plane above coding CLIs.**

It runs Codex CLI, Claude Code, Aider, Gemini CLI, OpenCode, Cursor CLI, Copilot CLI, shell agents, and custom commands inside real terminal sessions, then records, scores, routes, audits, replays, and validates the work end to end.

Agentkodex is not another coding chatbot or scaffold generator. It is the runtime harness around the tools developers already use: package managers, git, tests, builds, deployment CLIs, approval prompts, logs, and long-lived terminal workflows.

## Latest update

Agentkodex now includes direct execution-path capability enforcement:

- Runtime v2, shell/custom agent commands, swarm phases, tournament contestants, and audit helper commands require scoped signed capabilities before command launch.
- Capabilities verify `sessionId`, `agentId`, `phase`, action type, path scope, expiration, and signature.
- New capabilities are signed with native Ed25519 keys under `.agentkodex/runtime/`, with multiple verification keys and HMAC compatibility-mode warnings during migration.
- Failed capability checks, denied actions, security decisions, quality gate results, legacy capability use, and key rotations are written as audit evidence.
- Audit bundles include governance fields and run-local evidence when available.
- Audit bundles can be verified with `agentkodex audit verify <bundle-dir> --json`.
- Routing and scorecards track `securityAllowed`, `securityDeniedCount`, `failedCapabilityCount`, `qualityGateOk`, `qualityViolationCount`, `completionBlocked`, `approvalRequiredCount`, and `unsafeActionAttemptCount`.
- `agentkodex governance summary --json` shows machine-readable governance status for the latest run or aggregate root evidence.
- The regression suite includes `runtime execution path denies command without valid capability`.
- `agentkodex.quality.json`, `agentkodex.policy.json`, and `npm run release:gate` provide local-first production gates.

## One-command install

Recommended npm install:

```bash
npm install -g agentkodex@latest
```

The npm package includes a global postinstall check that repairs common PATH issues without `sudo`. If npm installs Agentkodex into a global prefix that is not on your shell PATH, it creates a safe launcher where possible or adds the npm bin directory to your shell profile.

Then verify:

```bash
agentkodex --help
agentkodex doctor
```

If a locked-down shell still cannot find the command immediately, this always works:

```bash
npx -y agentkodex@latest doctor
```

One-shot installer:

```bash
curl -fsSL https://raw.githubusercontent.com/Veganjoe966/Agentkodex/main/install.sh | sh
```

The one-shot installer uses npm first, shows an interactive install animation, repairs common npm PATH issues, and falls back to `npm install -g github:Veganjoe966/Agentkodex#main` if the npm registry package is unavailable. It never runs `sudo`.

Install from GitHub explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/Veganjoe966/Agentkodex/main/install.sh | sh -s -- --source github
```

## First run

Inside a project, start with one friendly setup command:

```bash
agentkodex quickstart
```

It initializes `.agentkodex/`, discovers commands, rebuilds repo intelligence, checks available agents, suggests gates, writes `.agentkodex/QUICKSTART.md`, and prints the next commands to run.

## What is included in this build

This is a working Node.js CLI package with no required third-party runtime dependencies.

Implemented capabilities:

- `agentkodex init` project memory setup.
- `agentkodex discover` command discovery for Node, Python, Go, Rust, Ruby, Java, .NET, Makefile, Justfile, Taskfile, Docker, Compose, GitHub Actions, and env examples.
- Adapter registry for `local`, `shell`, `codex`, `claude-code`, `aider`, `gemini`, `opencode`, `cursor`, `copilot`, and `custom`.
- One-shot run mode with discovered quality gates, transcripts, policy logs, QA report, security report, diff capture, and final report.
- **Runtime v2 persistent sessions** with per-session supervisors, local sockets, transcript replay, event logs, send/interrupt/kill/finalize controls, and approval detection.
- **Agentkodex Cockpit**, a dependency-free local browser UI for sessions, transcripts, approvals, and live control.
- Approval queue for risky commands and terminal prompts.
- Tournament mode for comparing multiple agents on the same task in isolated repo copies with metrics, configurable winner strategy, and scorecards.
- Repo intelligence profiles, agent routing, agent scorecards, local audit bundles, and swarm execution orchestration.
- Policy engine with safe, approval-required, and blocked command categories.
- Optional first-party Agentguard capability bridge for signed command authorization before execution.
- Scoped Agentguard-compatible capabilities enforced at command launch boundaries.
- Agent operations gates: `agentkodex quality check` for completion quality and an Agentguard-compatible security gate interface.
- Config-driven Lintguard governance through `agentkodex.quality.json`.
- Config-driven Agentguard policy through `agentkodex.policy.json`.
- Optional Lintguard sidecar quality gate via `agentkodex lintguard check`.
- Release validation through `npm run release:gate`.
- Secret redaction in logs.
- Test suite covering discovery, policy, one-shot runs, Runtime v2 sessions, daemon compatibility, Cockpit API, and command execution.

Agentkodex does **not** bundle paid or proprietary coding-agent CLIs. Install your preferred agents separately, then Agentkodex controls them through the terminal.

## Requirements

- Node.js 18+
- A Unix-like shell is recommended for best terminal behavior.
- Optional external coding agents on `PATH`, such as `codex`, `claude`, `aider`, `gemini`, `opencode`, or `cursor-agent`.
- Optional Agentguard source path for capability signing, set with `AGENTGUARD_SOURCE=/path/to/Agentguard` or `.agentkodex/config.json`.

## Install locally from a checkout

From this folder:

```bash
npm install
npm link
agentkodex --help
```

Or run without linking:

```bash
node bin/agentkodex.js --help
```

## Fast start

Inside any software project:

```bash
agentkodex quickstart
agentkodex quality check
agentkodex governance summary --json
agentkodex gates run --gates lint,test,build
agentkodex lintguard check --local
agentkodex cockpit
```

Run a persistent Runtime v2 session:

```bash
agentkodex run \
  --runtime cockpit \
  --agent shell \
  --command "npm test" \
  --mode sandbox_auto \
  --yes \
  --wait \
  "Run tests through Runtime v2"
```

Use a real coding agent CLI:

```bash
agentkodex run \
  --runtime cockpit \
  --agent claude-code \
  --mode supervised \
  --wait \
  "Add password reset and verify it end to end"
```

Configure a custom agent:

```bash
agentkodex agents set custom --cmd "my-agent --prompt-file {promptFile} --cwd {cwd}"
agentkodex run --runtime cockpit --agent custom "Build the billing settings page"
```

## Runtime v2 commands

```bash
agentkodex session start --agent shell --command "node -e 'console.log(123)'" --mode sandbox_auto --yes "Smoke test"
agentkodex session list
agentkodex session status last
agentkodex session attach last
agentkodex session send last "Run the tests now"
agentkodex session interrupt last
agentkodex session kill last
agentkodex session replay last
agentkodex session finalize last --gates lint,test,build --yes
```

## Intelligence layer

```bash
agentkodex intelligence rebuild
agentkodex intelligence show
agentkodex agents scorecards
agentkodex route "large refactor"
agentkodex governance summary
```

The intelligence layer persists real local history under `.agentkodex/intelligence/` and `.agentkodex/agents/`. If no run history exists, routing and scorecards report `insufficient history` instead of inventing metrics.

Stored profiles include:

- project profile
- stack profile
- command profile
- dependency profile
- historical failures and fixes
- agent performance scorecards

## Tournament mode

```bash
agentkodex tournament \
  --agents codex,claude-code,aider \
  --mode sandbox_auto \
  --gates test,build \
  --winner balanced \
  --task "Fix the failing auth tests"
```

Each tournament runs agents in isolated workspace copies and writes:

```text
.agentkodex/tournaments/<id>/
  manifest.json
  results.json
  scorecard.json
  summary.md
```

Metrics include completion, lint/test/build/e2e status, duration, approval count, files changed, diff size, token/cost data when available, and gate outcomes.
Scorecards also include governance signals so routing can modestly penalize denied actions, failed capability validation, unsafe attempts, repeated quality failures, approval-heavy agents, and blocked completions.

## Swarm execution

```bash
agentkodex swarm \
  --builder claude-code \
  --reviewer codex \
  --qa shell \
  --qa-command "npm test" \
  --wait \
  "Ship the billing fix"
```

Swarm phases reuse Runtime v2 sessions. For deterministic `shell` or `local` phases, Agentkodex requires an explicit phase command and records skipped phases honestly when no command is provided.

## Audit bundle

```bash
agentkodex audit-bundle
agentkodex audit-bundle last
agentkodex audit-bundle --run <run-id>
agentkodex audit-bundle --session <session-id>
agentkodex audit-bundle --out ./audit-output --format dir
```

Audit bundles copy only run/session evidence, redact secrets before writing artifacts, skip heavy or unrelated paths, and list missing files in `manifest.json`.

`--wait` on `session start` waits for the agent process and then automatically runs configured gates/finalization. Use `--no-finalize` when you want to wait for exit but manually run gates later.

When a session is started with `--wait`, Agentkodex waits for the agent process to exit and then finalizes the run by executing discovered gates unless `--gates none` or `--no-finalize` is supplied.

## Cockpit UI

Start the local UI:

```bash
agentkodex cockpit --host 127.0.0.1 --port 3919
```

Cockpit API requests require a bearer token stored at `.agentkodex/runtime/cockpit.token`. Start with `--show-token` when you need to paste it into a browser or automation client. Binding to a non-loopback host is refused unless `--unsafe-public` is explicit.

Cockpit provides:

- session list
- live transcript view
- send messages into a running session
- interrupt/kill controls
- pending approvals
- finalize controls
- JSON API endpoints for automation

Useful API endpoints:

```text
GET  /api/health
GET  /api/status
GET  /api/sessions
GET  /api/approvals
GET  /api/sessions/:id/transcript
GET  /api/sessions/:id/events
POST /api/sessions/:id/send
POST /api/sessions/:id/interrupt
POST /api/sessions/:id/kill
POST /api/sessions/:id/finalize
POST /api/approvals/:id/approve
POST /api/approvals/:id/deny
```

## Project memory

Agentkodex writes durable local memory under the target repo:

```text
.agentkodex/
  config.json
  project.kodex.md
  commands.kodex.json
  errors.kodex.json
  approvals.json
  agents/
  audit/
  intelligence/
  runs/
  sessions/
  swarms/
  tournaments/
  prompts/
```

A Runtime v2 run stores:

```text
.agentkodex/runs/<run-id>/
  task-brief.yaml
  plan.md
  mission.prompt.md
  transcript.log
  session-events.ndjson
  commands.log
  policy.log
  gate-results.json
  gate-report.md
  gate-outputs/
  qa-report.md
  security-report.md
  final-report.md
  diff.patch
```

## Supported adapters

| Adapter | Default executable/template | Notes |
|---|---|---|
| `local` | built-in | Plans, discovers, runs gates; does not edit code by itself. |
| `shell` | explicit `--command` | Useful for smoke tests and scripted workflows. |
| `codex` | `codex` | External Codex CLI on `PATH`. |
| `claude-code` | `claude` | External Claude Code CLI on `PATH`. |
| `aider` | `aider --message-file {promptFile}` | External Aider CLI. |
| `gemini` | `gemini` | External Gemini CLI. |
| `opencode` | `opencode` | External OpenCode CLI. |
| `cursor` | `cursor-agent` | External Cursor agent CLI. |
| `copilot` | `gh copilot suggest {prompt}` | External GitHub CLI Copilot extension; not bundled. |
| `custom` | configured by user | Bring your own coding-agent command. |

Template variables:

```text
{promptFile} {prompt} {cwd} {runDir} {task}
```

## Safety model

Command execution now follows this path when Agentguard is available:

```text
Agentkodex Node runtime
  -> Agentguard authorization bridge
  -> policy/capability decision
  -> execute only when both layers allow it
```

Agentguard writes signed capability evidence and audit events under `.agentkodex/runtime/`. If Agentguard is unavailable, Agentkodex falls back to its built-in JS policy unless `.agentkodex/config.json` sets `agentguard.required` to `true`.

Modes:

- `observe`: permits only read-only inspection commands.
- `supervised`: safe commands run; unknown/risky commands require approval.
- `sandbox_auto`: broader command allowance for disposable workspaces, but approval-required commands still need explicit `--yes`.
- `trusted_auto`: broad local automation; destructive/production actions still require explicit `--yes`, and blocked commands still fail.

Blocked by default:

- destructive `rm -rf /` style commands
- `sudo`
- broad permission changes
- credential-directory reads
- curl/wget pipe-to-shell
- production-looking dangerous operations

Approval-required examples:

- package installs
- Docker up/build/run
- git push/reset/clean/commit
- deploy commands
- migrations

## Quality and Lintguard Gates

The canonical Agentkodex completion gate is:

```bash
agentkodex quality check
npm run quality:gate
agentkodex gates run --gates quality
```

It emits machine-readable JSON with `ok`, `summary`, `checks`, `filesChecked`, and `blockedReason`. The gate runs real discovered lint/typecheck/Ruff/test commands when present, then enforces local LOC and architecture hygiene checks. A failed quality gate blocks completion through the normal `failed_gates` status.

Agentkodex can run Lintguard as a local or sidecar-backed completion gate:

```bash
agentkodex lintguard check --local
agentkodex gates run --gates lintguard
npm run lintguard:check
```

For a running Lintguard sidecar:

```bash
export LINTGUARD_URL=http://127.0.0.1:8001
export LINTGUARD_API_TOKEN=replace-with-local-secret
agentkodex lintguard check --url "$LINTGUARD_URL" --auth-enabled
```

The Lintguard command always returns JSON with `ok`, `violations`, `errors`, `warnings`, `filesChecked`, and `commandOutputs`. See `docs/LINTGUARD_AGENTKODEX_INTEGRATION.md` and `docs/AGENT_OPERATIONS_PLATFORM.md`.

## Development

Run the full test suite:

```bash
npm test
npm run quality:gate
```

Run a local smoke test against the included sample project:

```bash
TMP=$(mktemp -d)
cp -R examples/sample-js/. "$TMP/"
node bin/agentkodex.js run --cwd "$TMP" --skip-agent --yes "Verify sample project"
node bin/agentkodex.js run --runtime cockpit --cwd "$TMP" --agent shell --command "node -e \"console.log('runtime ok')\"" --mode sandbox_auto --yes --wait "Runtime smoke"
```

## Current limitation

Agentkodex provides the harness, runtime, memory, approval, validation, and control plane. Intelligent code editing still comes from the external coding-agent CLI you choose. The included `shell` and `local` adapters are intentionally deterministic so the harness can be tested without paid agent credentials.
