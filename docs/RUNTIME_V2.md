# Agentkodex Runtime v2

Runtime v2 is the persistent interactive execution layer for Agentkodex. It is what turns Agentkodex from a one-shot command runner into a CLI-native agent cockpit.

## What Runtime v2 gives you

```text
- Start a real terminal-backed agent session.
- Keep the session alive after the starting CLI command returns.
- Send additional messages into the same process.
- Interrupt or kill a stuck process.
- Close stdin cleanly.
- Detect approval prompts and queue approval decisions.
- Replay the transcript and structured events.
- Finalize the session with lint/test/build gates.
- Open a local web Cockpit for session control.
```

## Basic workflow

```bash
agentkodex init
agentkodex discover
agentkodex session start --agent shell --command "npm test" --mode sandbox_auto --yes "Run tests"
agentkodex session status last
agentkodex session replay last
agentkodex session finalize last --gates test,build --yes
agentkodex audit-bundle last
```

## Live interactive workflow

```bash
agentkodex session start \
  --agent shell \
  --command "node interactive.js" \
  --mode sandbox_auto \
  --yes \
  --no-initial-prompt \
  "Interactive session"

agentkodex session send last "hello"
agentkodex session send last "run tests now"
agentkodex session close-stdin last
agentkodex session replay last
```

## Real agent workflow

```bash
agentkodex session start \
  --agent codex \
  --mode supervised \
  "Add Stripe checkout and verify with tests"
```

Agentkodex will create a mission prompt, launch the configured Codex command, stream the prompt to stdin if configured, and keep the session under supervisor control.

## Approval workflow

When terminal output appears to request confirmation, Agentkodex creates an approval item.

```bash
agentkodex approvals list
agentkodex approvals approve last
agentkodex approvals deny last
```

The approve/deny command sends the configured response into the live session.

## Cockpit workflow

```bash
agentkodex cockpit
```

The Cockpit provides a local browser UI for:

```text
- sessions
- transcripts
- structured events
- send controls
- interrupt/kill/close-stdin controls
- approvals
```

## Files written

Session metadata:

```text
.agentkodex/sessions/<session-id>/session.json
.agentkodex/sessions/<session-id>/metadata.json
.agentkodex/sessions/<session-id>/approvals.json
.agentkodex/sessions/<session-id>/supervisor.log
```

Run bundle:

```text
.agentkodex/runs/<run-id>/transcript.log
.agentkodex/runs/<run-id>/session-events.ndjson
.agentkodex/runs/<run-id>/gate-results.json
.agentkodex/runs/<run-id>/gate-report.md
.agentkodex/runs/<run-id>/gate-outputs/
.agentkodex/runs/<run-id>/qa-report.md
.agentkodex/runs/<run-id>/security-report.md
.agentkodex/runs/<run-id>/final-report.md
```

Audit bundle:

```text
.agentkodex/audit/<bundle-id>/manifest.json
.agentkodex/audit/<bundle-id>/summary.md
.agentkodex/audit/<bundle-id>/redaction-report.json
.agentkodex/audit/<bundle-id>/<redacted artifacts>
```

## Intelligence and orchestration

Runtime v2 is reused by higher-level orchestration:

- `agentkodex tournament` runs the same task in isolated workspaces and scores real gate/session outcomes.
- `agentkodex swarm` starts phase-specific Runtime v2 sessions for builder/reviewer/QA/security/release flows.
- `agentkodex route` uses persisted scorecards from real runs and returns `insufficient history` when no data exists.

## Design notes

Runtime v2 uses detached per-session supervisors instead of one required global daemon. This keeps the system simple, local, inspectable, and dependency-free. A compatibility daemon/client exists for tests and future expansion, but the primary production path is per-session supervision.
