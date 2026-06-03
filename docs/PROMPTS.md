# Agentkodex Prompt Stack

The production prompt stack is generated in `src/prompts.js` and written into each run as `mission.prompt.md`.

## Purpose

Agentkodex does not ask a coding model to act like a vague assistant. It gives the selected CLI agent a strict terminal-native mission:

- use the real repository
- respect discovered project commands
- operate through the CLI
- make small verifiable changes
- run validations
- report exact outcomes
- avoid destructive or unrelated work

## CLI Builder Agent Mission

The selected CLI coding agent receives a mission prompt with:

- the original user task
- structured task brief
- discovered Project Kodex
- implementation plan
- known error memory
- selected gates
- Runtime v2 operating rules

## Runtime v2 Operating Rules

1. Treat the terminal as the source of truth.
2. Start by checking repository state with safe read-only commands.
3. Prefer discovered project commands over generic guesses.
4. Make changes incrementally and avoid unrelated edits.
5. After a meaningful change, run the smallest relevant validation command.
6. If a command fails, inspect exact stdout/stderr, fix the root cause, and rerun the relevant command.
7. Do not expose secrets.
8. Do not run destructive commands.
9. Do not mark work complete until quality gates pass or failures are clearly documented.
10. Keep final output structured: summary, files changed, commands run, tests passed/failed, and remaining risks.

## Task Brief

The task brief is YAML-like and includes:

- goal
- project name
- languages
- frameworks
- package manager
- selected agent
- autonomy mode
- required gates
- acceptance criteria
- risk notes

## Plan

The plan includes:

- project understanding
- execution phases
- required gate commands
- definition of done

## Files generated per Runtime v2 run

```text
.agentkodex/runs/<run-id>/task-brief.yaml
.agentkodex/runs/<run-id>/plan.md
.agentkodex/runs/<run-id>/mission.prompt.md
.agentkodex/runs/<run-id>/selected-gates.json
```

The mission prompt is sent to stdin for interactive CLIs that support stdin, or passed through a command-template variable such as `{promptFile}` for file-based CLIs like Aider/custom tools.
