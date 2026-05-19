# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-05-19

Two bug fixes caught by driving the live SIM tools end-to-end through
Claude Desktop.

### Fixed

- `saxo_compute_spread_quote` `bidAskWidth` was computed via the same
  signed aggregator as `midDebit` / `worstCaseDebit` / `bestCaseDebit`,
  which flips the sign on sell legs. For widths that's mathematically
  wrong — bid/ask width is non-directional. The result was that for
  spreads with similar per-leg widths (which is most option spreads),
  the buy and sell widths almost cancelled and the field returned
  floating-point noise like `4.44e-16` instead of the actual sum.
  Now `bidAskWidth = sum(|ask − bid|)` across legs, which is exactly
  `worstCaseDebit − bestCaseDebit` (the spread the LLM driver should
  budget for over best-case execution).
- `saxo_get_option_chain` returned all 15 expiry slots even when
  `expiryDates: ["2027-01-15"]` was passed. Saxo's API always returns
  the full `OptionSpace` array but only populates `SpecificOptions`
  for the expiries the caller asked about. `normalizeOptionChain` now
  drops expiry entries with no `SpecificOptions`, so a filtered query
  returns just the requested expiries and an unfiltered query still
  returns the full set (since every entry is populated in that case).

### Tests

- Regression test for `bidAskWidth` using the exact NOK 15C/20C SIM
  quotes from the user's test session (0.05 + 0.03 = 0.08, not
  0.05 − 0.03 = 0.02).
- Regression test for equal-width legs that originally produced fp
  noise; now asserts the result is strictly above 1e-10.
- Tightened the existing `computeSpreadQuote` test which had the bug
  baked in as expected behavior (`bidAskWidth ≈ 0` for symmetric
  widths). It now asserts `bidAskWidth ≈ worstCaseDebit − bestCaseDebit`.
- New test for `normalizeOptionChain` dropping empty expiry slots
  when Saxo returns filler entries.

## [0.1.2] - 2026-05-19

Hot-fix release. The MCPB bundle in 0.1.1 was unusable from Claude
Desktop because Claude Desktop substitutes `${user_config.NAME}` in
the spawned env block **only for user_config fields the user filled
in**. Optional fields the user left blank were passed through to the
child process as the literal template string. The server then tried
to use those literal strings as paths, tokens, and booleans — first
casualty was `saxo_diagnostics` blowing up because `loadPolicy()`
tried to `readFileSync('${user_config.SAXO_POLICY_PATH}')`.

### Fixed

- All `process.env.SAXO_*` reads now go through a `readEnv` helper
  ([src/saxo/env.ts](src/saxo/env.ts)) that treats any value starting
  with `${user_config.` as unset. Affects `loadPolicy`,
  `writeAuditEvent`, `SaxoClient` constructor (access token, refresh
  token, app key/secret, expires-at, base URL, timeout), OAuth config
  loading, and the `saxo_diagnostics` aggregator.
- `readBoolEnv` and `readNumberEnv` variants handle the same edge
  case for `SAXO_ENABLE_LIVE_TRADING` and `SAXO_TIMEOUT_MS`.

### Tests

- New test block in [test/new-features.test.ts](test/new-features.test.ts)
  covers `readEnv` / `readBoolEnv` / `readNumberEnv` placeholder
  handling plus a `loadPolicy` regression test that asserts
  DEFAULT_POLICY is returned when `SAXO_POLICY_PATH` is the literal
  unresolved string.

## [0.1.1] - 2026-05-19

Patch release that bundles the multi-leg option-strategy work plus the
bug fixes and ergonomics improvements discovered when v0.1.0 was first
exercised against the live Saxo SIM gateway, plus the distribution
infrastructure needed to install across MCP clients. Nothing was
released between 0.1.0 and 0.1.1.

### Distribution

- Published to npm under the **`@borgels/`** scope:
  `@borgels/mcp-server-saxo`. Adopts the Borgels MCP server family
  convention. Use `npx -y @borgels/mcp-server-saxo` from any MCP
  client that speaks the standard `mcpServers` config shape.
- Ships an **MCPB bundle** (MCP Bundle — Anthropic's renamed DXT
  format) `mcp-server-saxo-v<version>.mcpb` attached to every GitHub
  Release. Current Claude Desktop builds (1.8089+) install this via
  Settings → Connectors → Install from file. The bundle's
  `user_config` schema prompts the user for SAXO_* credentials at
  install time, with `sensitive: true` on the tokens.
- Added [`.github/workflows/release.yml`](.github/workflows/release.yml).
  On `git push --tags vX.Y.Z`: typecheck + test + build, validate
  manifest, publish to npm with `--access public --provenance` (SLSA
  attestation), reinstall with `--omit=dev` and pack a small `.mcpb`,
  create a GitHub Release with the `.mcpb` attached and the CHANGELOG
  section as the release body. Pre-release tags
  (e.g. `v0.1.1-rc.1`) publish under the `next` dist-tag.
- Release auth uses npm **Trusted Publishers** (GitHub Actions OIDC)
  once configured on npmjs.com → package settings → Trusted
  publishing. Workflow grants `id-token: write` so `npm publish`
  exchanges the OIDC token for short-lived credentials at publish
  time — no long-lived `NPM_TOKEN` after the bootstrap publish. The
  workflow still reads `secrets.NPM_TOKEN` if present to support the
  first publish (which has to predate trusted-publisher config).

### Fixed

- `saxo_session_me` now calls `GET /port/v1/users/me`. The 0.1.0
  implementation hit `/root/v1/sessions/me`, which returns IIS 404 on
  Saxo SIM, silently broke `npm run smoke:live`, and gave back only a
  minimal payload. The new endpoint returns Name, ClientKey, UserKey,
  `MarketDataViaOpenApiTermsAccepted`, LegalAssetTypes, and
  LastLoginTime.
- Removed the invalid `optionSpaceSegment` enum from the option-chain
  schema — Saxo rejects all three documented values (`AllStrikes`,
  `DefaultStrikes`, `SpecificStrikes`) with `InvalidModelState`. The
  chain now returns all strikes when the param is omitted; filter by
  `expiryDates` or `strikeCount` instead.
- `policy.max_notional` for option orders now applies the contract
  multiplier (100 for `StockOption` / `IndexOption` /
  `StockIndexOption` / `FuturesOption`). The multi-leg guard previously
  computed `OrderPrice * largestLegAmount`, which under-estimated the
  true dollar risk of US equity option spreads by 100x. Single-leg
  `saxo_place_order` got the same fix.
- `npm run auth` no longer crashes on Windows. `spawn('start', …)`
  emits `ENOENT` asynchronously via the 'error' event, bypassing the
  try/catch around it. The CLI now routes through `cmd /c start` on
  Windows and attaches an explicit `.on('error')` handler that swallows
  the failure so the OAuth listener keeps running even if no browser
  can be opened.
- `package.json` `main` and `bin` paths corrected from
  `./dist/stdio.js` (which never existed) to
  `./dist/transports/stdio.js`. The old paths would have broken any
  `npm install -g`, `npx`, or library import.
- MCP `serverInfo.version` now tracks `package.json` instead of being
  hardcoded. 0.1.0 was reported on the wire as the server version even
  in post-bump builds. `createServer` now reads the nearest
  `package.json` at module load, walking up from the source file, so
  this works in both source (tsx) and bundled (tsup dist) modes. New
  unit test asserts the wire version matches `package.json` so future
  bumps stay in sync.
- Default `SAXO_REDIRECT_URI` changed from
  `http://127.0.0.1:8765/callback` to `http://localhost:8765/callback`.
  Saxo's authorize endpoint rejects IP-literal redirects with
  `Invalid value of redirect_uri parameter. It must be an absolute uri`
  (yes, regardless of what's registered on the app — IP-literal
  redirects fail at parse time). README + auth CLI help text updated to
  warn that the URL must use a hostname and must exactly match what's
  registered in the Saxo developer portal.

### Added — multi-leg option strategy orders

- `saxo_get_option_chain` — `GET /ref/v1/instruments/contractoptionspaces/
  {optionRootId}`. Resolves all strikes and expirations for an option
  root. Now ships with a `normalize` flag (default `true`) that pivots
  Saxo's separate Put/Call rows into one row per strike with
  `callUic` / `putUic` / `tradingStatus`, plus an `expiries[]` summary.
  Set `normalize: false` for the raw Saxo `OptionSpace` shape.
- `saxo_precheck_multileg_order` — `POST /trade/v2/orders/multileg/
  precheck`. Validates a multi-leg body against Saxo (margin, prices,
  instrument rules) without placing it. Runs through the policy + audit.
- `saxo_place_multileg_order` — `POST /trade/v2/orders/multileg`. Places
  a multi-leg option strategy as one order. `OrderType` must be `Limit`;
  `OrderPrice` is the per-contract net debit (positive) or credit
  (negative). `Legs[]` accepts 2–20 legs, each with `Uic`, `AssetType`
  (`StockOption` or `IndexOption`), `BuySell`, `Amount`, and
  `ToOpenClose`. Returns Saxo's `MultiLegOrderId` plus per-leg
  `OrderId`s.
- `saxo_modify_multileg_order` — `PATCH /trade/v2/orders/multileg`.
  Adjusts `Amount` (scaled symmetrically across legs) and/or
  `OrderPrice`.
- `saxo_cancel_multileg_order` — `DELETE /trade/v2/orders/multileg/
  {MultiLegOrderId}`. Cancels the whole strategy.
- Multi-leg policy check (`checkMultiLegOrder`): validates each leg's
  `AssetType`, `Uic`, and `Amount` against `policy.json` and the
  strategy notional (now with the corrected 100x multiplier) against
  `max_notional`.

### Added — discoverability & spread helpers

- `saxo_diagnostics` no longer just hits the (empty) `/root/v1/
  diagnostics/get`. It aggregates session info, `/root/v1/sessions/
  capabilities` (DataLevel / TradeLevel), JWT `exp` decoding with
  `expiresInSeconds`, plus a `warnings[]` array that surfaces
  `MarketDataViaOpenApiTermsAccepted=false`, `DataLevel != Realtime`
  (with a note that quotes will be delayed-by-minutes), token expiring
  within 10 minutes, and `SAXO_ENABLE_LIVE_TRADING=false` with
  `environment=live`. Call this first when prices look wrong or write
  tools fail.
- `saxo_list_option_expiries` — cheap helper that returns just the
  available expiries for an option root (date, days-to-expiry, last
  trade date, strike count) without dumping the full chain.
- `saxo_compute_spread_quote` — fetches bid/ask for each leg of a
  multi-leg strategy and returns `midDebit`, `worstCaseDebit` (pay ask
  on buys, receive bid on sells), `bestCaseDebit`, and `bidAskWidth`.
  Surfaces per-leg NoAccess warnings when market-data terms are
  missing.
- `saxo_estimate_vertical_spread` — pure math: given `side`
  (BullCall / BearCall / BullPut / BearPut), `longStrike`,
  `shortStrike`, `debit` (negative for credit spreads), and
  `contracts`, returns per-contract and total max loss, max gain,
  breakeven, and risk/reward ratio with the 100x option multiplier
  baked in.
- `saxo_get_infoprice` and `saxo_get_infoprices_list` decorate
  responses with `_warning` when any leg returns
  `PriceType: NoAccess`, so an LLM driver can detect missing
  market-data terms instead of silently treating zero quotes as real.

### Added — architecture

- Proactive token refresh: when `SAXO_TOKEN_EXPIRES_AT` (or the JWT
  `exp` claim) is within 60 seconds of expiry and refresh credentials
  are configured, the client refreshes before sending the next request
  instead of paying a 401-retry round trip.
- HTTP transport prints a startup warning when `MCP_HTTP_TOKEN` is
  unset (any local process could invoke write tools) and when
  `MCP_ALLOW_ANY_ORIGIN=true` (CORS wide open).
- Audit log now includes `Legs`, `MultiLegOrderId`, `optionRootId`,
  and option-chain query fields; `extractOrderId` reads
  `MultiLegOrderId` on multi-leg placements.

### Changed

- `getSessionMe` return type now matches the richer `/port/v1/users/me`
  payload.
- Tool count in `saxo_capabilities` discovery: 22 → 30
  (5 multi-leg + 3 helpers; `saxo_list_option_expiries`,
  `saxo_compute_spread_quote`, `saxo_estimate_vertical_spread`).
- `npm run smoke:live` updated to exercise the new endpoints and
  surface diagnostic warnings; previously bombed on the
  `saxo_session_me` 404.

### Docs

- README documents the market-data-terms gotcha: it's a **separate**
  human consent from the OpenAPI Terms accepted to get a 24-hour
  token, and there is no Saxo OpenAPI endpoint to flip the flag
  programmatically — confirmed by probing PATCH/PUT on
  `/port/v1/users/me`, `/atr/v1/disclaimers`, `/cs/v1/disclaimers`,
  `/mkt/v1/disclaimers`, and similar shapes.
- README's MCP-client-install section reframed to be transport- and
  client-agnostic. Leads with the standard `mcpServers.<name>.{command,
  args, env}` shape (the MCP convention), mentions stdio and HTTP
  transports up front, names Claude Desktop / Claude Code / Cursor /
  MCP Inspector as equal-footed example clients rather than centring
  any one of them. Adds a minimal vs durable (OAuth refresh) config
  pair, a Windows path-escaping note, and a generic troubleshooting
  pointer that defers to each client's own log location instead of
  hard-coding Claude Desktop's paths.

## [0.1.0] - 2026-05-19

Initial release of the Saxo Bank OpenAPI MCP server. Exposes the Saxo
OpenAPI to MCP-compatible agents over stdio, with an optional Streamable
HTTP transport. Works against both the SIM (simulation) and LIVE
environments, with strict default-deny guards on LIVE order placement.

### Added

- Environment switch between SIM (`gateway.saxobank.com/sim/openapi`) and
  LIVE (`gateway.saxobank.com/openapi`) via `SAXO_ENVIRONMENT`, with
  automatic 401 token refresh when `SAXO_REFRESH_TOKEN`, `SAXO_APP_KEY`,
  and `SAXO_APP_SECRET` are configured.
- 15 read-only tools covering Root Services, Reference Data, snapshot
  prices, charts, and Portfolio:
  - `saxo_capabilities` — in-server discovery of every Saxo tool.
  - `saxo_session_me`, `saxo_diagnostics`.
  - `saxo_search_instruments`, `saxo_get_instrument_details`,
    `saxo_list_exchanges`.
  - `saxo_get_infoprice`, `saxo_get_infoprices_list`, `saxo_get_chart`.
  - `saxo_list_accounts`, `saxo_get_balance`, `saxo_list_positions`,
    `saxo_list_closed_positions`, `saxo_list_orders`, `saxo_get_order`.
- 4 write trading tools, all wrapped in policy + audit:
  - `saxo_precheck_order`, `saxo_place_order`, `saxo_modify_order`,
    `saxo_cancel_order`, with support for related orders (OCO / IfDone /
    brackets) via the standard Saxo `Orders[]` body.
- 3 OAuth tools so login can run from inside an MCP client:
  - `saxo_oauth_start`, `saxo_oauth_complete`, `saxo_oauth_cancel`.
- `npm run auth` CLI for the same OAuth2 + PKCE flow in non-interactive
  contexts (Docker, CI, scripted setups).
- LIVE-trading guard stack with default-deny semantics:
  - Master switch `SAXO_ENABLE_LIVE_TRADING` plus an optional
    `policy.json` (`SAXO_POLICY_PATH`) that controls `allow_live_writes`,
    `require_precheck_on_live`, `allowed_asset_types`,
    `allowed_account_keys`, `denied_uics`, per-AssetType
    `max_order_amount`, and `max_notional`.
  - Pre-fetch policy check on every write tool, so denied orders never
    reach Saxo.
- Optional `SAXO_AUDIT_LOG` JSONL audit events for tool starts, finishes,
  errors, and policy denials, with SHA-256 hashed inputs, environment,
  retry-after, and redacted error text.
- MCP tool annotations on every registered tool (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint`).
- Apache-2.0 `LICENSE`, `README.md` with quickstart, environments table,
  tool reference, LIVE safety section, and disclaimer.

### Security

- All Saxo credentials are read only from the MCP server environment and
  are never accepted as tool arguments.
- Error formatting and audit records redact `Authorization: Bearer ...`,
  `access_token`, `refresh_token`, and `SAXO_APP_SECRET` style material.
- `SaxoClient` refuses non-`https://` base URLs (loopback `http://` is
  allowed for local mocks) so tokens cannot accidentally be sent over
  plain HTTP via a misconfigured `SAXO_BASE_URL`.
- OAuth callback listener only binds to loopback (`127.0.0.1` /
  `localhost`); non-loopback `SAXO_REDIRECT_URI` values are rejected at
  startup.
- Reused the `ip-address`, `hono`, and `fast-uri` npm `overrides` from the
  sibling Borgels MCP servers to clear transitive Dependabot alerts
  pulled in via the MCP SDK's HTTP transport.

[Unreleased]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Borgels/mcp-server-saxo/releases/tag/v0.1.0
