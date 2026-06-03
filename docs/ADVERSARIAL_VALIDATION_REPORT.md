# Agentkodex Adversarial Validation Report

Date: 2026-06-03

Scope: hostile validation of capability enforcement, Runtime v2 execution, daemon/socket requests, Cockpit APIs, Lintguard quality gates, completion enforcement, audit integrity, routing/scorecards, and install/release realism.

Verdict: launch-blocking issues found and fixed in this pass. Remaining risks are medium/low and documented below.

## Attack Results

| Area | Attack attempted | Expected result | Actual result | Pass/Fail | Severity | Exploitability | Affected files | Reproduction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime execution | `cat README.md > PWNED` in observe mode | Denied before execution | Denied; no file created | Pass after fix | Critical | Direct command input | `src/policy.js`, `src/policy/shellSafety.js`, `src/sessionRunner.js` | `node --test tests/adversarial_validation.test.js` |
| Runtime secrets | `cat .agentkodex/runtime/capability-keys.json` and daemon token | Denied | Denied as blocked policy | Pass after fix | Critical | Direct command input | `src/policy.js` | `node --test tests/adversarial_validation.test.js` |
| Custom agent launch | `rm -rf ./safe-target` through agent launch path | Approval/deny, no bypass | Denied without approval | Pass after fix | High | Malicious custom config | `src/policy.js`, `src/authorization.js` | `node --test tests/adversarial_validation.test.js` |
| Capability path scope | Valid token reused through symlink escaping allowed path | Denied | Denied before spawn | Pass after fix | Critical | Project symlink | `src/capabilities/pathScope.js`, `src/capabilities/verify.js`, `src/runtime/daemonSecurity.js` | `node --test tests/adversarial_validation.test.js` |
| Daemon live mutation | Valid daemon token but no runtime capability for `send` | Denied | Denied with `Missing Agentguard capability` | Pass after fix | Critical | Local socket caller | `src/runtime/daemonServer.js`, `src/runtime/daemonSecurity.js`, `src/runtime/client.js` | `node --test tests/adversarial_validation.test.js` |
| Daemon malformed JSON | Raw `{bad json}` socket payload | Sanitized denial | Sanitized denial, no stack | Pass | Medium | Local socket caller | `src/runtime/daemonServer.js`, `src/security/controlPlane.js` | inline raw socket probe |
| Daemon unknown method | `{ "type": "nope" }` with valid daemon token | Sanitized denial | Sanitized denial, no stack | Pass | Medium | Local socket caller | `src/runtime/requestGuard.js` | inline raw socket probe |
| Daemon oversized payload | 1 MiB+ socket payload | Denied before parse | Denied with `Daemon request too large` | Pass after fix | Medium | Local socket caller | `src/runtime/daemonServer.js`, `src/runtime/requestGuard.js` | `node --test tests/adversarial_validation.test.js` |
| Cockpit auth | Missing/invalid token on API routes | 401 | 401 | Pass | Critical | Browser/HTTP client | `src/cockpit.js`, `src/cockpitAuth.js`, `src/security/controlPlane.js` | `node --test tests/cockpit.test.js` |
| Cockpit query token | `?token=...` on API route | Rejected | Rejected | Pass after fix | High | Token leakage path | `src/security/controlPlane.js` | inline HTTP probe |
| Cockpit origin | Valid token with hostile `Origin` on API GET/POST | Rejected | Rejected with 403 | Pass after fix | High | Cross-origin HTTP client | `src/security/controlPlane.js`, `tests/cockpit.test.js` | `node --test tests/cockpit.test.js` |
| Cockpit CSRF | Same-origin POST without CSRF header | Rejected | Rejected with 403 | Pass | High | Browser POST | `src/security/controlPlane.js` | inline HTTP probe |
| Lintguard env files | Nested `.env`, `.envrc`, and `prod.env` | Quality gate fails | Quality gate fails | Pass after fix | High | Malicious project files | `src/gates/fileScope.js` | `node --test tests/adversarial_validation.test.js` |
| Lintguard banned imports | Dynamic `import('posthog-js')` | Quality gate fails | Quality gate fails | Pass after fix | High | Malicious source | `src/gates/advancedChecks.js` | `node --test tests/adversarial_validation.test.js` |
| Lintguard missing dependency | `require('left-pad')` without package dep | Quality gate fails | Quality gate fails | Pass after fix | High | Malicious source | `src/gates/advancedChecks.js`, `src/gates/qualityConfig.js` | `node --test tests/adversarial_validation.test.js` |
| Lintguard false positive | String containing repeated `if` keywords | No complexity failure | Passed | Pass after fix | Medium | Normal code | `src/gates/advancedChecks.js` | `node --test tests/adversarial_validation.test.js` |
| Completion bypass | Quality/security/capability/audit blocked state marked complete | Completion denied | Denied with failed status | Pass after fix | Critical | Forged run state | `src/run.js`, `src/governance/summary.js` | `node --test tests/adversarial_validation.test.js tests/governance.test.js` |
| Audit tamper | Modify bundle `summary.md` | Verification fails | Verification fails | Pass after fix | High | Edited bundle | `src/audit/manifest.js`, `src/audit/verify.js` | `node --test tests/adversarial_validation.test.js` |
| Audit evidence hiding | Delete run-local failure then append fake pass | Failure remains sticky | Governance still blocked | Pass after fix | High | Edited evidence | `src/audit/evidence.js`, `src/governance/summary.js` | `node --test tests/adversarial_validation.test.js` |
| Audit/control mutation | `node`, redirection, or `rm` against `.agentkodex/runs` | Denied | Denied by blocked policy | Pass after fix | High | Direct command input | `src/policy.js` | `node --test tests/adversarial_validation.test.js` |
| Routing spoofing | Clean scorecard with no run-history evidence | Insufficient history | No selected agent | Pass after fix | High | Forged scorecard file | `src/router/route.js` | `node --test tests/adversarial_validation.test.js` |
| Tournament reuse | Contestant uses another contestant capability | Denied; no winner credit | Denied; no winner | Pass after fix | Critical | Malicious contestant | `src/tournament`, `src/capabilities/phases.js` | `node --test tests/adversarial_validation.test.js tests/tournament.test.js` |
| Swarm reuse | Agent uses another agent capability | Denied | Denied | Pass | Critical | Malicious swarm phase | `src/swarm`, `src/capabilities/phases.js` | `node --test tests/swarm.test.js` |
| CLI error handling | Missing audit bundle target | Sanitized error, no stack | Sanitized error, no stack | Pass after fix | Medium | Local CLI user | `bin/agentkodex.js` | `node --test tests/cli.test.js` |
| Install/release | package install, CLI smoke, release gate | Pass honestly | Release gate passed | Pass | Medium | Local install | `package.json`, `scripts/postinstall.js`, `src/release/gate.js` | `npm run release:gate` |

## Malicious Fixture Corpus

The inert corpus lives under `tests/fixtures/adversarial/`:

- `env-leak-project`
- `circular-dependency-project`
- `banned-package-project`
- `capability-replay-project`
- `audit-tamper-project`
- `socket-attack-payloads`
- `cockpit-mutation-payloads`
- `completion-bypass-payloads`

The fixtures are templates. Tests generate live malicious files in temporary directories so the Agentkodex repository itself does not contain checked-in env files or executable hostile source.

## Vulnerabilities Fixed

Critical:

- Safe/read-only command classification could be combined with shell redirection in observe mode. Fixed by detecting shell control syntax and requiring policy approval before execution.
- Sensitive Agentkodex runtime key/token files could be read through read-only commands. Fixed by blocking reads of runtime key and token filenames.
- Runtime daemon mutation accepted daemon-token-only requests for live session control. Fixed by requiring runtime capabilities on live mutation paths.
- Symlink path-scope escape could reuse a valid capability outside the allowed workspace. Fixed with realpath-aware path checks.
- Completion could be influenced by incomplete governance evidence. Fixed by blocking completion on missing audit/security/quality/capability evidence.

High:

- Custom agent launch could bypass destructive command policy. Fixed by letting blocked/manual policy decisions win before `agentLaunch`.
- Query-string Cockpit tokens created a token leak path. Fixed by accepting auth headers only.
- Cockpit cross-origin API reads were accepted with a valid token. Fixed by rejecting hostile origins for all API methods and keeping CSRF checks for mutations.
- Audit bundle generated files could be modified without verification failure. Fixed with generated-file checksums and Ed25519 bundle signature verification.
- Fake quality pass evidence could hide an earlier quality failure. Fixed by mirroring run evidence and treating quality failures as sticky for governance.
- Direct commands could mutate `.agentkodex` audit/session/runtime state. Fixed by blocked policy patterns for evidence/control-plane mutation.
- Dynamic imports of banned packages and renamed env-looking files were missed. Fixed in Lintguard file/import checks.
- Forged scorecards could make routing select an agent with no run-history evidence. Fixed by requiring persisted history evidence.
- CLI top-level errors printed stack traces. Fixed by printing sanitized error messages only.

## Remaining Open Risks

| Risk | Severity | Why still open | Recommended next action |
| --- | --- | --- | --- |
| Local same-user filesystem compromise can edit `.agentkodex` files and key stores outside Agentkodex command paths. | Medium | Agentkodex is local-first and cannot make local project files tamper-proof against the same OS user without external anchoring. | Add optional external or append-only audit anchoring for high-assurance deployments. |
| Socket rate limiting is process-local and resets on daemon restart. | Medium | It blocks repeated invalid requests during one daemon lifetime only. | Persist short-lived invalid request counters or use OS-level socket ACLs where available. |
| Lintguard dead-import and complexity checks are conservative static heuristics. | Medium | They intentionally avoid broad parser dependencies and may miss complex cases. | Add parser-backed analysis behind an optional dependency or sidecar. |
| Legacy HMAC capability compatibility remains available when policy allows it. | Low | It is needed for migration and emits audit evidence. | Default `allowLegacyHmac` to false in a future major release after migration. |

## Regression Tests Added

- `runtime safe-command shell-control bypass is denied before execution`
- `sensitive Agentkodex runtime key and token files cannot be read by safe command policy`
- `agentLaunch cannot bypass destructive command policy when bridge is unavailable`
- `capability path scope rejects symlink escape in daemon execution path`
- `daemon live mutation denies token-only send without presented capability`
- `daemon rejects oversized socket payload before parsing`
- `audit bundle verification catches generated-file tampering`
- `fake quality pass evidence does not hide earlier quality failure`
- `direct command attempts to mutate Agentkodex evidence are blocked`
- `quality gate blocks dynamic banned imports and missing deps without complexity string false positive`
- `quality gate blocks nested and renamed env-looking files`
- `completion, routing, and tournament reject untrusted or denied evidence`
- `cockpit rejects bad-origin API requests even with a valid token`
- `cli errors are sanitized without stack traces`

## Verification Commands

Final verification for this report must include:

```sh
npm test
npm run quality:gate
npm run release:gate
node bin/agentkodex.js keys status
node bin/agentkodex.js quality check --json
node bin/agentkodex.js governance summary --json
node bin/agentkodex.js policy check --json
node bin/agentkodex.js audit verify <bundlePath> --json
```

Results are recorded in the final handoff for this pass.
