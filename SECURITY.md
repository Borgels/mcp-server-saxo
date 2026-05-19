# Security Policy

## Reporting A Vulnerability

Report suspected vulnerabilities privately to <security@borgels.com>.

Do not include API keys, access tokens, refresh tokens, application secrets,
account keys, order data, personal data, or other secrets in public GitHub
issues. Include a concise description, affected package/version, reproduction
steps, and impact where possible.

## Supported Versions

Security fixes are targeted at the latest `main` branch and the latest
published release, when one exists.

## Credential Handling

This MCP server reads Saxo Bank credentials (`SAXO_ACCESS_TOKEN`,
`SAXO_REFRESH_TOKEN`, `SAXO_APP_KEY`, `SAXO_APP_SECRET`) only from the server
environment and does not accept credentials as tool arguments. The OAuth
callback listener binds to loopback only.

If you believe credentials were exposed, rotate them immediately in the Saxo
developer portal and revoke any active refresh tokens.

## Live Trading

LIVE order placement is denied by default. Enabling it requires explicit
opt-in via `SAXO_ENVIRONMENT=live`, `SAXO_ENABLE_LIVE_TRADING=true`, and a
`policy.json` that sets `allow_live_writes: true`. Treat any path that
weakens these guards as a security issue and report it via the address above.
