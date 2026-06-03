# Agentguard Integration

Agentguard is Agentkodex's security and policy brain. Agentkodex now owns native capability issuing and verification, while the Python Agentguard bridge is optional compatibility.

## Capability Lifecycle

1. A runtime, swarm, tournament, audit, or quality phase requests a scoped capability.
2. Agentkodex signs it with the active Ed25519 key.
3. The execution path verifies signature, expiration, session, agent, phase, action, path, and revocation.
4. Failures write audit evidence before returning.
5. Completion is blocked when governance evidence shows a denied or failed capability.

## Key Lifecycle

- `agentkodex keys status`
- `agentkodex keys list --json`
- `agentkodex keys rotate --json`
- `agentkodex keys retire <key-id>`

Private keys are never printed. Rotation keeps old public verification keys active until they are retired.

## Policy

Use `agentkodex.policy.json` for default deny, allowed/denied/approval patterns, path scopes, max TTL, HMAC compatibility, and broad action controls. See `examples/agentkodex-policy.example.json`.

Set `AGENTGUARD_SOURCE` or `agentguard.source` when using the optional Python bridge.
