# Agentkodex Security Model

Agentkodex is local-first. It does not expose a public control plane by default and it treats command execution, session mutation, approvals, replay/export, and Cockpit actions as privileged operations.

## Control Plane Defaults

- Runtime sockets live under `.agentkodex/runtime/` and use local daemon tokens.
- Cockpit binds to `127.0.0.1` by default, requires a bearer token, and rejects unsafe public binds unless `--unsafe-public` is explicit.
- Cockpit mutation routes require the auth token and same-origin/CSRF guard header.
- Daemon/socket requests require a daemon token, validate request shape, reject unknown methods, rate-limit repeated invalid requests, and return sanitized errors.

## Capabilities

Agentkodex issues Agentguard-compatible capabilities before privileged execution. Native verification checks signature, expiration, session, agent, phase, action, path scope, key status, and revocation state.

New capabilities use Ed25519 by default. Legacy HMAC verification remains available only when `agentkodex.policy.json` allows it.

## Policy Config

`agentkodex.policy.json` controls deny/approval behavior, path scopes, TTL, legacy compatibility, and broad action classes such as network, file writes, git writes, shell, and process kill.

Unknown dangerous actions fail closed. Configured `defaultDeny` makes unknown commands require denial even in auto modes.

## Audit

Audit evidence is written as append-only JSONL with redaction before persistence. Audit bundles copy only review artifacts, include governance fields, record missing files instead of failing, and can be verified with `agentkodex audit verify`.

## Remaining Limitations

Agentkodex is not an OS sandbox. Use containers, VMs, or separate users for hostile code. Policy and capability checks reduce control-plane risk but cannot prevent every data leak from commands that are explicitly allowed.
