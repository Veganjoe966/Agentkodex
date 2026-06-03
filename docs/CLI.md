# Agentkodex CLI

Core commands:

```bash
agentkodex doctor
agentkodex quickstart
agentkodex discover --json
agentkodex session start --agent shell --command "node -e \"console.log('ok')\"" --yes --wait "smoke"
agentkodex session replay last
agentkodex quality check --json
agentkodex governance summary --json
agentkodex policy check --json
agentkodex keys status
agentkodex keys list --json
agentkodex audit bundle last
agentkodex audit verify <bundle-dir> --json
agentkodex release gate --json
```

All JSON commands print JSON only. Secrets and private keys are redacted or omitted.

Install fallback for locked-down shells:

```bash
npx -y agentkodex@latest doctor
```
