# scripts/

Local-dev tooling. Not invoked by CI or the build.

## bootstrap

One-command setup for a new dev machine. Verifies tooling, clones the repo,
generates `.env` with auto-generated cryptographic secrets and stub-mode
defaults (no external API keys needed for day-one), runs `pnpm install`,
starts Postgres via docker compose, applies migrations, and smoke-tests.

### macOS / Linux / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/steeldragon666/cpa-platform/main/scripts/bootstrap.sh | bash
```

Or after cloning:

```bash
./scripts/bootstrap.sh
```

### Windows (PowerShell 7+)

```powershell
iwr -UseBasicParsing https://raw.githubusercontent.com/steeldragon666/cpa-platform/main/scripts/bootstrap.ps1 | iex
```

Or after cloning:

```powershell
pwsh ./scripts/bootstrap.ps1
```

### What it sets

The generated `.env` ships with `CLASSIFIER_IMPL=stub` and `XERO_IMPL=stub`,
so the app boots and tests pass without any external API keys. The script
auto-generates:

- `SESSION_JWT_SECRET` — 32 random bytes, base64
- `TOKEN_ENCRYPTION_KEY` — 32 random bytes, hex
- `DOCUSIGN_WEBHOOK_HMAC_SECRET` — 16 random bytes, hex

Manual fill-in is only needed when you start working on a specific
integration — the script's final summary lists which env var pairs unlock
which feature.

### Idempotent

Re-running on an existing checkout is safe: the script detects the cloned
repo, leaves an existing `.env` alone, and does an offline-preferred
`pnpm install`.

### Tooling versions

The script is pinned to:

- **Node 22.x** (chain.ts intentionally relies on Node 22's stricter `Buffer.byteLength`)
- **pnpm 10.26.0** (matches `packageManager` in root `package.json`)
- **Docker** (any recent version with `docker compose`)

If your machine has a different Node major version, the script will tell you
how to install the right one via `mise` / `fnm` / `nvm` (or `winget` on
Windows) and exit cleanly.
