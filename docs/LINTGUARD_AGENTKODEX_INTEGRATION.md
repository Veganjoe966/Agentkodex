# Lintguard Agentkodex Integration

Lintguard is integrated as an optional sidecar quality gate. Agentkodex does not vendor the Lintguard frontend/backend into core runtime code.

## Entrypoints

```bash
agentkodex quality check
npm run quality:gate
agentkodex lintguard check --local
npm run lintguard:check
agentkodex gates run --gates lintguard
```

`agentkodex quality check` is the canonical Agentkodex completion gate. `agentkodex lintguard check` remains the Lintguard-specific adapter for local lint/typecheck checks or sidecar calls.

Sidecar mode:

```bash
export LINTGUARD_URL=http://127.0.0.1:8001
export LINTGUARD_API_TOKEN=replace-with-local-secret
agentkodex lintguard check --url "$LINTGUARD_URL" --auth-enabled
```

## JSON Contract

The command always writes machine-readable JSON:

```json
{
  "ok": true,
  "violations": 0,
  "errors": [],
  "warnings": [],
  "filesChecked": 12,
  "files_checked": 12,
  "commandOutputs": [],
  "source": "local",
  "gate": "lintguard",
  "mode": "local"
}
```

`ok: false` exits non-zero. Lint/type/typecheck command failures are blocking.

## Sidecar Mode

Sidecar mode calls `POST /api/check` on a Lintguard server. The URL must be loopback by default. Use `--unsafe-public` only when the sidecar is protected by separate network controls.

Authentication:

- `--auth-enabled` fails closed if no token is supplied.
- Tokens can be passed with `LINTGUARD_API_TOKEN` or `--token`.
- Agentkodex never prints the token.

## Local Mode

Local mode discovers and runs project `lint` and `typecheck` commands:

```bash
agentkodex lintguard check --local --gates lint,typecheck
```

If no lint/typecheck command is discovered, the result is allowed with warnings. If a discovered command exits non-zero, the gate fails.

## Configuration

```json
{
  "lintguard": {
    "enabled": true,
    "url": "http://127.0.0.1:8001",
    "authRequired": true,
    "gates": ["lint", "typecheck"]
  }
}
```

## Hygiene

The integration is a wrapper. It does not add dashboard code, telemetry packages, checked-in `.env` files, or fixed project-root paths to Agentkodex.
