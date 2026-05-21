# mcp-server-saxo

TypeScript MCP server for the Saxo Bank OpenAPI. Works against both the **SIM**
(simulation/demo) and **LIVE** environments. Same shape as the rest of the
Borgels MCP server family: typed, documented, policy-aware, credential-sane,
and audit-friendly.

> **Disclaimer:** This is an independent, unofficial project by Borgels.
> Borgels is not affiliated with, endorsed by, or supported by Saxo Bank A/S.
> "Saxo", "Saxo Bank", and the Saxo OpenAPI are referenced only to describe
> what this server talks to. You need your own Saxo developer credentials, and
> use of the Saxo OpenAPI is subject to Saxo Bank's own terms and licensing.
> **Trading on LIVE moves real money. You are responsible for any orders this
> server places on your behalf.**

## Scope

Supported Saxo OpenAPI service groups:

- Root (session, diagnostics)
- Reference Data (instruments, exchanges)
- Trading (info prices, snapshot chart, order place / modify / cancel / precheck)
- Portfolio (accounts, balances, positions, closed positions, orders)

Streaming subscriptions (WebSocket), Value Add (alerts, performance), and
Client Management beyond `accounts/me` are out of scope for v1.

## Quickstart on SIM

```sh
npm install
npm run build
cp .env.example .env
```

Then pick one of:

### Path A — 24-hour token (quickest, one-shot)

1. Sign up for a free SIM account at <https://www.developer.saxo/>.
2. **App Management → Generate 24-hour token** (no app required).
3. Paste it into `.env`:
   ```
   SAXO_ENVIRONMENT=sim
   SAXO_ACCESS_TOKEN=...
   ```
4. Start the server (see Path A/B `start` block below).

The token expires after 24h; you'll need to repeat step 2 to keep going.

### Path B — OAuth app (refreshes automatically)

For anything you run longer than a day, do the OAuth dance once and let
the server refresh tokens for you. This is also the path you'll need for
LIVE.

1. Sign up at <https://www.developer.saxo/>.
2. **App Management → Create application** (mark as SIM, allow trading
   if you'll be placing orders). Pick either grant type — the server
   supports both:
   - **Code** (confidential client, has an App Secret)
   - **PKCE** (public client, no secret — slightly safer for
     distributable clients but functionally equivalent for this server)
3. Register the redirect URL in the portal:
   - **For Code apps**: register exactly `http://localhost:8765/callback`.
     Saxo matches the full URL including port at runtime, and rejects
     IP-literal redirects like `http://127.0.0.1:...`, so use the
     hostname.
   - **For PKCE apps**: register `http://localhost/callback` — Saxo's
     PKCE flow requires the registered URL to **omit the port**
     ("When registering the redirect URL with your application, it
     cannot include a port number"). The server still sends
     `http://localhost:8765/callback` at runtime; Saxo matches
     port-blind. Mismatching this returns `unauthorized_client`.
4. Put the credentials in `.env`:
   ```
   SAXO_ENVIRONMENT=sim
   SAXO_APP_KEY=...
   SAXO_APP_SECRET=...        # Only for Code-grant apps. Omit for PKCE.
   SAXO_REDIRECT_URI=http://localhost:8765/callback
   ```
5. Run the auth CLI:
   ```sh
   npm run auth -- --env sim
   ```
   This opens your browser to Saxo's authorize page, you click Allow, and
   the CLI writes `SAXO_ACCESS_TOKEN`, `SAXO_REFRESH_TOKEN`, and
   `SAXO_TOKEN_EXPIRES_AT` back into `.env`. Both grant types use the
   same flow; the server detects the absence of `SAXO_APP_SECRET` and
   switches to PKCE-style token exchange (no Authorization header,
   `client_id` in the form body).

The OAuth access token Saxo issues is short-lived (~20 minutes on SIM),
but `SaxoClient` proactively refreshes it from the refresh token ~60s
before expiry, so the server stays alive indefinitely.

### Start the server

```sh
npm run dev          # stdio transport
# or
npm run dev:http     # http://127.0.0.1:3000/mcp
```

### Market data is a second, separate consent

The 24-hour token unlocks **authenticated API access**, but live bid/ask
quotes via `/trade/v1/infoprices` require a **separate per-exchange market
data agreement** (NYSE, OPRA, EUREX, etc.). Until you accept it,
`saxo_get_infoprice` returns `PriceTypeAsk/Bid: "NoAccess"` with `Amount: 0`,
and `saxo_session_me` reports `MarketDataViaOpenApiTermsAccepted: false`.

There is **no Saxo OpenAPI endpoint** to flip this flag programmatically —
it's a human consent screen. Find it in the Saxo trading platform
(SaxoTraderGO → settings → live data subscriptions) or developer.saxo. Once
accepted, the same token starts returning quotes (typically `DelayedByMinutes: 15`
on SIM unless your `DataLevel` is `Realtime`).

`saxo_diagnostics` flags this condition in its `warnings[]` and infoprices
responses are decorated with `_warning` when they're NoAccess.

## Authentication

This server reads credentials from environment variables only — they are
never accepted as tool arguments.

| Variable | Required for | Notes |
| --- | --- | --- |
| `SAXO_ENVIRONMENT` | always | `sim` (default) or `live` |
| `SAXO_ACCESS_TOKEN` | always | Bearer token. 24-hour token for SIM, OAuth token for LIVE. |
| `SAXO_REFRESH_TOKEN` | LIVE / long-running SIM | Together with app credentials enables 401-auto-refresh. |
| `SAXO_APP_KEY` | refresh / OAuth | Application key from the developer portal. |
| `SAXO_APP_SECRET` | refresh / OAuth | Application secret. |
| `SAXO_REDIRECT_URI` | OAuth | Defaults to `http://localhost:8765/callback`. Loopback only — and Saxo's authorize endpoint rejects IP-literal redirects, so use the `localhost` hostname rather than `127.0.0.1`. The URL in your app's Redirect URLs list must match exactly. |
| `SAXO_TIMEOUT_MS` | optional | Request timeout in ms (default 30000). |

### Two ways to log in for LIVE / long-running SIM

**Option A — CLI (one-off, scriptable):**

```sh
SAXO_APP_KEY=... SAXO_APP_SECRET=... npm run auth -- --env live
```

The CLI starts a local callback listener, opens your browser to the Saxo
authorize endpoint with a PKCE challenge, and writes
`SAXO_ACCESS_TOKEN`/`SAXO_REFRESH_TOKEN`/`SAXO_TOKEN_EXPIRES_AT` back into
`.env`.

**Option B — From inside the MCP client (`saxo_oauth_*` tools):**

1. Set `SAXO_APP_KEY` + `SAXO_APP_SECRET` in the MCP server environment.
2. Call `saxo_oauth_start` from your MCP client. It returns an `authorizeUrl`
   and a `ticketId`.
3. The user opens `authorizeUrl` in a browser and approves.
4. Call `saxo_oauth_complete` with the `ticketId`. The server exchanges the
   code for tokens and updates itself. Set `writeToEnvFile=true` to also
   persist them to `.env`.

The MCP server only listens on loopback (`127.0.0.1`) for the callback, so the
flow never touches the public network beyond Saxo itself.

## Install

The server is published as **`@borgels/mcp-server-saxo`** on npm and
as an **`.mcpb` bundle** (MCP Bundle, the new name for DXT) on each
[GitHub Release](https://github.com/Borgels/mcp-server-saxo/releases).
The protocol layer is the same everywhere — stdio + MCP JSON-RPC. The
table below is just the per-client config syntax.

| Client | How to install |
| --- | --- |
| **Claude Desktop (1.8089+)** | Download `mcp-server-saxo-v<version>.mcpb` from the latest [Release](https://github.com/Borgels/mcp-server-saxo/releases), then **Settings → Connectors → Install from file**. Claude Desktop prompts you for the SAXO_* config values from the bundle's user_config schema. |
| **Claude Desktop (legacy `claude_desktop_config.json`)** | Add the [universal JSON block](#universal-config) to `%APPDATA%\Claude\claude_desktop_config.json` under `mcpServers`. Restart fully (File → Exit). |
| **Claude Code (CLI)** | `claude mcp add saxo -- npx -y @borgels/mcp-server-saxo` (or edit `~/.claude/mcp.json` / per-project `.mcp.json`). |
| **Cursor** | Settings → MCP → Add server, or `.cursor/mcp.json` per project. Same JSON shape as below. |
| **Codex (OpenAI)** | `~/.codex/config.toml`: `[mcp_servers.saxo]` with `command = "npx"`, `args = ["-y", "@borgels/mcp-server-saxo"]`, `env = { SAXO_ENVIRONMENT = "sim", ... }`. |
| **Windsurf / Cline / Zed / continue.dev** | Settings UI, point at `npx -y @borgels/mcp-server-saxo`. Same JSON envelope. |
| **MCP Inspector (debug)** | `npx @modelcontextprotocol/inspector npx -y @borgels/mcp-server-saxo` |
| **Self-host (any client)** | `command: "node", args: ["/absolute/path/to/dist/transports/stdio.js"]`. Use double backslashes on Windows or forward slashes. |

### Universal config

For any client that uses the standard `mcpServers` config schema:

```json
{
  "mcpServers": {
    "saxo": {
      "command": "npx",
      "args": ["-y", "@borgels/mcp-server-saxo"],
      "env": {
        "SAXO_ENVIRONMENT": "sim",
        "SAXO_ACCESS_TOKEN": "your-24h-sim-token"
      }
    }
  }
}
```

That's the **minimal** form — fine for a quick SIM test. For durable
use (no daily token paste), do the OAuth dance once with
`npm run auth -- --env sim` against a clone of this repo, then copy
the resulting OAuth env vars into the block:

```json
{
  "mcpServers": {
    "saxo": {
      "command": "npx",
      "args": ["-y", "@borgels/mcp-server-saxo"],
      "env": {
        "SAXO_ENVIRONMENT": "sim",
        "SAXO_APP_KEY": "...",
        "SAXO_APP_SECRET": "...",
        "SAXO_REFRESH_TOKEN": "...",
        "SAXO_ACCESS_TOKEN": "...",
        "SAXO_TOKEN_EXPIRES_AT": "2026-05-19T18:00:37.823Z",
        "SAXO_ENABLE_LIVE_TRADING": "false"
      }
    }
  }
}
```

`SAXO_ACCESS_TOKEN` may be expired at startup — `SaxoClient` decodes
the JWT `exp`, detects it's within 60s of expiry, and runs the
refresh-token grant before sending the first request. The refresh
token is what really matters at cold start.

### Restart after editing

Most MCP clients spawn server processes only at startup. After editing
the client's config, fully quit and reopen it. Some clients (notably
Claude Desktop) keep running in the system tray when the window is
closed — make sure you actually exit before reopening.

### Troubleshooting

- If the server doesn't appear in the client's tool list, check the
  client's MCP logs (each client documents its log location).
- Verify `npx -y @borgels/mcp-server-saxo` runs from a fresh shell — it
  should start, register tools, and wait for stdin without error.
- Once connected, call `saxo_diagnostics` first when something looks
  off — its `warnings[]` array surfaces missing market-data terms,
  near-expiry tokens, `DataLevel` not Realtime, and live env without
  `SAXO_ENABLE_LIVE_TRADING`.

### Building from source (for hacking or before npm publish)

```sh
git clone https://github.com/Borgels/mcp-server-saxo.git
cd mcp-server-saxo
npm install
npm run build           # produces dist/transports/stdio.js
npm test
```

Use `"command": "node", "args": ["/absolute/path/to/dist/transports/stdio.js"]`
in your client config to point at the built source. For the MCPB bundle,
`npm run mcpb:pack` produces `mcp-server-saxo.mcpb` in the project root.

## Start Here

Use `saxo_capabilities` first when an MCP client needs to decide which Saxo
tool to call. It returns tool descriptions, examples, identifier formats, and
safety notes without contacting Saxo.

```json
{ "query": "place order", "limit": 5 }
```

### Optional Alpha Vantage enrichment

The strategy screeners are Saxo-first. They work without third-party data using
Saxo instruments, prices, chart bars, option chains, and account/position
context. If `ALPHA_VANTAGE_API_KEY` is set, stock and option strategy tools can
optionally enrich candidates with Alpha Vantage `OVERVIEW`,
`NEWS_SENTIMENT`, and `EARNINGS_CALENDAR`.

Leave `ALPHA_VANTAGE_API_KEY` unset to keep the server Saxo-only. Alpha
Vantage is optional because tiers and rate limits vary. For deeper research,
run Alpha Vantage's own MCP server beside this Saxo server and pass normalized
research into `externalContextBySymbol`.

### Strategy and portfolio planning

Use `saxo_screen_stock_strategies` when you want ranked stock ideas with
account-aware sizing, Saxo quote/liquidity data, Saxo chart context, optional
fundamentals/news enrichment, risks, and decision briefs:

```json
{
  "accountKey": "your-account-key",
  "market": "us",
  "universe": "large_cap",
  "objective": "balanced",
  "riskProfile": "balanced",
  "includeAccountContext": true,
  "includeFundamentalContext": true,
  "riskBudgetPercentPerIdea": 1,
  "maxSingleNamePercent": 10,
  "maxResults": 10
}
```

Use `saxo_screen_option_strategies` when you want the server to find
optionable underlyings first and then rank account-aware option strategy plans:

```json
{
  "accountKey": "your-account-key",
  "market": "us_nasdaq",
  "underlyingUniverse": "auto",
  "playbook": "income_30_60d",
  "riskProfile": "balanced",
  "includeAccountContext": true,
  "riskBudgetPercent": 1,
  "requireGreeks": true,
  "maxThetaDailyPercentOfRisk": 1,
  "maxUnderlyings": 50,
  "maxUnderlyingScan": 500,
  "maxSymbolsToPlan": 5,
  "maxPlans": 10
}
```

Option strategy planning uses Saxo option-chain quotes, Saxo Greeks, optional
OptionsChain IV context, and account-aware sizing. Multi-leg candidates include
aggregated net delta, gamma, theta, and vega; long-premium structures such as
long calls and debit spreads are penalized when theta decay is large relative
to max risk. Set `requireGreeks=true` to reject candidates when Saxo does not
return complete delta, gamma, theta, and vega, and use
`maxThetaDailyPercentOfRisk` to cap acceptable daily decay.

Use `saxo_plan_portfolio_strategy` for whole-account deployment. It reads the
account snapshot, runs the stock and option screeners, then returns target
allocation, staged deployment, stock allocation, option satellite candidates,
sector exposure, and portfolio-level risk warnings. For generic options
portfolio planning, pass `optionTheses` to describe each sleeve; the planner
uses guardrailed sizing by default and requires explicit input for concentrated
conviction risk:

```json
{
  "accountKey": "your-account-key",
  "objective": "balanced_growth_income",
  "riskProfile": "balanced",
  "deploymentStyle": "staged",
  "targetInvestedPercent": 80,
  "cashReservePercent": 10,
  "maxCashDollars": 1000,
  "maxSingleNamePercent": 10,
  "maxSectorPercent": 35,
  "maxOptionsRiskPercent": 5,
  "riskBudgetPercentPerIdea": 1,
  "requireGreeks": true,
  "maxThetaDailyPercentOfRisk": 1,
  "discoverOptionCandidates": true,
  "optionDiscoveryUniverse": "auto",
  "optionDiscoveryPlaybook": "long_term_directional",
  "optionTheses": [
    {
      "name": "Long-term stock replacement",
      "symbols": ["NVO"],
      "role": "core_conviction",
      "conviction": "high",
      "horizon": "leaps",
      "preferredStructures": ["long_call", "debit_spread"],
      "targetRiskPercent": 5
    }
  ],
  "includeStocks": true,
  "includeOptions": true
}
```

Portfolio planning is read-only. It never calls precheck or places orders.
Stock allocation de-duplicates issuer/share-class duplicates such as
`GOOG`/`GOOGL`. `maxSectorPercent` is enforced when sector data is available
from fundamentals context; otherwise the response includes a warning instead
of pretending sector caps were applied. Option thesis output includes selected
and rejected candidates, thesis budgets, max-loss exposure, expiry buckets,
strategy mix, deployment rules, and simple scenario notes.
For an options-only account, set `includeStocks=false`; the planner then keeps
stock sleeves at zero and treats the options risk budget as the deployable
account sleeve instead of a small satellite. Use `maxCashDollars` when the cash
reserve is a hard dollar cap rather than only a percentage. With
`deploymentStyle="immediate"`, options-only contract counts scale up to the
configured thesis, trade, and cash-reserve budgets; staged plans remain
starter-sized. The risk dashboard reports `deployableCashDollars`,
`cashReserveDollars`, `unallocatedOptionBudget`, and warns when a strict
options-only plan leaves material cash undeployed because no additional
Greek-backed candidates fit the current rules.
Set `discoverOptionCandidates=true` to blend user-supplied conviction theses
with a deterministic discovery sleeve from Saxo's market mover and option
screeners. Discovery candidates are still filtered by liquidity, Greeks, theta,
account sizing, and the same portfolio risk caps.

## Tools

All tools are registered with MCP annotations (`readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can reason
about safety. Read-only tools work on SIM and LIVE without extra opt-in. Write
tools (orders, OAuth) follow the [LIVE Trading Safety](#live-trading-safety)
rules.

### Read-only

| Tool | Endpoint | Purpose |
| --- | --- | --- |
| `saxo_capabilities` | — | Discover tools without calling Saxo. |
| `saxo_session_me` | `GET /port/v1/users/me` | Authenticated user (Name, ClientKey, UserKey, MarketDataViaOpenApiTermsAccepted). |
| `saxo_diagnostics` | (aggregated) | Session + capabilities + token expiry + warnings (market-data terms, DataLevel, token close to expiry). |
| `saxo_feature_availability` | `GET /root/v1/features/availability` | Inspect Saxo feature flags for News, Calendar, Gainers/Losers, and Chart. |
| `saxo_search_instruments` | `GET /ref/v1/instruments` | Search by keyword + asset type. |
| `saxo_get_instrument_details` | `GET /ref/v1/instruments/details` | Detailed metadata for one or many Uics. |
| `saxo_list_exchanges` | `GET /ref/v1/exchanges` | List exchanges (or one by ExchangeId). |
| `saxo_get_option_chain` | `GET /ref/v1/instruments/contractoptionspaces/{optionRootId}` | Strikes + expirations. `normalize=true` (default) pivots Put/Call into one row per strike. |
| `saxo_list_option_expiries` | (uses option chain) | Cheap helper: just the expiries (date, days, strike count) for an option root. |
| `saxo_list_standard_option_expiries` | `GET /ref/v1/standarddates/optionexpiry` | Standardized option-expiry calendar (3rd Friday monthlies, quarterlies, weeklies). Distinct from `list_option_expiries`. |
| `saxo_find_option_leg` | (composes search + chain) | Convenience helper: given symbol + expiry + strike + Call/Put, returns the leg Uic in one call instead of 4. Picks multi-leg-capable root when ambiguous. |
| `saxo_get_infoprice` | `GET /trade/v1/infoprices` | Snapshot bid/ask/last for one instrument. Adds `_warning` if `PriceType=NoAccess`. |
| `saxo_get_infoprices_list` | `GET /trade/v1/infoprices/list` | Snapshot prices for multiple Uics. |
| `saxo_get_chart` | `GET /chart/v3/charts` | Historical OHLC bars (horizon in minutes). |
| `saxo_screen_market` | Saxo instruments + info prices | User-friendly top gainers/losers and pre-market screeners. |
| `saxo_compute_spread_quote` | (uses infoprices) | Fetch bid/ask per leg and compute worst-case, mid, best-case net debit for a multi-leg spread. |
| `saxo_estimate_vertical_spread` | (pure math) | Given side + strikes + debit + contracts: max loss, max gain, breakeven, R/R. Applies 100x option multiplier. |
| `saxo_plan_option_strategy` | Option chain + prices | Opinionated read-only option strategy plans. |
| `saxo_screen_option_strategies` | Market screener + chart TA + OptionsChain IV + planner | Cross-symbol options strategy screening. |
| `saxo_screen_stock_strategies` | Saxo instruments + prices + chart TA + optional fundamentals/news | Opinionated stock strategy screening with decision briefs. |
| `saxo_plan_portfolio_strategy` | Account snapshot + stock/options screeners | Whole-account target allocation, staged deployment, and risk dashboard. |
| `saxo_list_accounts` | `GET /port/v1/accounts/me` | List the client's trading accounts. |
| `saxo_get_balance` | `GET /port/v1/balances` | Cash + margin balance. |
| `saxo_list_positions` | `GET /port/v1/positions/me` | Open positions (one row per fill). |
| `saxo_list_net_positions` | `GET /port/v1/netpositions/me` | Positions aggregated per instrument (one row per Uic). Right view for current exposure. |
| `saxo_list_closed_positions` | `GET /port/v1/closedpositions/me` | Closed positions / history. |
| `saxo_list_activities` | `GET /port/v1/activities` | Recent account events: orders placed/modified/cancelled, trades, dividends, corporate actions. |
| `saxo_list_orders` | `GET /port/v1/orders/me` | Working orders. |
| `saxo_get_order` | `GET /port/v1/orders/{orderId}` | One order by id. |

### Write — guarded

| Tool | Endpoint | Guards |
| --- | --- | --- |
| `saxo_precheck_order` | `POST /trade/v2/orders/precheck` | Policy + audit. No execution. |
| `saxo_place_order` | `POST /trade/v2/orders` | LIVE: `SAXO_ENABLE_LIVE_TRADING=true` + `policy.json` allow + optional auto-precheck. |
| `saxo_modify_order` | `PATCH /trade/v2/orders` | Same as place_order. |
| `saxo_cancel_order` | `DELETE /trade/v2/orders/{ids}` | Policy + audit. |
| `saxo_precheck_multileg_order` | `POST /trade/v2/orders/multileg/precheck` | Validate a spread (no execution). |
| `saxo_place_multileg_order` | `POST /trade/v2/orders/multileg` | Place a spread atomically with a single net debit/credit limit. |
| `saxo_modify_multileg_order` | `PATCH /trade/v2/orders/multileg` | Adjust spread Amount or OrderPrice. |
| `saxo_cancel_multileg_order` | `DELETE /trade/v2/orders/multileg/{id}` | Cancel the whole strategy. |
| `saxo_oauth_start` | OAuth2 PKCE | Loopback redirect only; reads app creds from env. |
| `saxo_oauth_complete` | OAuth2 PKCE | Replaces in-process tokens. Optional `.env` persist. |
| `saxo_oauth_cancel` | — | Closes a pending OAuth listener. |

### Place / modify order body

Order tools accept Saxo's standard `POST /trade/v2/orders` body. Required
fields: `AccountKey`, `Uic`, `AssetType`, `BuySell`, `Amount`, `OrderType`,
`OrderDuration`. Optional: `OrderPrice` (Limit/StopLimit), `StopPrice`
(Stop/StopLimit), `ManualOrder`, `ExternalReference`, and `Orders[]` for
related orders (OCO, IfDone, brackets).

```json
{
  "AccountKey": "your-account-key",
  "Uic": 211,
  "AssetType": "Stock",
  "BuySell": "Buy",
  "Amount": 1,
  "OrderType": "Market",
  "OrderDuration": { "DurationType": "DayOrder" }
}
```

### Multi-leg option order body

Multi-leg tools wrap Saxo's `/trade/v2/orders/multileg` family. `OrderType`
must be `Limit`. `OrderPrice` is always positive — the absolute limit
price you are willing to pay (debit spread) or receive (credit spread).
Saxo's API rejects negative `OrderPrice` with "Price cannot be
negative"; the debit/credit direction is implicit in each leg's
`BuySell`. `Legs[]` accepts 2–20 legs that all share the same option
root (same underlying + expiry).

```json
{
  "AccountKey": "your-account-key",
  "OrderType": "Limit",
  "OrderPrice": 1.08,
  "OrderDuration": { "DurationType": "GoodTillCancel" },
  "ManualOrder": true,
  "ExternalReference": "bull-call-spread-1",
  "Legs": [
    {
      "Uic": 14853018,
      "AssetType": "StockOption",
      "BuySell": "Buy",
      "Amount": 150,
      "ToOpenClose": "ToOpen"
    },
    {
      "Uic": 14853056,
      "AssetType": "StockOption",
      "BuySell": "Sell",
      "Amount": 150,
      "ToOpenClose": "ToOpen"
    }
  ]
}
```

Saxo returns a `MultiLegOrderId` plus per-leg `Orders[].OrderId` values.
Use `saxo_modify_multileg_order` (Amount/OrderPrice only) or
`saxo_cancel_multileg_order` (cancels the whole strategy) afterwards. To
find the per-leg Uics, start with `saxo_search_instruments` for the
underlying, then `saxo_get_option_chain` to read off strikes and
expirations.

## LIVE Trading Safety

LIVE writes are denied by default. To enable them you must do **all three**:

1. Set `SAXO_ENVIRONMENT=live`.
2. Set `SAXO_ENABLE_LIVE_TRADING=true`.
3. Point `SAXO_POLICY_PATH` at a `policy.json` that sets
   `"allow_live_writes": true`.

A copy of `policy.example.json` is included. Supported fields:

| Field | Effect |
| --- | --- |
| `allow_live_writes` | Master switch for all order writes on LIVE. |
| `require_precheck_on_live` | Place-order automatically runs precheck first. |
| `allowed_asset_types` | Whitelist of AssetTypes that may be ordered. |
| `allowed_account_keys` | Whitelist of AccountKeys that may be traded. |
| `denied_uics` | Blocklist of Uics. |
| `max_order_amount` | Per-AssetType caps; `default` falls back when no specific entry. |
| `max_notional` | Cap on `Amount * (OrderPrice or StopPrice) * contract_multiplier`. Multiplier is 100 for `StockOption` / `IndexOption` / `StockIndexOption` / `FuturesOption`, 1 otherwise. For multi-leg spreads, applied as `|OrderPrice| * largest leg Amount * multiplier`. |

Even on SIM, all write tools run through the policy check (it just defaults
to permissive). Use the policy in SIM too if you want predictable limits.

## Optional HTTP Server

The local stdio transport is the default for agent compatibility. A small
Streamable HTTP entry point is also available:

```sh
PORT=3000 SAXO_ACCESS_TOKEN=... npm run dev:http
```

By default the HTTP server binds to `127.0.0.1`, limits request bodies to
10 MiB, allows browser CORS only from loopback origins, and does not require
an HTTP Bearer token. Override with `MCP_HTTP_HOST`, `MCP_MAX_BODY_BYTES`,
`MCP_ALLOWED_ORIGINS`, `MCP_ALLOW_ANY_ORIGIN=true`, and `MCP_HTTP_TOKEN`. The
MCP endpoint is `POST http://127.0.0.1:3000/mcp`.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Optional live SIM smoke test (requires a 24-hour SIM token):

```sh
SAXO_ACCESS_TOKEN="your-sim-token" npm run smoke:live
```

## Releasing

Tagged releases trigger
[`.github/workflows/release.yml`](.github/workflows/release.yml). On
`git push --tags vX.Y.Z`:

1. Typecheck, test, build, validate the MCPB manifest.
2. Publish `@borgels/mcp-server-saxo@X.Y.Z` to npm with `--provenance`
   so the package carries a SLSA attestation linking it to the exact
   CI run + commit.
3. Reinstall with `--omit=dev` and pack a small `.mcpb` bundle
   (~2.6 MB; full dev install yields ~17 MB).
4. Create a GitHub Release with the matching CHANGELOG section as the
   body and the `.mcpb` attached.

Pre-release tags (e.g. `v0.1.1-rc.1`) publish under the `next` npm
dist-tag and as a GitHub pre-release.

### One-time setup before the first release

1. **Create the npm org.** At
   <https://www.npmjs.com/org/create>, create the `borgels`
   organization (free, public packages).
2. **Bootstrap the first publish.** Trusted Publishing (see below)
   can't be configured until the package exists on npm, so the very
   first publish needs a token. Either:
   - **Local one-shot:** `npm publish --access public` with a one-time
     Automation Token logged in as a member of the `borgels` org. Run
     this once from a clean checkout of the tagged commit. Revoke the
     token immediately afterwards.
   - **CI bootstrap:** add the token as the `NPM_TOKEN` repo secret,
     push `v0.1.1-rc.1`, let CI publish, then delete the secret.
3. **Configure Trusted Publishing** (one-time, per package):
   <https://www.npmjs.com/package/@borgels/mcp-server-saxo/access> →
   *Trusted publishing* → Add publisher. Enter
   - Organization: `Borgels`
   - Repository: `mcp-server-saxo`
   - Workflow filename: `release.yml`
   - Environment: leave blank (or set to e.g. `production` if you
     want to gate releases behind a GitHub Environment approval).
4. **Revoke the bootstrap token** and delete the `NPM_TOKEN` repo
   secret. From this point on, every release authenticates via
   GitHub Actions OIDC — no long-lived secrets anywhere.

The same three steps repeat once per sibling Borgels MCP server when
they migrate to this template.

## Rate Limits

Saxo applies per-service-group rate limits (typically ~120 requests per
minute per session per service group, and ~1 order per second). On `429` the
server preserves the `retry-after` header on the thrown `SaxoHttpError` so
callers can back off.

## Security And Audit

- All credentials (`SAXO_ACCESS_TOKEN`, `SAXO_REFRESH_TOKEN`, `SAXO_APP_KEY`,
  `SAXO_APP_SECRET`) are read only from the MCP server environment.
- Credentials are never accepted as tool arguments.
- Error formatting and audit records redact `Authorization: Bearer ...`,
  `access_token`, `refresh_token`, and `SAXO_APP_SECRET` style material.
- The OAuth listener only binds to loopback. Non-loopback `SAXO_REDIRECT_URI`
  is rejected at startup.
- If `SAXO_AUDIT_LOG` is set, every tool call writes a JSONL line with
  timestamp, request id, tool name, environment, action (`start` / `finish`
  / `error` / `policy_denied`), SHA-256 hash of the input, status, and
  redacted error text. Raw inputs and tokens are not written.
- Reports of suspected vulnerabilities go privately to
  <security@borgels.com>. Do not include credentials or personal data in
  public GitHub issues.

## API Sources

- Saxo Developer Portal: <https://www.developer.saxo/>
- Saxo OpenAPI Reference: <https://www.developer.saxo/openapi/referencedocs>
- Saxo OpenAPI Learn: <https://www.developer.saxo/openapi/learn>

## License

Apache-2.0. See [LICENSE](LICENSE).
