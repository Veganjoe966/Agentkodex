# Agentkodex v1.0.2 Validation Report

Validated on: 2026-06-03  
Runtime used for validation: Node.js v20.18.1  
Package: `agentkodex@1.0.2`

## Summary

Local validation passed for the production CLI harness, Runtime v2 sessions, scoped Agentguard capabilities, Ed25519 key CLI, capability revocation, Ed25519 capability migration, governance summaries, verifiable audit bundles, Agentkodex quality gate, Lintguard advanced checks, policy config, release gate, routing, scorecards, tournaments, swarm execution, discovery, gates, installer PATH repair, and Cockpit hardening.

## Commands Run

Syntax check:

```bash
npm run lint
npm run typecheck
sh -n install.sh
```

Result: passed.

Automated tests:

```bash
npm test
```

Result:

```text
1..75
# tests 87
# pass 87
# fail 0
```

Capability enforcement coverage:

- Runtime execution path denies command without valid capability.
- Runtime execution path allows valid scoped capability.
- Expired, wrong-session, wrong-agent, wrong-phase, and wrong-path capabilities are denied.
- Swarm agents cannot reuse another agent capability.
- Tournament contestants cannot reuse another contestant capability.
- Capability failures write audit evidence before returning.
- New capabilities are signed with Ed25519 and include `algorithm` and `keyId`.
- Legacy HMAC capabilities remain accepted in compatibility mode and write migration-warning evidence.
- Key rotation keeps previous verification keys active.
- Key CLI supports `status`, `list --json`, `rotate --json`, and `retire`.
- Retired Ed25519 keys no longer verify existing capabilities.
- Corrupt key stores fail safely and key rotation failure writes audit evidence.
- Revoked capabilities are denied.
- Legacy HMAC capabilities are denied when compatibility is disabled in `agentkodex.policy.json`.
- Policy path scopes prevent issuing out-of-scope capabilities.

Key CLI validation:

```bash
node bin/agentkodex.js keys status
node bin/agentkodex.js keys list –json
node bin/agentkodex.js keys rotate –json
```

Result: all commands passed. JSON output did not include private keys.

Governance visibility:

```bash
node bin/agentkodex.js governance summary --json
```

Result: command boots and returns machine-readable governance fields. Focused tests verify audit bundle manifests, scorecards, routing, and completion enforcement consume the same governance summary.

Agentkodex quality gate:

```bash
npm run quality:gate
```

Result: passed. The JSON output reported `ok: true` and successful `eslint`, `typecheck`, `tests`, `loc`, `architecture`, `complexity`, `circular-deps`, `dead-imports`, `dependency-hygiene`, and `architecture-boundaries` checks. Command output was captured under `.agentkodex/quality-gate/`.

Package dry run:

```bash
npm pack --dry-run --json
```

Result: passed. The package includes `install.sh`, postinstall PATH repair helpers, docs, examples, and source modules while excluding `tests/`.

Release gate:

```bash
npm run release:gate
```

Result: passed. The release gate ran `npm test`, `npm run lint`, `npm run typecheck`, `npm run quality:gate`, policy check, repo hygiene scan, audit bundle verification, temporary package install smoke, and CLI smoke checks.

NPM publish:

Result: not run for `1.0.2` during this hardening pass.

Agentguard bridge smoke:

```bash
python3 -m py_compile "$AGENTGUARD_SOURCE/agentguard/bridge.py"
npm test
```

Result: the Agentguard bridge test authorized a safe command, required approval for a risky package install, and minted a signed explicit-approval capability after `yes`.

Lintguard adapter gate smoke:

```bash
npm run lintguard:check
agentkodex gates run --gates lintguard --quiet
```

Result: Lintguard emitted machine-readable JSON. Focused tests verified sidecar token rejection, valid-token checks, clean local passes, and blocking local lint failures.

Audit bundle CLI:

```bash
node bin/agentkodex.js audit bundle --cwd "$TMP" last
node bin/agentkodex.js audit verify --cwd "$TMP" "$BUNDLE" --json
```

Result: passed. The bundle manifest included a `bundleHash`, artifacts had SHA-256 hashes, and verification returned `ok: true`.

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
- Agentguard: local JSON bridge, Ed25519 signed capability evidence, approval-required command gating
- Agentkodex quality gate: CLI/API/CI entrypoints, real lint/type/test failures, LOC budget, forbidden imports, completion blocking, JSON contract
- Agentguard capabilities: runtime/swarm/tournament/audit/quality phase scopes, direct execution-path checks, Ed25519 signatures, key rotation, legacy HMAC compatibility evidence, failed-validation evidence
- key CLI: status/list/rotate/retire, no private-key output, corrupt-store safe failure, lifecycle audit events
- governance: audit manifest fields, summary CLI, scorecard fields, routing penalties/rewards, completion blocking
- advanced quality checks: complexity, circular dependency, dead imports, dependency hygiene, architecture boundaries
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
