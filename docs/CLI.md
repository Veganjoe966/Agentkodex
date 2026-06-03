# Agentkodex CLI

Agentkodex is now chat-first. The normal path is:

```bash
agentkodex setup
agentkodex ask "Explain this project"
agentkodex chat
```

## Setup

```bash
agentkodex setup
agentkodex setup --json
agentkodex agents
agentkodex agents --json
agentkodex doctor --verify-agents
agentkodex discover --verify-agents
```

Setup detects installed coding CLIs, runs safe readiness smoke checks, preserves manual templates, and stores only safe adapter configuration. It does not read, copy, print, or store external CLI auth tokens.

Readiness states include `missing`, `installed_not_authenticated`, `installed_not_noninteractive_ready`, `smoke_failed`, `ready`, `manually_configured`, `degraded`, and `disabled`.

## Ask

```bash
agentkodex ask "Explain this project"
agentkodex ask --mode review "Review security risks"
agentkodex ask --mode patch "Fix failing tests"
agentkodex ask --mode patch --apply-winner --yes "Fix failing tests"
agentkodex ask --compare "Which fix is safest?"
agentkodex ask --json "Explain this project"
```

Modes:

- `answer`: read-only answer mode.
- `review`: read-only review mode.
- `patch`: isolated candidate workspaces; host is not mutated unless `--apply-winner --yes`.
- `auto`: infer the mode from the request.

Latency:

- `--fast`: prefer the strongest historical ready agent.
- `--compare`: compare multiple ready agents.
- `--max`: compare all ready agents.
- default: automatic routing with comparison when useful.

## Chat

```bash
agentkodex chat
agentkodex chat --new
agentkodex chat --resume last
agentkodex chat --list
```

Chat persists conversation id, prompts, chosen agents, winning response, applied patch flag, artifacts path, and cache references under `.agentkodex/chats/`. It stores final outputs and safe summaries, not hidden reasoning or secrets.

## Internal Caching

Caching is backend infrastructure, not a user command. `ask` and `chat` automatically reuse a safe result only when the prompt, mode, selected agents, gates, repo state, policy/quality context, and Agentkodex version match. Cached entries are rejected when the repo changes, a prior result was blocked, or the response looks secret-bearing.

Audit evidence records cache hits, misses, writes, rejections, and secret blocks.

## Advanced Commands

```bash
agentkodex quickstart
agentkodex discover --json
agentkodex session start --agent shell --command "node -e \"console.log('ok')\"" --yes --wait "smoke"
agentkodex session replay last
agentkodex quality check --json
agentkodex governance summary --json
agentkodex policy check --json
agentkodex keys status
agentkodex keys list --json
agentkodex audit bundle last
agentkodex audit verify <bundle-dir> --json
agentkodex tournament --agents codex,claude-code --task "Fix failing tests"
agentkodex swarm --builder codex --reviewer claude-code --qa shell "Fix and verify"
agentkodex release gate --json
```

All JSON commands print JSON only. Secrets and private keys are redacted or omitted.

Install fallback for locked-down shells:

```bash
npx -y agentkodex@latest doctor
```
