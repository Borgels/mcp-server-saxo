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
2. **App Management → Create application** (mark as SIM, grant type
   **Code**, allow trading if you'll be placing orders).
3. Register the redirect URL **exactly** as
   `http://localhost:8765/callback`. Saxo rejects IP-literal redirects
   like `http://127.0.0.1:...` at parse time, so use the hostname.
4. Put the credentials in `.env`:
   ```
   SAXO_ENVIRONMENT=sim
   SAXO_APP_KEY=...
   SAXO_APP_SECRET=...
   SAXO_REDIRECT_URI=http://localhost:8765/callback
   ```
5. Run the auth CLI:
   ```sh
   npm run auth -- --env sim
   ```
   This opens your browser to Saxo's authorize page, you click Allow, and
   the CLI writes `SAXO_ACCESS_TOKEN`, `SAXO_REFRESH_TOKEN`, and
   `SAXO_TOKEN_EXPIRES_AT` back into `.env`.

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

## Claude / Cursor / Inspector Config

Prereq: run `npm run build` once so `dist/transports/stdio.js` exists.

### Minimal — 24h SIM token

```json
{
  "mcpServers": {
    "saxo": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-saxo/dist/transports/stdio.js"],
      "env": {
        "SAXO_ENVIRONMENT": "sim",
        "SAXO_ACCESS_TOKEN": "your-24h-sim-token"
      }
    }
  }
}
```

### Durable — OAuth with refresh

After running `npm run auth -- --env sim` once (see Quickstart Path B),
copy the resulting `SAXO_REFRESH_TOKEN` into the env block. The server
will refresh access tokens automatically — no daily re-paste.

```json
{
  "mcpServers": {
    "saxo": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-saxo/dist/transports/stdio.js"],
      "env": {
        "SAXO_ENVIRONMENT": "sim",
        "SAXO_APP_KEY": "...",
        "SAXO_APP_SECRET": "...",
        "SAXO_REFRESH_TOKEN": "...",
        "SAXO_ACCESS_TOKEN": "...",
        "SAXO_TOKEN_EXPIRES_AT": "2026-05-19T18:00:37.823Z",
        "SAXO_REDIRECT_URI": "http://localhost:8765/callback",
        "SAXO_ENABLE_LIVE_TRADING": "false"
      }
    }
  }
}
```

`SAXO_ACCESS_TOKEN` is allowed to be expired at startup — the proactive
refresh in `SaxoClient` decodes the JWT `exp`, detects it's within 60s
of expiry, and runs the refresh-token grant before sending the first
request. `SAXO_TOKEN_EXPIRES_AT` is optional (the JWT carries it), but
including it lets the client refresh without making a wasted request
first.

### Windows paths

Use double backslashes inside JSON. Example for a repo at
`C:\Users\you\repos\mcp-server-saxo`:

```json
"args": [
  "C:\\Users\\you\\repos\\mcp-server-saxo\\dist\\transports\\stdio.js"
]
```

### Dev mode (rebuild not required on edits)

```json
{
  "mcpServers": {
    "saxo": {
      "command": "npm",
      "args": ["run", "dev", "--prefix", "/absolute/path/to/mcp-server-saxo"],
      "env": {
        "SAXO_ENVIRONMENT": "sim",
        "SAXO_ACCESS_TOKEN": "your-24h-sim-token",
        "SAXO_AUDIT_LOG": "/absolute/path/to/saxo-audit.jsonl"
      }
    }
  }
}
```

### After editing the config

- **Claude Desktop:** fully quit (File → Exit, not just close the
  window — the close button leaves it running in the tray) and reopen.
  MCP servers spawn only on cold start.
- **Cursor:** restart the agent panel.
- **MCP Inspector:** disconnect / reconnect.

### If the server fails to register

- Claude Desktop logs: `%APPDATA%\Claude\logs\` on Windows,
  `~/Library/Logs/Claude/` on macOS. Look for entries naming `saxo` or
  the spawned `node` command — stderr from the child is captured here.
- Verify the path in `args` resolves from a fresh shell (`node
  /absolute/path/to/...stdio.js` should start and wait for stdin).
- Call `saxo_diagnostics` from inside the client first when something
  looks off — its `warnings[]` array surfaces missing market-data
  terms, near-expiry tokens, and live env without
  `SAXO_ENABLE_LIVE_TRADING`.

## Start Here

Use `saxo_capabilities` first when an MCP client needs to decide which Saxo
tool to call. It returns tool descriptions, examples, identifier formats, and
safety notes without contacting Saxo.

```json
{ "query": "place order", "limit": 5 }
```

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
| `saxo_search_instruments` | `GET /ref/v1/instruments` | Search by keyword + asset type. |
| `saxo_get_instrument_details` | `GET /ref/v1/instruments/details` | Detailed metadata for one or many Uics. |
| `saxo_list_exchanges` | `GET /ref/v1/exchanges` | List exchanges (or one by ExchangeId). |
| `saxo_get_option_chain` | `GET /ref/v1/instruments/contractoptionspaces/{optionRootId}` | Strikes + expirations. `normalize=true` (default) pivots Put/Call into one row per strike. |
| `saxo_list_option_expiries` | (uses option chain) | Cheap helper: just the expiries (date, days, strike count) for an option root. |
| `saxo_get_infoprice` | `GET /trade/v1/infoprices` | Snapshot bid/ask/last for one instrument. Adds `_warning` if `PriceType=NoAccess`. |
| `saxo_get_infoprices_list` | `GET /trade/v1/infoprices/list` | Snapshot prices for multiple Uics. |
| `saxo_get_chart` | `GET /chart/v3/charts` | Historical OHLC bars (horizon in minutes). |
| `saxo_compute_spread_quote` | (uses infoprices) | Fetch bid/ask per leg and compute worst-case, mid, best-case net debit for a multi-leg spread. |
| `saxo_estimate_vertical_spread` | (pure math) | Given side + strikes + debit + contracts: max loss, max gain, breakeven, R/R. Applies 100x option multiplier. |
| `saxo_list_accounts` | `GET /port/v1/accounts/me` | List the client's trading accounts. |
| `saxo_get_balance` | `GET /port/v1/balances` | Cash + margin balance. |
| `saxo_list_positions` | `GET /port/v1/positions/me` | Open positions. |
| `saxo_list_closed_positions` | `GET /port/v1/closedpositions/me` | Closed positions / history. |
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
must be `Limit`, `OrderPrice` is the per-contract net debit (positive) or
credit (negative) for the whole strategy, and `Legs[]` accepts 2–20 legs
that all share the same option root (same underlying + expiry).

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
