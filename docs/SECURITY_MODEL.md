# Agentkodex Security Model

Agentkodex is local-first. It does not expose a public control plane by default and it treats command execution, session mutation, approvals, replay/export, and Cockpit actions as privileged operations.

## Control Plane Defaults

- Runtime sockets live under `.agentkodex/runtime/` and use local daemon tokens.
- Cockpit binds to `127.0.0.1` by default, requires a bearer token, and rejects unsafe public binds unless `--unsafe-public` is explicit.
- Cockpit mutation routes require the auth token and same-origin/CSRF guard header.
- Daemon/socket requests require a daemon token, validate request shape, reject unknown methods, persist short-lived invalid request counters under `.agentkodex/runtime/`, rate-limit repeated invalid requests across daemon restarts, and return sanitized errors.
- Socket rate-limit buckets store hashed identifiers only. Raw daemon tokens are not persisted in rate-limit state.

## Capabilities

Agentkodex issues Agentguard-compatible capabilities before privileged execution. Native verification checks signature, expiration, session, agent, phase, action, path scope, key status, and revocation state.

New capabilities use Ed25519 by default. Legacy HMAC verification is migration-only and is denied unless `agentkodex.policy.json` explicitly sets `allowLegacyHmac: true`. Legacy use emits audit evidence.

## Policy Config

`agentkodex.policy.json` controls deny/approval behavior, path scopes, TTL, legacy compatibility, and broad action classes such as network, file writes, git writes, shell, and process kill.

Unknown dangerous actions fail closed. Configured `defaultDeny` makes unknown commands require denial even in auto modes.

## Audit

Audit evidence is written as append-only JSONL with redaction before persistence. Audit bundles copy only review artifacts, include governance fields, record missing files instead of failing, and can be verified with `agentkodex audit verify`.

Optional audit anchoring adds a tamper-evident hash chain outside the bundle:

```bash
agentkodex audit anchor <bundle-dir> --json
agentkodex audit verify-anchor <bundle-dir> --json
```

An anchor records the bundle hash, evidence hash, previous anchor hash, current anchor hash, timestamp, and Ed25519 key/signature when available. The default anchor log is local under the user home directory, and `--anchor-path` or `AGENTKODEX_AUDIT_ANCHOR_PATH` can point to another local append-only location.

Anchoring is tamper-evident, not tamper-proof. It detects later bundle/evidence changes and removed or reordered anchor entries when the anchor log remains available.

## Lintguard Analysis Mode

`agentkodex.quality.json` supports:

```json
{
  "analysisMode": "auto"
}
```

Modes:

- `auto`: use an optional parser package when available, otherwise use the built-in heuristic checks.
- `heuristic`: always use the lightweight built-in checks.
- `parser`: fail closed with a clear message if no supported parser dependency is available.

## Remaining Limitations

Agentkodex is not an OS sandbox. Use containers, VMs, or separate users for hostile code. Policy and capability checks reduce control-plane risk but cannot prevent every data leak from commands that are explicitly allowed.

Local same-user filesystem compromise remains an OS trust boundary. Audit anchoring improves tamper evidence for later review, but it does not make local files impossible to modify.
