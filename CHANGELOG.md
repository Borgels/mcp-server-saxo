# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-05-19

Bug-fix and ergonomics release driven by exercising v0.2.0 against the real
Saxo SIM gateway. Fixes two endpoints that 404 on SIM, corrects the
multi-leg notional guard that under-estimated risk by 100x, and adds
helpers so a model driving the server doesn't have to do option-chain
pivoting and spread arithmetic itself.

### Fixed

- `saxo_session_me` now calls `GET /port/v1/users/me` (was
  `/root/v1/sessions/me`, which returns IIS 404 on Saxo SIM and silently
  broke the smoke test in v0.1.0 and v0.2.0). Now returns Name,
  ClientKey, UserKey, MarketDataViaOpenApiTermsAccepted, LegalAssetTypes.
- Removed the invalid `optionSpaceSegment` enum from
  `saxo_get_option_chain` — Saxo rejects every documented value
  (`AllStrikes`, `DefaultStrikes`, `SpecificStrikes`) with
  `InvalidModelState`. The chain returns all strikes when the param is
  omitted; filter by `expiryDates` or `strikeCount` instead.
- `policy.max_notional` for option orders now applies the contract
  multiplier (100 for `StockOption` / `IndexOption` /
  `StockIndexOption` / `FuturesOption`). Previously the multi-leg
  notional guard computed `OrderPrice * largestLegAmount` which
  under-estimates the dollar risk of US equity option spreads by 100x.
  Single-leg `saxo_place_order` got the same multiplier treatment.

### Added

- `saxo_diagnostics` now aggregates session info (`/port/v1/users/me`),
  session capabilities (`/root/v1/sessions/capabilities` → DataLevel /
  TradeLevel), JWT `exp` decoding with `expiresInSeconds`, plus a
  `warnings[]` array that surfaces
  `MarketDataViaOpenApiTermsAccepted=false`, `DataLevel!=Realtime`,
  token expiring within 10 minutes, and `SAXO_ENABLE_LIVE_TRADING=false`
  with `environment=live`. Call this first when prices look wrong.
- `saxo_get_option_chain` has a `normalize` flag (default `true`) that
  pivots Saxo's Put/Call rows into one row per strike with
  `callUic` / `putUic` / `tradingStatus`, plus an `expiries[]` summary.
  Set `normalize: false` for the raw Saxo `OptionSpace` shape.
- `saxo_list_option_expiries` — cheap helper that returns just the
  available expiries for an option root (date, days-to-expiry, last
  trade date, strike count) without dumping the full chain.
- `saxo_compute_spread_quote` — fetches bid/ask for each leg of a
  multi-leg strategy and returns `midDebit`, `worstCaseDebit`,
  `bestCaseDebit`, and `bidAskWidth`. Surfaces per-leg NoAccess
  warnings when market-data terms are missing.
- `saxo_estimate_vertical_spread` — pure math: given `side`
  (BullCall / BearCall / BullPut / BearPut), `longStrike`, `shortStrike`,
  `debit` (negative for credit spreads), and `contracts`, returns
  per-contract and total max loss, max gain, breakeven, and risk/reward
  ratio with the 100x option multiplier baked in.
- `saxo_get_infoprice` and `saxo_get_infoprices_list` now decorate
  responses with `_warning` when any leg returns `PriceType: NoAccess`,
  so an LLM driver can detect the missing market-data terms instead of
  silently treating zero quotes as real.
- Proactive token refresh: when `SAXO_TOKEN_EXPIRES_AT` (or the JWT
  `exp` claim) is within 60 seconds of expiry and refresh credentials
  are present, the client refreshes before sending the request instead
  of waiting for a 401-and-retry round trip.
- HTTP transport prints a startup warning when `MCP_HTTP_TOKEN` is
  unset (any process that can reach the host:port could invoke write
  tools) and when `MCP_ALLOW_ANY_ORIGIN=true` (CORS wide open).
- README documents the market-data-terms gotcha and how to find the
  consent checkbox (it is **not** the same as the OpenAPI Terms
  accepted to generate a 24-hour token; there is no API endpoint to
  flip it).

### Changed

- `getSessionMe` return type now matches the richer `/port/v1/users/me`
  payload (`Name`, `LegalAssetTypes`,
  `MarketDataViaOpenApiTermsAccepted`, `LastLoginTime`, ...).
- Tool count rises from 27 to 30 (`saxo_list_option_expiries`,
  `saxo_compute_spread_quote`, `saxo_estimate_vertical_spread`).
- Smoke test (`npm run smoke:live`) updated to exercise the new
  endpoints and surface warnings.

## [0.2.0] - 2026-05-19

Adds multi-leg option strategy orders so vertical/calendar/diagonal call
and put spreads, condors, butterflies, straddles, and strangles can be
placed as one atomic order with a single net debit/credit limit, plus an
option-chain reference tool for finding the per-leg Uics.

### Added

- `saxo_get_option_chain` — `GET /ref/v1/instruments/contractoptionspaces/
  {optionRootId}`. Resolves all strikes and expirations for an option
  root, with optional `ExpiryDates`, `StrikeCount`, and `Trading` filters.
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
  `AssetType`, `Uic`, and `Amount` against `policy.json`, and the
  strategy notional (`OrderPrice * largest leg Amount`) against
  `max_notional`.
- Audit log now includes `Legs`, `MultiLegOrderId`,
  `optionRootId`, and option-chain query fields.

### Changed

- `extractOrderId` for the audit log now also picks up
  `MultiLegOrderId` from successful placements.
- Tool count in `saxo_capabilities` discovery rises from 22 to 27.

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

[Unreleased]: https://github.com/Borgels/mcp-server-saxo/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Borgels/mcp-server-saxo/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Borgels/mcp-server-saxo/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Borgels/mcp-server-saxo/releases/tag/v0.1.0
