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

Use JSON output:

```bash
node bin/agentkodex.js release gate --json
```
