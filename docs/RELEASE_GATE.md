# Release Gate

Run:

```bash
npm run release:gate
```

The release gate fails closed. It runs:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run quality:gate`
- `agentkodex policy check --json`
- repo hygiene scans for banned artifacts, checked-in env files, hardcoded banned project paths, and obvious secrets
- audit bundle creation and verification
- temporary npm global install smoke
- CLI smoke checks

The gate does not publish. It validates the local tree before a human decides whether to commit, push, or publish.

The gate also validates the current governance defaults:

- Ed25519 capabilities are the native signing path.
- Legacy HMAC capability validation is disabled unless `agentkodex.policy.json` explicitly enables `allowLegacyHmac`.
- `agentkodex quality check` returns machine-readable JSON with `analysisMode`.
- Parser-backed Lintguard analysis is optional; `analysisMode: "auto"` falls back to heuristic mode when no supported parser dependency is installed.
- Audit bundle verification catches manifest and artifact tampering.
- Socket rate-limit counters are stored in hashed form under runtime state and do not persist raw tokens.

Optional tamper-evident anchoring can be run after a bundle is created:

```bash
agentkodex audit anchor .agentkodex/audit/<bundle-id> --json
agentkodex audit verify-anchor .agentkodex/audit/<bundle-id> --json
```

Anchoring writes a local hash-chain record outside the project by default. It is tamper-evident, not tamper-proof, and does not require a network service.

The release gate does not:

- publish to npm
- push to git
- claim audit files are tamper-proof against a same-user local filesystem compromise
- require optional parser dependencies
- run deployment commands

Use JSON output:

```bash
node bin/agentkodex.js release gate --json
```
