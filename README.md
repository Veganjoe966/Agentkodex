<p align="center">
  <img src="docs/assets/agentkodex-banner.svg" alt="Agentkodex banner">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agentkodex"><img alt="npm" src="https://img.shields.io/npm/v/agentkodex?style=for-the-badge&color=38bdf8"></a>
  <a href="https://github.com/Veganjoe966/Agentkodex/actions/workflows/release-gate.yml"><img alt="release gate" src="https://img.shields.io/github/actions/workflow/status/Veganjoe966/Agentkodex/release-gate.yml?branch=main&style=for-the-badge&label=release%20gate"></a>
  <img alt="Node.js 18+" src="https://img.shields.io/badge/node-%3E%3D18-34d399?style=for-the-badge">
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-a78bfa?style=for-the-badge">
  <img alt="local first" src="https://img.shields.io/badge/local--first-runtime-0f172a?style=for-the-badge">
</p>

<h1 align="center">Agentkodex</h1>

<p align="center">
  <strong>The chat-first control plane for AI coding agents.</strong><br>
  Ask once. Agentkodex uses your coding agents, runs gates, audits evidence, and returns the best answer or patch.
</p>

<p align="center">
  <code>agentkodex setup</code> ·
  <code>agentkodex ask "Explain this project"</code> ·
  <code>agentkodex chat</code>
</p>

## Start Here

```bash
curl -fsSL https://raw.githubusercontent.com/Veganjoe966/Agentkodex/main/install.sh | sh
agentkodex setup
agentkodex ask "Explain this project"
```

Prefer npm directly:

```bash
npm install -g agentkodex
agentkodex setup
```

Agentkodex sits above coding CLIs such as Codex CLI, Claude Code, Aider, Gemini CLI, OpenCode, Cursor CLI, Copilot CLI, shell agents, and custom command agents. It does not pretend to be the model. It gives your agents a controlled runtime, quality gates, policy checks, replayable evidence, and a simple chat-first interface.

## What It Feels Like

```text
$ agentkodex ask "Fix failing tests"

Agentkodex used Codex CLI.
Reason: best history for validation work in this repo.

Result:
...

Evidence:
.agentkodex/asks/2026...
```

For harder or riskier work, Agentkodex can compare candidates automatically:

```text
$ agentkodex ask "Review this auth refactor"

Agentkodex compared 2 agents.

Winner: Claude Code
Reason: passed gates and produced the clearer review.
```

The primary product stays simple: ask a question, get the best response. Strategy, routing, scoring, isolated workspaces, gates, and audit bundles stay behind the scenes unless you ask for advanced controls.

## Why Agentkodex

| Need | What Agentkodex does |
| --- | --- |
| Use the coding agents you already installed | Detects ready CLIs and preserves manual adapter config. |
| Avoid running every agent every time | Uses task reputation and confidence to route quickly when history is strong. |
| Compare when it matters | Runs multiple candidates for uncertain, risky, or explicitly compared tasks. |
| Keep patches safe | Runs patch candidates in isolated workspaces and applies only the winner when requested. |
| Trust the result | Saves artifacts, scorecards, audit evidence, and replayable run data. |

## Primary Workflow

### 1. Setup

```bash
agentkodex setup
agentkodex agents
```

Setup detects installed coding CLIs and marks an adapter ready only after safe readiness checks. Agentkodex does not read, copy, print, or store external CLI credentials.

### 2. Ask

```bash
agentkodex ask "Explain this project"
agentkodex ask --mode review "Review security risks"
agentkodex ask --mode patch "Fix failing tests"
```

Modes:

| Mode | Behavior |
| --- | --- |
| `answer` | Read-only answer mode for explanations and repo questions. |
| `review` | Read-only review mode for risks, bugs, architecture, and security analysis. |
| `patch` | Isolated workspace patch mode. Host files are not changed by default. |
| `auto` | Infers answer, review, or patch intent from the prompt. |

Apply the winning patch only when you mean it:

```bash
agentkodex ask --mode patch --apply-winner --yes "Fix failing tests"
```

### 3. Chat

```bash
agentkodex chat
agentkodex chat --list
```

Chat reuses the same ask backend, persists conversation history, and keeps evidence references for later review.

## How Strategy Works

Agentkodex learns per task category. Reputation is not one global score.

| Prompt type | Strategy example |
| --- | --- |
| "Fix failing tests" | Use the best validation agent when confidence is high. |
| "Review architecture" | Prefer the agent with architecture-review history, even if another agent has more test-fix wins. |
| "High-risk auth refactor" | Compare candidates and use internal scoring when confidence is low. |

Internally, the strategy layer looks at readiness, task category, prior wins/losses, gate pass history, mutation metrics, and routing evidence. Normal users do not need to configure that machinery.

## Safety Model

Agentkodex is local-first and fail-closed.

| Safety guarantee | Detail |
| --- | --- |
| No host mutation by default | Patch mode runs in isolated workspaces until `--apply-winner --yes`. |
| No fake readiness | Detected binaries are not treated as ready unless readiness checks pass. |
| No hardcoded provider keys | Agentkodex ships no OpenRouter, OpenAI, Anthropic, or shared provider secrets. |
| No raw hidden reasoning cache | Cache stores final answers, safe summaries, artifacts, and metrics. |
| Non-zero on failure | Failed gates, failed sessions, denied actions, and blocked work exit non-zero. |
| Auditability | Runs can produce audit bundles, anchors, scorecards, and replay evidence. |

## Setup and Readiness

Supported adapter detection includes:

| Adapter | Expected executable |
| --- | --- |
| `codex` | `codex` |
| `claude-code` | `claude` |
| `aider` | `aider` |
| `gemini` | `gemini` |
| `opencode` | `opencode` |
| `cursor` | `cursor-agent` |
| `copilot` | `gh copilot` |
| `shell` | explicit local command |
| `custom` | configured command template |

Readiness states include `missing`, `installed`, `installed_not_authenticated`, `installed_not_noninteractive_ready`, `smoke_failed`, `ready`, `manually_configured`, `degraded`, and `disabled`.

Configure a custom adapter:

```bash
agentkodex agents set custom --cmd "my-agent --prompt-file {promptFile} --cwd {cwd}"
agentkodex agents detect custom
```

## Command Surface

First five commands most users need:

| Command | Purpose |
| --- | --- |
| `agentkodex setup` | Detect ready coding CLIs and save safe adapter templates. |
| `agentkodex agents --json` | Show configured agents and readiness states. |
| `agentkodex ask "..."` | Single-shot chat-first request. |
| `agentkodex chat` | Interactive prompt loop with persisted history. |
| `agentkodex doctor --verify-agents` | Verify project setup and adapter readiness. |

Advanced commands remain available:

| Command | Purpose |
| --- | --- |
| `agentkodex quickstart` | Initialize project memory, discover commands, rebuild intelligence, and print next steps. |
| `agentkodex discover --json` | Detect stack, package manager, project commands, Docker, Make, Just, Taskfile, and CI evidence. |
| `agentkodex session start` | Launch a persistent agent terminal session. |
| `agentkodex session replay last` | Replay transcript or structured events. |
| `agentkodex quality check --json` | Run Lintguard-backed completion quality checks. |
| `agentkodex governance summary --json` | Show security, capability, quality, approval, and completion signals. |
| `agentkodex keys status` | Inspect Ed25519 capability key status without printing private keys. |
| `agentkodex audit-bundle last` | Package reviewable run/session evidence. |
| `agentkodex audit verify ./agentkodex-audit --json` | Verify an audit bundle. |
| `agentkodex audit anchor <bundle>` | Append a tamper-evident anchor record for an audit bundle. |
| `agentkodex audit verify-anchor <bundle>` | Verify an audit bundle against its anchor record. |
| `agentkodex policy check --json` | Evaluate Agentguard policy for project actions. |
| `agentkodex route "task"` | Select the best agent from scorecards and project intelligence. |
| `agentkodex tournament --agents ... --task "..."` | Compare agents in isolated workspaces. |
| `agentkodex swarm --builder ... --reviewer ... --qa ...` | Run phased multi-agent orchestration. |
| `agentkodex cockpit` | Start the local browser cockpit for live session control. |
| `agentkodex release gate` | Run fail-closed release checks for this package. |

`agentkodex release gate` validates the Agentkodex package source before publishing. For customer project validation, use `agentkodex quality check` or `agentkodex gates run`.

## What Gets Saved

Runtime artifacts are stored locally under `.agentkodex/`:

```text
.agentkodex/
  asks/
  chats/
  agents/reputation.json
  runs/<run-id>/
    transcript.log
    session-events.ndjson
    commands.log
    policy.log
    gate-results.json
    final-report.md
    diff.patch
    audit-evidence.jsonl
```

Agentkodex may use exact safe caching when the prompt, repo state, dependencies, gates, quality config, and policy config are unchanged. Cache hits are internal acceleration, not a workflow users need to manage.

## Advanced Infrastructure

The backend stays powerful for users who need it:

| Layer | Responsibility |
| --- | --- |
| Runtime v2 | Persistent terminal sessions, attach/send/interrupt/kill, replay, and finalization. |
| Agentguard | Capability signing, policy checks, action/path scope, approval pressure, and security evidence. |
| Lintguard | ESLint, TypeScript, Ruff, tests, LOC budgets, complexity, dependency hygiene, and quality gates. |
| Routing and scorecards | Evidence-based agent selection from real local history. |
| Tournaments and swarms | Explicit multi-agent orchestration for power users. |
| Audit bundles | Redacted, checksummed evidence with optional tamper-evident anchoring. |

Example Runtime v2 session:

```bash
agentkodex session start --agent shell --command "node -e 'console.log(123)'" --mode sandbox_auto --yes "Smoke"
agentkodex session list
agentkodex session status last --watch
agentkodex session send last "continue"
agentkodex session interrupt last
agentkodex session kill last
agentkodex session finalize last --gates lint,test,build --yes
```

## Verified Release

Latest local release validation verifies:

- `npm test`: passing
- `npm run quality:gate`: passing
- `npm run release:gate`: passing
- packed install smoke: passing
- audit bundle verification: passing
- CLI smoke checks: passing

The README tracks the current package release. If you are reading `main` between releases, run `agentkodex --version` and check [CHANGELOG.md](CHANGELOG.md) before assuming a command is present in your installed npm package.

## Documentation

| Doc | What it covers |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | System shape and module boundaries. |
| [Runtime v2](docs/RUNTIME_V2.md) | Persistent sessions, replay, events, and finalization. |
| [Security model](docs/SECURITY_MODEL.md) | Capabilities, policy, Cockpit, daemon, and audit hardening. |
| [Agent operations platform](docs/AGENT_OPERATIONS_PLATFORM.md) | Agentkodex, Agentguard, and Lintguard integration. |
| [Lintguard](docs/LINTGUARD.md) | Quality gate behavior and config. |
| [Agentguard](docs/AGENTGUARD.md) | Capability lifecycle and policy bridge. |
| [Release gate](docs/RELEASE_GATE.md) | Production validation checks. |
| [CLI](docs/CLI.md) | Command reference. |
| [Adversarial validation](docs/ADVERSARIAL_VALIDATION_REPORT.md) | Security and quality validation report. |

## Development

```bash
npm install
npm test
npm run quality:gate
npm run release:gate
```

Local checkout:

```bash
node bin/agentkodex.js --help
npm link
agentkodex doctor
```

## Current Limit

Agentkodex provides the runtime, governance, memory, auditability, routing, caching, and completion enforcement. Intelligent code editing still comes from whichever external coding-agent CLI you choose to install and authenticate.
