# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Durable OAuth token persistence for MCP clients: optional token-store JSON
  loading/writing via `SAXO_TOKEN_STORE_PATH`, automatic refresh persistence,
  refresh-token expiry tracking, and a `saxo_oauth_refresh` tool.

## [0.2.2] - 2026-05-21

### Added

- Saxo price-alert tools for listing, fetching, creating, updating, and
  deleting price alert definitions via `/vas/v1/pricealerts/definitions`.
- Saxo price-alert notification settings tools for reading/updating email,
  popup, and sound preferences via `/vas/v1/pricealerts/usersettings`.
- Separate LIVE alert-write safety controls:
  `SAXO_ENABLE_LIVE_ALERT_WRITES=true` plus
  `policy.allow_live_alert_writes=true`.

## [0.2.1] - 2026-05-21

### Fixed

- `saxo_review_strategy_positions` no longer requires a strategy snapshot file
  to be useful in MCPB installs. If no `strategyPositions` or readable snapshot
  is supplied, it now infers standalone unmanaged review entries from Saxo open
  positions and warns that thesis, leg grouping, entry rules, max risk, and max
  profit are unavailable.
- A missing `SAXO_STRATEGY_SNAPSHOT_PATH` from MCPB/user config is treated as a
  warning and ignored instead of failing the review tool. Explicit
  `strategySnapshotPath` inputs still fail fast when the requested file cannot
  be read.
- Optional `ALPHA_VANTAGE_API_KEY` MCPB placeholders are treated as unset.

### Changed

- The MCPB manifest exposes optional `SAXO_STRATEGY_SNAPSHOT_PATH` so users who
  do keep a local strategy JSON can configure it once in their MCP client.

## [0.2.0] - 2026-05-21

Strategy-screening and portfolio-planning release. Strategy tools are
read-only: no strategy screener/planner calls precheck or places orders.

### Added

- `saxo_screen_market`, a user-friendly Saxo-only market screener for top
  gainers, top losers, pre-market gainers, and pre-market losers.
- `saxo_plan_option_strategy` and `saxo_screen_option_strategies`, providing
  option strategy planning, cross-symbol screening, playbooks, account-aware
  sizing, Saxo chart context, Saxo OptionsChain IV context, optional
  Alpha Vantage news/earnings context, and decision briefs.
- `saxo_screen_stock_strategies`, an opinionated stock strategy screener with
  Saxo quote/liquidity data, chart-derived technical context, account-aware
  sizing, optional Alpha Vantage fundamentals/news enrichment, ranking
  breakdowns, risks, and decision briefs.
- `saxo_plan_portfolio_strategy`, a whole-account planner with account
  snapshot, target allocation, staged deployment, stock allocation plan, option
  satellite plan, issuer/share-class de-duplication, sector caps, and a
  portfolio risk dashboard.
- Options portfolio thesis planning with guardrailed vs user-driven modes,
  Greeks/theta gates, scaled options-only sizing, candidate discovery,
  concentrated-conviction controls, and deterministic entry-timing guidance
  (`enter`, `scale_in`, `wait`, `avoid`) for pullbacks vs breakdowns.
- `saxo_review_strategy_positions`, a read-only post-execution monitor for
  stock and option strategies with deterministic hold/trim/close/roll verdicts.
- `saxo_oauth_login`, a one-call local OAuth login flow for MCP clients. It
  opens the browser, waits for the callback, updates in-process tokens, and
  only persists tokens when `writeToEnvFile=true`.
- `saxo_feature_availability`, a diagnostic tool for Saxo feature flags such as
  News, Calendar, Gainers/Losers, and Chart.
- Optional Alpha Vantage enrichment via `ALPHA_VANTAGE_API_KEY` for
  `OVERVIEW`, `NEWS_SENTIMENT`, and `EARNINGS_CALENDAR`.

### Changed

- Portfolio planning now distinguishes per-trade risk budgets from portfolio
  stock allocation, so core positions can deploy toward account-level targets
  while tactical/options ideas remain risk-budgeted.
- `saxo_plan_portfolio_strategy` now exposes stock discovery controls so the
  tool remains a stocks + options planner, not options-only.
- Saxo option strategy pricing uses multi-leg/snapshot Greeks before applying
  hard Greeks gates, so theta/vega/delta/gamma inform reward/risk and decay
  checks.
- Stock screening batches price requests and only enriches the best pre-ranked
  candidates with higher-cost context to reduce Saxo rate-limit pressure.
- Portfolio allocation supports `maxSectorPercent` and reports
  `sectorExposure`; sector caps are enforced when sector/fundamentals data is
  available and surfaced as a warning when it is not.
- Documentation now covers the Saxo-first data model, optional Alpha Vantage
  enrichment, unstructured research sidecar workflow, strategy screeners, and
  whole-account planning.

### Fixed

- `saxo_session_me` uses the correct Saxo user/session endpoint.
- Account-aware screeners resolve ClientKey before balance lookup and use the
  portfolio `/me` endpoints where Saxo rejects account-key-filtered requests.
- Rejected option ideas no longer count as planned portfolio option risk.
- Alpha Vantage provider errors redact API keys before returning warnings.
- Windows OAuth browser launch avoids `cmd /c start`, fixing malformed
  authorize URLs containing `&`.

### Security

- All strategy, screening, and portfolio-planning tools are registered and
  allowlisted as read-only tools.
- LIVE order writes remain default-deny and require both
  `SAXO_ENABLE_LIVE_TRADING=true` and a policy file with
  `allow_live_writes=true`.

## [0.1.2] - 2026-05-20

First follow-up to the npm publish of 0.1.1. Two themes:

- **Bug fixes** caught by exercising 0.1.1 end-to-end against live
  Saxo SIM through the actual MCPB extension in Claude Desktop. A
  handful of these were "the server crashes on first call"
  fundamental — 0.1.1 worked when driven by `npm run smoke:live`
  but broke under real MCPB-driven invocation (env-var
  substitution, ClientKey requirements, etc.).
- **Four new tools** rounding out portfolio visibility and
  collapsing the chatty option-discovery workflow.

### Fixed

- **MCPB extension crashed on first tool call.** Claude Desktop
  substitutes `${user_config.NAME}` in the spawned env block only
  for fields the user filled in; optional fields left blank are
  passed through as the literal template string. The server then
  tried to use those literal strings as paths (`SAXO_POLICY_PATH`
  blew up first, with `loadPolicy()` calling
  `readFileSync('${user_config.SAXO_POLICY_PATH}')` against
  `C:\Windows\system32\`) and tokens. New
  [src/saxo/env.ts](src/saxo/env.ts) helpers (`readEnv`,
  `readBoolEnv`, `readNumberEnv`) treat any value starting with
  `${user_config.` as unset, wired into every `SAXO_*` read site
  across `policy.ts`, `audit.ts`, `client.ts`, `oauth.ts`,
  `session.ts`. Without this fix, the MCPB bundle in 0.1.1 was
  effectively unusable in Claude Desktop.
- **`saxo_compute_spread_quote.bidAskWidth` returned fp noise.**
  The helper used the same signed aggregator as the price fields,
  which flips the sign on sell legs — mathematically wrong for
  widths. Symmetric option spreads cancelled to ~4e-16 instead of
  summing to the correct width. Replaced with `sumWidths()` that
  sums `|ask − bid|` across legs. Identity `bidAskWidth =
  worstCaseDebit − bestCaseDebit` now holds.
- **`saxo_get_option_chain` `expiryDates` filter was ignored.**
  Saxo's API returns the full `OptionSpace` array with strike data
  populated for every expiry, regardless of the `ExpiryDates`
  query parameter. `getOptionChain` now filters the response
  client-side, so `expiryDates: ['2027-01-15']` actually returns
  just that expiry.
- **All `/port/v1/*` endpoints required `ClientKey` alongside
  `AccountKey`** — when the LLM driver passed only `accountKey`
  (the natural pattern), Saxo rejected with `"The ClientKey field
  is required."` Added `SaxoClient.resolveClientKey()` (lazy,
  cached, fetched from the session) and a fallback in
  `getBalance`, `listPositions`, `listClosedPositions`,
  `listOrders`, `getOrder`.
- **Multi-leg `OrderPrice` docs claimed negative was valid** for
  credit spreads. Saxo's API actually rejects negative values with
  `"Price cannot be negative."` (verified live). Updated tool
  descriptions, capabilities entries, and README. `OrderPrice` is
  always positive; debit vs credit is implicit in each leg's
  `BuySell`. `saxo_compute_spread_quote.midDebit` /
  `worstCaseDebit` / `bestCaseDebit` can still be negative (net
  credit); LLM drivers should `Math.abs()` before passing to a
  place_* call.

### Added — OAuth PKCE support

Previously the wrapper hard-required `SAXO_APP_SECRET` and always
sent HTTP Basic Auth. That works for Saxo's "Code" grant
(confidential client) but fails against the "PKCE" grant (public
client), which has no secret to send.

- `exchangeCodeForTokens` and `refreshAccessToken` now branch on
  `appSecret` presence: with secret → HTTP Basic Authorization
  header carrying `client_id:secret` (Code grant, unchanged);
  without → no Authorization header, `client_id` in the form body
  (PKCE grant, public client, per RFC 6749 §2.3.1).
- `loadOauthConfigFromEnv` accepts a missing `SAXO_APP_SECRET`.
- `SaxoClient.hasRefreshCredentials()` works for both modes.
- README + auth CLI help text document Saxo's PKCE portal quirk:
  the registered redirect URL in the developer portal must **omit
  the port** (`http://localhost/callback`, not
  `http://localhost:8765/callback`). The URL sent at runtime can
  still include the port — Saxo matches port-blind for PKCE only.
  Code grant still requires exact-match including port.

### Added — four new tools (30 → 34)

- **`saxo_list_net_positions`** — `/port/v1/netpositions/me`.
  Positions aggregated per instrument (one row per Uic with the
  net amount), not per fill. Right view for "what's my current
  exposure?". Uses the same ClientKey auto-resolve as
  `getBalance`.
- **`saxo_list_activities`** — `/port/v1/activities`. Recent
  account events (placed/modified/cancelled orders, trades,
  dividend payments, corporate actions). Pass `fromDateTime` /
  `toDateTime` (ISO 8601) + `$top` / `$skip` + `activityTypes`
  filter.
- **`saxo_list_standard_option_expiries`** —
  `/ref/v1/standarddates/optionexpiry`. The standardized
  option-expiry calendar (3rd Friday monthlies, quarterlies,
  weeklies). Distinct from `saxo_list_option_expiries`, which is
  per-option-root.
- **`saxo_find_option_leg`** — convenience helper. Given
  `(symbol, expiry, strike, putCall)` plus optional `exchangeId`,
  returns the option leg Uic. Compresses the 4-step
  option-discovery workflow into one call. When multiple option
  roots match (e.g. `NOK` has both OPRA-US and EUREX-EU listings),
  prefers the multi-leg-capable root and surfaces alternatives in
  `warnings[]`.

### Verified live (no code change, just validation)

- **Multi-leg write path on real Saxo SIM.** 0.1.1 had only
  validated `precheck`. Full round trip now confirmed clean:
  place a NOK Jan 2027 15/20 call spread (1 contract @ 0.05 GTC,
  far below market so it never fills) → appears in `listOrders`
  with `MultiLegOrderId=5038344141` and two per-leg orders →
  modify `OrderPrice` to 0.07 → cancel → no working orders, cash
  unchanged.
- **PKCE OAuth flow against a real Saxo PKCE app.** Wire-shape
  live-verified: no Authorization header, `client_id` in body,
  for both `authorization_code` and `refresh_token` grants.
- **22-check sweep across uncovered surface area.** Confirmed
  `list_exchanges`, `get_instrument_details` (Stock + StockOption),
  `search_instruments` with FxSpot + exchange filter,
  `get_infoprices_list` (batched, mixed Tradable/Pending),
  `chart` on StockOption returns a clean error,
  `estimate_vertical_spread` for all 4 sides incl. credit spreads,
  `compute_spread_quote` degrades gracefully when one condor leg
  has no live quote.

### Notes for LLM drivers

- `listOrders` returns the per-leg orders for a multi-leg group
  but doesn't surface `MultiLegOrderId` on the leg objects. Trust
  the response from `place_multileg_order` for the
  `MultiLegOrderId`; use `list_orders` for status, not group
  reconstruction.
- The `Price` field on per-leg orders in `list_orders` is
  populated under a nested Saxo schema path, not at the top
  level. Use `get_order(orderId)` for the full per-leg view.

### Tests

90/90 (was 69 in 0.1.1). Regression coverage added for every fix
above, plus four new tests for `findOptionLeg` (single-root
match, multi-root with warning, missing-strike error, exchangeId
filter).

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

[Unreleased]: https://github.com/Borgels/mcp-server-saxo/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Borgels/mcp-server-saxo/releases/tag/v0.1.0
