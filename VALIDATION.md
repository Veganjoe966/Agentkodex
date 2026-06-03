# Agentkodex v0.3.0 Validation Report

Validated on: 2026-06-03  
Runtime used for validation: Node.js v20.18.1  
Package: `agentkodex@0.3.0`

## Summary

Local validation passed for the production CLI harness, Runtime v2 sessions, audit bundle, Agentguard authorization bridge, Agentkodex quality gate, Lintguard adapter gate, intelligence layer, routing, scorecards, tournaments, swarm execution, policy, discovery, gates, and Cockpit snapshot mode.

## Commands Run

Syntax check:

```bash
npm run lint
npm run typecheck
```

Result: passed.

Automated tests:

```bash
npm test
```

Result:

```text
1..47
# tests 47
# pass 47
# fail 0
```

Agentkodex quality gate:

```bash
npm run quality:gate
```

Result: passed. The JSON output reported `ok: true` and successful `eslint`, `typecheck`, `tests`, `loc`, and `architecture` checks. Command output was captured under `.agentkodex/quality-gate/`.

Agentguard bridge smoke:

```bash
python3 -m py_compile /root/agentguard/Agentguard/agentguard/bridge.py
npm test
```

Result: the Agentguard bridge test authorized a safe command, required approval for a risky package install, and minted a signed explicit-approval capability after `yes`.

Lintguard adapter gate smoke:

```bash
npm run lintguard:check
agentkodex gates run --gates lintguard --quiet
```

Result: Lintguard emitted machine-readable JSON. Focused tests verified sidecar token rejection, valid-token checks, clean local passes, and blocking local lint failures.

CLI boot:

```bash
node bin/agentkodex.js --help
node bin/agentkodex.js doctor
```

Result: both commands booted. `doctor` reported Runtime v2 per-session supervisors and detected local/external CLI availability honestly.

One-command local install:

```bash
npm install -g .
agentkodex --help
agentkodex doctor
```

Result: global install completed and the installed `agentkodex` binary booted.

Sample project validation:

```bash
TMP=$(mktemp -d)
cp -R examples/sample-js/. "$TMP/"
rm -rf "$TMP/.agentkodex"

node bin/agentkodex.js quickstart --cwd "$TMP"
node bin/agentkodex.js init --cwd "$TMP"
node bin/agentkodex.js discover --cwd "$TMP"
node bin/agentkodex.js session start --cwd "$TMP" --agent shell --command "node -e \"console.log('hello agentkodex')\"" --mode sandbox_auto --yes --wait --gates none "smoke"
node bin/agentkodex.js session replay --cwd "$TMP" last
node bin/agentkodex.js gates run --cwd "$TMP" --gates lint,test,build --yes --quiet
node bin/agentkodex.js session finalize --cwd "$TMP" last --gates lint,test,build --yes --quiet --force
node bin/agentkodex.js cockpit --cwd "$TMP" --once
```

Result:

- `init` discovered 5 commands.
- `quickstart` wrote `.agentkodex/QUICKSTART.md` with discovered commands, gates, agent availability, and next commands.
- replay showed `hello agentkodex` and `[exit 0]`.
- gates `lint`, `test`, and `build` all exited 0 with per-gate output logs.
- session finalization wrote final report and passed QA.
- Cockpit snapshot reported one completed shell session and zero pending approvals.

Intelligence layer validation:

```bash
node bin/agentkodex.js intelligence rebuild --cwd "$TMP"
node bin/agentkodex.js route --cwd "$TMP" "run validation checks"
node bin/agentkodex.js agents scorecards --cwd "$TMP"
```

Result:

- intelligence profiles written under `.agentkodex/intelligence/`
- router selected `shell` from real scorecard history
- scorecards reported one shell run with 100% success and gate pass rate

Tournament validation:

```bash
node bin/agentkodex.js tournament --cwd "$TMP" --agents local --task "validate sample" --gates test --quiet
```

Result: wrote `.agentkodex/tournaments/<id>/manifest.json`, `results.json`, `scorecard.json`, and `summary.md`.

Audit bundle validation:

```bash
node bin/agentkodex.js audit-bundle --cwd "$TMP" last
```

Result: wrote an audit bundle with `manifest.json`, `summary.md`, redaction report, copied evidence artifacts, and missing-file records where applicable.

Swarm validation:

```bash
node bin/agentkodex.js swarm --cwd "$TMP" --builder shell --builder-command "node -e \"console.log('builder')\"" --wait --mode sandbox_auto --yes "swarm smoke"
```

Result: wrote `.agentkodex/swarms/<id>/manifest.json` and `summary.md`; the builder phase reused Runtime v2 session execution.

## Coverage Added

- discovery: Java, .NET, e2e, Taskfile
- policy: observe-mode read-only enforcement, manual approval patterns, redaction
- Agentguard: local JSON bridge, signed capability evidence, approval-required command gating
- Agentkodex quality gate: CLI/API/CI entrypoints, real lint/type/test failures, LOC budget, forbidden imports, completion blocking, JSON contract
- Lintguard: sidecar/local JSON gate, token-auth tests, lint/typecheck completion blocking
- control plane: Cockpit token auth, public-host guard, daemon socket token rejection, socket permissions
- LOC guard: source files fail tests if they exceed the 400-line hard cap
- gates: per-gate output capture and gate report
- quickstart: friendly first-run setup and reusable `.agentkodex/QUICKSTART.md`
- audit bundle: manifest, summary, missing list, redaction
- intelligence: persisted profiles and historical scorecards
- router: scorecard-backed routing with insufficient-history behavior
- tournament: required artifacts and configurable winner strategy
- swarm: Runtime v2-backed phase orchestration with honest skipped phases

## Known Limitations

- External proprietary CLIs are not bundled. Detection reports missing unless installed and authenticated locally.
- Token/cost metrics are recorded only when a provider/tool exposes them in run metadata.
- Swarm phase quality depends on the configured external CLI or explicit shell command.

Final status: `VALIDATED: PASS`.
