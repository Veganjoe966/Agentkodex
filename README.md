# Agentkodex

**Agentkodex is the local control plane above coding CLIs.**

It runs Codex CLI, Claude Code, Aider, Gemini CLI, OpenCode, Cursor CLI, Copilot CLI, shell agents, and custom commands inside real terminal sessions, then records, scores, routes, audits, replays, and validates the work end to end.

Agentkodex is not another coding chatbot or scaffold generator. It is the runtime harness around the tools developers already use: package managers, git, tests, builds, deployment CLIs, approval prompts, logs, and long-lived terminal workflows.

## One-command install

From a local checkout or unpacked release folder:

```bash
npm install -g .
```

Then verify:

```bash
agentkodex --help
agentkodex doctor
```

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
- Secret redaction in logs.
- Test suite covering discovery, policy, one-shot runs, Runtime v2 sessions, daemon compatibility, Cockpit API, and command execution.

Agentkodex does **not** bundle paid or proprietary coding-agent CLIs. Install your preferred agents separately, then Agentkodex controls them through the terminal.

## Requirements

- Node.js 18+
- A Unix-like shell is recommended for best terminal behavior.
- Optional external coding agents on `PATH`, such as `codex`, `claude`, `aider`, `gemini`, `opencode`, or `cursor-agent`.

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
agentkodex init
agentkodex discover
agentkodex intelligence rebuild
agentkodex route "fix the failing tests"
agentkodex agents list
agentkodex run --skip-agent "Verify the project with discovered gates"
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

Modes:

- `observe`: permits only read-only inspection commands.
- `supervised`: safe commands run; unknown/risky commands require approval.
- `sandbox_auto`: broader command allowance for disposable workspaces, but manual approval is still required for destructive/production actions.
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

## Development

Run the full test suite:

```bash
npm test
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
