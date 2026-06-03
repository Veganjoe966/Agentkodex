# Agentkodex Architecture

Agentkodex is a local-first, CLI-native control plane for coding agents. It is built around one principle: the terminal is the agent's operating environment, and Agentkodex is the harness that supervises, records, validates, and releases the work.

## Layers

```text
User task
  ↓
Agentkodex CLI / Cockpit UI
  ↓
Intake, discovery, plan, mission prompt
  ↓
Agent adapter registry
  ↓
Runtime v2 persistent session supervisor
  ↓
Real shell / real coding CLI / real project commands
  ↓
Quality gates, QA report, security review, final report
  ↓
Project Kodex memory and replayable run bundle
```

## 1. CLI surface

Entrypoint:

```text
bin/agentkodex.js → src/cli.js
```

Primary commands:

```text
init
discover
plan
suggest
run
run --runtime cockpit
gates run
intelligence show/rebuild
route
agents scorecards
audit-bundle
swarm
session start/list/status/send/attach/interrupt/kill/replay/gates/finalize
approvals list/approve/deny
cockpit
daemon status/stop/logs
agents list/detect/set
policy
tournament
replay/status/report/kodex/doctor
```

## 2. Project discovery

Implementation:

```text
src/discovery.js
```

Agentkodex scans real project files:

```text
package.json
pnpm/yarn/npm/bun lockfiles
pyproject.toml / requirements.txt / uv.lock
Cargo.toml
go.mod
Gemfile
pom.xml / build.gradle
Makefile
justfile
Taskfile.yml
Dockerfile / docker-compose.yml
.env.example
.github/workflows/*
README and docs cues
```

Discovery produces command memory:

```text
.agentkodex/project.kodex.md
.agentkodex/commands.kodex.json
```

## 3. Kodex memory layer

Implementation:

```text
src/kodexStore.js
```

Project memory lives at:

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
```

This layer records durable knowledge: commands, gates, known error signatures, default agent config, policy preferences, last run, last session, and replayable history.

## 4. Agent adapter registry

Implementation:

```text
src/agents.js
```

Adapters are command-template based. Built-ins:

```text
local
shell
codex
claude-code
aider
gemini
opencode
cursor
copilot
custom
```

Command templates support:

```text
{promptFile}
{prompt}
{cwd}
{runDir}
{task}
```

This lets Agentkodex control external agent CLIs without coupling itself to a single vendor.

## 5. Runtime v2 persistent session cockpit

Core files:

```text
src/runtime/sessionManager.js
src/runtime/supervisor.js
src/runtime/sessionStore.js
src/runtime/sessionPaths.js
src/runtime/sessionRecord.js
src/runtime/sessionIo.js
src/runtime/sessionApprovalStore.js
src/runtime/sessionProcess.js
src/runtime/approvalQueue.js
src/runtime/stateDetector.js
src/runtime/attach.js
src/runtimeCli.js
src/cockpit.js
```

The Runtime v2 model is per-session supervision:

1. `sessionManager.startAgentSession()` creates the run bundle, project discovery, task brief, plan, mission prompt, session metadata, and control socket.
2. It launches `src/runtime/supervisor.js` as a detached Node process.
3. The supervisor spawns the selected command or CLI agent.
4. The supervisor captures stdout/stderr, writes `transcript.log`, emits `session-events.ndjson`, updates `session.json`, and serves control actions over a local Unix socket / named pipe.
5. CLI commands and Cockpit APIs send actions into that control socket.

Supported live actions:

```text
status
send
approve
deny
interrupt
kill
close_stdin
```

## 6. Terminal state and approval detection

Implementation:

```text
src/runtime/stateDetector.js
```

Agentkodex detects high-level states from terminal output:

```text
starting
agent_running
command_running
tests_running
dev_server_running
awaiting_approval
error_present
completed_signal
completed
failed
stopped
```

It detects approval prompts such as:

```text
Approve?
Allow?
Continue?
Proceed?
[y/n]
yes/no
press enter
select an option
```

Detected approvals are written to both:

```text
.agentkodex/approvals.json
.agentkodex/sessions/<session-id>/approvals.json
```

## 7. Cockpit UI and API

Implementation:

```text
src/cockpit.js
```

The Cockpit is a dependency-free local HTTP UI.

Endpoints:

```text
GET  /api/health
GET  /api/status
GET  /api/sessions
GET  /api/approvals
GET  /api/sessions/:id
GET  /api/sessions/:id/transcript
GET  /api/sessions/:id/events
POST /api/sessions/:id/send
POST /api/sessions/:id/interrupt
POST /api/sessions/:id/kill
POST /api/sessions/:id/close-stdin
POST /api/sessions/:id/finalize
POST /api/approvals/:id/approve
POST /api/approvals/:id/deny
```

The UI shows sessions, transcript, events, approval cards, and live controls.

## 8. Quality gates and finalization

Core files:

```text
src/run.js
src/sessionRunner.js
src/security.js
src/runtime/sessionManager.js
```

Finalization runs discovered gates such as:

```text
lint
test
build
e2e
```

It writes:

```text
gate-results.json
gate-report.md
gate-outputs/
learned-errors.json
diff.patch
diff.stat
security-report.json
security-report.md
qa-report.json
qa-report.md
final-report.md
```

## 9. Intelligence layer

Core files:

```text
src/intelligence/
src/router/
src/scorecards/
src/core/scoring/
```

Agentkodex persists repo intelligence under:

```text
.agentkodex/intelligence/
  project-profile.json
  stack-profile.json
  command-profile.json
  dependency-profile.json
  historical-failures.json
  historical-fixes.json
  agent-performance.json
  profile.md

.agentkodex/agents/
  scorecards.json
```

The router uses real scorecards only. If no run history exists, it reports `insufficient history`.

## 10. Tournament mode

Implementation:

```text
src/tournament/
src/core/scoring/
```

Tournament mode runs a task against multiple agents in isolated workspace copies, executes gates, collects metrics, updates scorecards, and writes:

```text
.agentkodex/tournaments/<id>/
  manifest.json
  results.json
  scorecard.json
  summary.md
```

Winner selection is configurable through the shared scoring engine.

## 11. Swarm execution

Core files:

```text
src/swarm/
src/runtime/sessionManager.js
```

Swarm execution coordinates phase-specific Runtime v2 sessions:

```text
research -> planner -> builder -> reviewer -> qa -> security -> release
```

Shell/local phases require explicit commands and are recorded as skipped when no real command is supplied.

## 12. Audit bundle

Core files:

```text
src/audit/
```

`agentkodex audit-bundle` packages selected run/session evidence into a local bundle with `manifest.json`, `summary.md`, redacted transcript/log artifacts, missing-file records, and redaction report. It never copies `.env`, `node_modules`, vendor folders, build output, or the full repo.

## 13. Safety and policy

Implementation:

```text
src/policy.js
```

Agentkodex classifies commands and enforces runtime modes:

```text
observe
supervised
sandbox_auto
trusted_auto
```

Policy can allow, require approval, or block. Secret redaction is applied to command output and logs.

## Runtime v2 run loop

```text
1. Parse task and flags.
2. Ensure .agentkodex memory exists.
3. Discover project stack and commands.
4. Build task brief, implementation plan, and mission prompt.
5. Resolve selected agent command/template.
6. Classify command through policy.
7. Create run directory and session metadata.
8. Start detached supervisor process.
9. Supervisor starts the selected CLI command.
10. Capture transcript/events and update session state.
11. User can attach/send/interrupt/approve/deny/kill.
12. Finalize session by running quality gates.
13. Capture diff, QA, security, and final report.
14. Update Kodex memory.
```
