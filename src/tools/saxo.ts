import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { formatUnknownError, SaxoPolicyDeniedError } from '../errors.js';
import { writeAuditEvent } from '../saxo/audit.js';
import {
  READ_TOOL_ANNOTATIONS,
  SAXO_CAPABILITIES,
  searchCapabilities,
  WRITE_TOOL_ANNOTATIONS,
} from '../saxo/capabilities.js';
import type { SaxoClient } from '../saxo/client.js';
import { getChart, getInfoPrice, getInfoPricesList } from '../saxo/prices.js';
import {
  getBalance,
  getOrder,
  listAccounts,
  listClosedPositions,
  listOrders,
  listPositions,
} from '../saxo/portfolio.js';
import {
  checkMultiLegOrder,
  checkOrder,
  checkToolAllowed,
  isLiveTradingEnabled,
  loadPolicy,
  type OrderPolicyInput,
} from '../saxo/policy.js';
import {
  getInstrumentDetails,
  getOptionChain,
  listExchanges,
  searchInstruments,
} from '../saxo/reference.js';
import { getDiagnostics, getSessionMe } from '../saxo/session.js';
import {
  cancelMultiLegOrder,
  cancelOrder,
  modifyMultiLegOrder,
  modifyOrder,
  placeMultiLegOrder,
  placeOrder,
  precheckMultiLegOrder,
  precheckOrder,
  type ModifyMultiLegOrderInput,
  type ModifyOrderInput,
  type PlaceMultiLegOrderInput,
  type PlaceOrderInput,
} from '../saxo/trading.js';
import { resolve } from 'node:path';
import { upsertEnvFile } from '../saxo/env-file.js';
import {
  cancelOauthFlow,
  completeOauthFlow,
  loadOauthConfigFromEnv,
  startOauthFlow,
} from '../saxo/oauth.js';

const orderDurationSchema = z.object({
  DurationType: z.enum([
    'DayOrder',
    'GoodTillCancel',
    'GoodTillDate',
    'GoodForPeriod',
    'ImmediateOrCancel',
    'FillOrKill',
    'AtTheOpening',
    'AtTheClose',
  ]),
  ExpirationDate: z.string().trim().optional(),
  ExpirationTime: z.string().trim().optional(),
});

const relatedOrderSchema = z.object({
  AssetType: z.string().trim().min(1),
  BuySell: z.enum(['Buy', 'Sell']),
  Amount: z.number().positive(),
  OrderType: z.string().trim().min(1),
  OrderPrice: z.number().optional(),
  StopPrice: z.number().optional(),
  OrderDuration: orderDurationSchema,
});

const placeOrderSchema = z.object({
  AccountKey: z.string().trim().min(1),
  Uic: z.number().int().nonnegative(),
  AssetType: z.string().trim().min(1),
  BuySell: z.enum(['Buy', 'Sell']),
  Amount: z.number().positive(),
  OrderType: z.string().trim().min(1),
  OrderDuration: orderDurationSchema,
  OrderPrice: z.number().optional(),
  StopPrice: z.number().optional(),
  ManualOrder: z.boolean().optional(),
  ExternalReference: z.string().trim().optional(),
  Orders: z.array(relatedOrderSchema).max(10).optional(),
});

const modifyOrderSchema = z.object({
  OrderId: z.string().trim().min(1),
  AccountKey: z.string().trim().min(1),
  Uic: z.number().int().nonnegative(),
  AssetType: z.string().trim().min(1),
  Amount: z.number().positive().optional(),
  OrderType: z.string().trim().min(1).optional(),
  OrderPrice: z.number().optional(),
  StopPrice: z.number().optional(),
  OrderDuration: orderDurationSchema.optional(),
});

const multiLegLegSchema = z.object({
  Uic: z.number().int().nonnegative(),
  AssetType: z.enum(['StockOption', 'IndexOption']),
  BuySell: z.enum(['Buy', 'Sell']),
  Amount: z.number().int().positive(),
  ToOpenClose: z.enum(['ToOpen', 'ToClose']),
});

const multiLegOrderSchema = z.object({
  AccountKey: z.string().trim().min(1),
  OrderType: z.literal('Limit'),
  OrderPrice: z.number().optional(),
  OrderDuration: orderDurationSchema,
  Legs: z.array(multiLegLegSchema).min(2).max(20),
  ManualOrder: z.boolean().optional(),
  ExternalReference: z.string().trim().optional(),
});

const modifyMultiLegOrderSchema = z.object({
  AccountKey: z.string().trim().min(1),
  MultiLegOrderId: z.string().trim().min(1),
  Amount: z.number().int().positive().optional(),
  OrderPrice: z.number().optional(),
});

export function registerSaxoTools(server: McpServer, client: SaxoClient): void {
  server.registerTool(
    'saxo_capabilities',
    {
      title: 'Search Saxo Capabilities',
      description:
        'Search the Saxo MCP server capabilities and examples. Use this first when deciding which Saxo tool to call.',
      inputSchema: {
        query: z.string().trim().default(''),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_capabilities', input, async () =>
        jsonToolResult(searchCapabilities(input.query, input.limit)),
      ),
  );

  server.registerTool(
    'saxo_session_me',
    {
      title: 'Get Saxo Session',
      description:
        'Return the current Saxo session (ClientKey, UserKey, default account, culture). Useful to verify the access token works.',
      inputSchema: {},
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async () =>
      runAuditedTool(client, 'saxo_session_me', {}, async () =>
        jsonToolResult(await getSessionMe(client)),
      ),
  );

  server.registerTool(
    'saxo_diagnostics',
    {
      title: 'Saxo OpenAPI Diagnostics',
      description: 'Hit the Saxo diagnostics endpoint to verify connectivity.',
      inputSchema: {},
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async () =>
      runAuditedTool(client, 'saxo_diagnostics', {}, async () =>
        jsonToolResult(await getDiagnostics(client)),
      ),
  );

  server.registerTool(
    'saxo_search_instruments',
    {
      title: 'Search Instruments',
      description:
        'Search Saxo reference data for instruments by keyword and asset type. Returns matching instruments with Uic and AssetType (use those as input to other tools).',
      inputSchema: {
        keywords: z.string().trim().min(1).optional(),
        assetTypes: z.array(z.string().trim().min(1)).optional(),
        exchangeIds: z.array(z.string().trim().min(1)).optional(),
        accountKey: z.string().trim().min(1).optional(),
        includeNonTradable: z.boolean().optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_search_instruments', input, async () =>
        jsonToolResult(await searchInstruments(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_instrument_details',
    {
      title: 'Get Instrument Details',
      description: 'Fetch detailed metadata for one or more instruments by Uic + AssetType.',
      inputSchema: {
        uics: z.array(z.number().int().nonnegative()).min(1).max(100),
        assetType: z.string().trim().min(1),
        accountKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_instrument_details', input, async () =>
        jsonToolResult(await getInstrumentDetails(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_exchanges',
    {
      title: 'List Exchanges',
      description: 'List Saxo-supported exchanges, or fetch one by ExchangeId.',
      inputSchema: {
        exchangeId: z.string().trim().min(1).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_exchanges', input, async () =>
        jsonToolResult(await listExchanges(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_option_chain',
    {
      title: 'Get Option Chain',
      description:
        'Fetch the option chain (strikes + expirations) for an option root. Use this after saxo_search_instruments with assetTypes=[StockOption] to find the Uic of each option leg before placing a multi-leg spread.',
      inputSchema: {
        optionRootId: z.number().int().nonnegative(),
        expiryDates: z
          .array(
            z
              .string()
              .trim()
              .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.'),
          )
          .optional(),
        optionSpaceSegment: z.enum(['AllStrikes', 'DefaultStrikes', 'SpecificStrikes']).optional(),
        strikeCount: z.number().int().min(1).max(200).optional(),
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        trading: z.enum(['AllTrading', 'OnlyTradable']).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_option_chain', input, async () =>
        jsonToolResult(await getOptionChain(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_infoprice',
    {
      title: 'Get Snapshot Price',
      description:
        'Fetch a snapshot bid/ask/last price for a single instrument. Snapshot only — no subscription side effects.',
      inputSchema: {
        uic: z.number().int().nonnegative(),
        assetType: z.string().trim().min(1),
        accountKey: z.string().trim().min(1).optional(),
        amount: z.number().positive().optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_infoprice', input, async () =>
        jsonToolResult(await getInfoPrice(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_infoprices_list',
    {
      title: 'Get Snapshot Prices (List)',
      description: 'Fetch snapshot prices for multiple Uics in one call.',
      inputSchema: {
        uics: z.array(z.number().int().nonnegative()).min(1).max(100),
        assetType: z.string().trim().min(1),
        accountKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_infoprices_list', input, async () =>
        jsonToolResult(await getInfoPricesList(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_chart',
    {
      title: 'Get Chart (Historical OHLC)',
      description:
        'Fetch historical OHLC bars for an instrument. Horizon is in minutes (1, 5, 60, 1440 ...). Count defaults to Saxo default (max 1200).',
      inputSchema: {
        uic: z.number().int().nonnegative(),
        assetType: z.string().trim().min(1),
        horizon: z.number().int().positive(),
        count: z.number().int().min(1).max(1200).optional(),
        mode: z.enum(['From', 'UpTo']).optional(),
        time: z.string().trim().optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_chart', input, async () =>
        jsonToolResult(await getChart(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_accounts',
    {
      title: 'List Accounts',
      description: 'List the authenticated client\'s trading accounts.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        includeSubAccounts: z.boolean().optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_accounts', input, async () =>
        jsonToolResult(await listAccounts(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_balance',
    {
      title: 'Get Account Balance',
      description: 'Fetch the cash + margin balance for an account.',
      inputSchema: {
        accountKey: z.string().trim().min(1).optional(),
        clientKey: z.string().trim().min(1).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_balance', input, async () =>
        jsonToolResult(await getBalance(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_positions',
    {
      title: 'List Open Positions',
      description: 'List open positions for the authenticated client or a specific account.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_positions', input, async () =>
        jsonToolResult(await listPositions(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_closed_positions',
    {
      title: 'List Closed Positions',
      description: 'List closed positions / trade history.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        fromDate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.')
          .optional(),
        toDate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.')
          .optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_closed_positions', input, async () =>
        jsonToolResult(await listClosedPositions(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_orders',
    {
      title: 'List Orders',
      description: 'List working orders for the authenticated client or a specific account.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        status: z.enum(['Working', 'All']).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_orders', input, async () =>
        jsonToolResult(await listOrders(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_order',
    {
      title: 'Get Order',
      description: 'Fetch a specific order by OrderId.',
      inputSchema: {
        orderId: z.string().trim().min(1),
        clientKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_order', input, async () =>
        jsonToolResult(await getOrder(client, input)),
      ),
  );

  server.registerTool(
    'saxo_precheck_order',
    {
      title: 'Precheck Order',
      description:
        'Validate an order against Saxo (margin, prices, instrument rules) without placing it. Runs through the policy + audit even though no execution happens.',
      inputSchema: placeOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_precheck_order', input, async () => {
        applyOrderPolicy(input as PlaceOrderInput);
        return jsonToolResult(await precheckOrder(client, input as PlaceOrderInput));
      }),
  );

  server.registerTool(
    'saxo_place_order',
    {
      title: 'Place Order',
      description:
        'Place a new Saxo order. Defaults to SIM. LIVE writes require SAXO_ENABLE_LIVE_TRADING=true plus a policy.json that sets allow_live_writes=true. Policy may also cap Amount/AssetType/AccountKey/Uic/notional.',
      inputSchema: placeOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_place_order', input, async () => {
        const order = input as PlaceOrderInput;
        applyOrderPolicy(order);
        await maybeRunPrecheck(client, order);
        const result = await placeOrder(client, order);
        return jsonToolResult(result);
      }),
  );

  server.registerTool(
    'saxo_modify_order',
    {
      title: 'Modify Order',
      description:
        'Modify a working order (amount, price, duration). Same LIVE guards as saxo_place_order.',
      inputSchema: modifyOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_modify_order', input, async () => {
        const order = input as ModifyOrderInput;
        applyOrderPolicy({
          AccountKey: order.AccountKey,
          Uic: order.Uic,
          AssetType: order.AssetType,
          Amount: order.Amount,
          OrderType: order.OrderType,
          OrderPrice: order.OrderPrice,
          StopPrice: order.StopPrice,
        });
        return jsonToolResult(await modifyOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_cancel_order',
    {
      title: 'Cancel Order',
      description: 'Cancel one or more working orders. LIVE writes require SAXO_ENABLE_LIVE_TRADING=true.',
      inputSchema: {
        orderIds: z.array(z.string().trim().min(1)).min(1).max(10),
        accountKey: z.string().trim().min(1),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_cancel_order', input, async () => {
        applyOrderPolicy({ AccountKey: input.accountKey });
        return jsonToolResult(await cancelOrder(client, input));
      }),
  );

  server.registerTool(
    'saxo_precheck_multileg_order',
    {
      title: 'Precheck Multi-Leg Option Order',
      description:
        'Validate a multi-leg option strategy (vertical/calendar spread, condor, straddle, etc.) without placing it. OrderType must be Limit; OrderPrice is the per-contract net debit (positive) or credit (negative) for the whole strategy. All legs must share the same option root.',
      inputSchema: multiLegOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_precheck_multileg_order', input, async () => {
        const order = input as PlaceMultiLegOrderInput;
        applyMultiLegPolicy(order);
        return jsonToolResult(await precheckMultiLegOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_place_multileg_order',
    {
      title: 'Place Multi-Leg Option Order',
      description:
        'Place a multi-leg option strategy as one atomic order with a single net-debit/credit limit. All legs must share the same option root (same underlying + expiry). OrderType must be Limit. Returns MultiLegOrderId plus per-leg OrderIds.',
      inputSchema: multiLegOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_place_multileg_order', input, async () => {
        const order = input as PlaceMultiLegOrderInput;
        applyMultiLegPolicy(order);
        await maybeRunMultiLegPrecheck(client, order);
        return jsonToolResult(await placeMultiLegOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_modify_multileg_order',
    {
      title: 'Modify Multi-Leg Option Order',
      description:
        'Modify a working multi-leg order. Only Amount (scaled symmetrically across legs) and OrderPrice can be changed.',
      inputSchema: modifyMultiLegOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_modify_multileg_order', input, async () => {
        const order = input as ModifyMultiLegOrderInput;
        applyMultiLegPolicy({
          AccountKey: order.AccountKey,
          OrderPrice: order.OrderPrice,
          Legs: typeof order.Amount === 'number' ? [{ Amount: order.Amount }] : [],
        });
        return jsonToolResult(await modifyMultiLegOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_cancel_multileg_order',
    {
      title: 'Cancel Multi-Leg Option Order',
      description: 'Cancel a working multi-leg order. Cancels the whole strategy — individual legs cannot be cancelled separately.',
      inputSchema: {
        multiLegOrderId: z.string().trim().min(1),
        accountKey: z.string().trim().min(1),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_cancel_multileg_order', input, async () => {
        applyMultiLegPolicy({ AccountKey: input.accountKey, Legs: [] });
        return jsonToolResult(await cancelMultiLegOrder(client, input));
      }),
  );

  server.registerTool(
    'saxo_oauth_start',
    {
      title: 'Start Saxo OAuth Login',
      description:
        'Begin a Saxo OAuth2 + PKCE login. Requires SAXO_APP_KEY + SAXO_APP_SECRET in the MCP server environment. Returns a ticketId and an authorizeUrl — open the URL in your browser, then call saxo_oauth_complete with the ticketId.',
      inputSchema: {
        environment: z.enum(['sim', 'live']).optional(),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_oauth_start', input, async () => {
        const config = loadOauthConfigFromEnv(input.environment);
        const flow = startOauthFlow(config);
        return jsonToolResult({
          ticketId: flow.ticketId,
          authorizeUrl: flow.authorizeUrl,
          redirectUri: flow.redirectUri,
          environment: flow.environment,
          instructions:
            'Open authorizeUrl in your browser, approve the consent, then call saxo_oauth_complete with this ticketId.',
        });
      }),
  );

  server.registerTool(
    'saxo_oauth_complete',
    {
      title: 'Complete Saxo OAuth Login',
      description:
        'Wait for the Saxo callback, exchange the code for tokens, and update the running MCP server. Optionally writes tokens to a .env file.',
      inputSchema: {
        ticketId: z.string().trim().min(1),
        timeoutSeconds: z.number().int().min(5).max(900).default(180),
        writeToEnvFile: z.boolean().default(false),
        envFilePath: z.string().trim().min(1).optional(),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_oauth_complete', input, async () => {
        const { tokens, environment } = await completeOauthFlow(input.ticketId, input.timeoutSeconds * 1000);

        client.setTokens(tokens);

        let envFilePath: string | undefined;
        if (input.writeToEnvFile) {
          envFilePath = resolve(process.cwd(), input.envFilePath ?? '.env');
          const entries: Record<string, string> = {
            SAXO_ENVIRONMENT: environment,
            SAXO_ACCESS_TOKEN: tokens.accessToken,
          };
          if (tokens.refreshToken) {
            entries.SAXO_REFRESH_TOKEN = tokens.refreshToken;
          }
          if (tokens.expiresAt) {
            entries.SAXO_TOKEN_EXPIRES_AT = new Date(tokens.expiresAt).toISOString();
          }
          await upsertEnvFile(envFilePath, entries);
        }

        return jsonToolResult({
          status: 'ok',
          environment,
          expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : undefined,
          hasRefreshToken: Boolean(tokens.refreshToken),
          envFilePath,
        });
      }),
  );

  server.registerTool(
    'saxo_oauth_cancel',
    {
      title: 'Cancel Saxo OAuth Login',
      description: 'Cancel a pending OAuth login flow (closes the callback listener).',
      inputSchema: {
        ticketId: z.string().trim().min(1),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_oauth_cancel', input, async () =>
        jsonToolResult({ cancelled: cancelOauthFlow(input.ticketId) }),
      ),
  );
}

function applyOrderPolicy(order: OrderPolicyInput): void {
  const policy = loadPolicy();
  checkOrder(order, policy);
}

function applyMultiLegPolicy(order: {
  AccountKey?: string;
  OrderPrice?: number;
  Legs: Array<{ Uic?: number; AssetType?: string; Amount?: number; BuySell?: 'Buy' | 'Sell' }>;
}): void {
  const policy = loadPolicy();
  checkMultiLegOrder(order, policy);
}

async function maybeRunPrecheck(client: SaxoClient, order: PlaceOrderInput): Promise<void> {
  if (!client.isLive()) {
    return;
  }

  const policy = loadPolicy();
  if (!policy.require_precheck_on_live) {
    return;
  }

  await precheckOrder(client, order);
}

async function maybeRunMultiLegPrecheck(
  client: SaxoClient,
  order: PlaceMultiLegOrderInput,
): Promise<void> {
  if (!client.isLive()) {
    return;
  }

  const policy = loadPolicy();
  if (!policy.require_precheck_on_live) {
    return;
  }

  await precheckMultiLegOrder(client, order);
}

async function runAuditedTool<T>(
  client: SaxoClient,
  tool: string,
  input: unknown,
  call: () => Promise<T>,
): Promise<T> {
  const decision = checkToolAllowed({
    tool,
    environment: client.environment,
    liveTradingEnabled: isLiveTradingEnabled(),
    policy: loadPolicy(),
  });

  const target = auditTarget(input);

  if (!decision.allowed) {
    await writeAuditEvent({
      tool,
      environment: client.environment,
      action: 'policy_denied',
      target,
      reason: decision.reason,
    });
    throw new SaxoPolicyDeniedError(tool, decision.reason);
  }

  await writeAuditEvent({
    tool,
    environment: client.environment,
    action: 'start',
    target,
    reason: decision.reason,
  });

  try {
    const result = await call();
    await writeAuditEvent({
      tool,
      environment: client.environment,
      action: 'finish',
      target,
      status: 'ok',
      orderId: extractOrderId(result),
    });
    return result;
  } catch (error) {
    await writeAuditEvent({
      tool,
      environment: client.environment,
      action: 'error',
      target,
      status: 'error',
      error: formatUnknownError(error),
    });
    throw error;
  }
}

function extractOrderId(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) {
    return undefined;
  }
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const text = content?.[0]?.text;
  if (!text) {
    return undefined;
  }
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const orderId =
      data.MultiLegOrderId ?? data.OrderId ?? data.OrderID ?? data.orderId;
    return typeof orderId === 'string' ? orderId : undefined;
  } catch {
    return undefined;
  }
}

function auditTarget(input: unknown): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }
  const value = input as Record<string, unknown>;
  return {
    AccountKey: value.AccountKey,
    accountKey: value.accountKey,
    Uic: value.Uic,
    uic: value.uic,
    uics: value.uics,
    AssetType: value.AssetType,
    assetType: value.assetType,
    BuySell: value.BuySell,
    Amount: value.Amount,
    amount: value.amount,
    OrderType: value.OrderType,
    OrderDuration: value.OrderDuration,
    Legs: value.Legs,
    MultiLegOrderId: value.MultiLegOrderId,
    multiLegOrderId: value.multiLegOrderId,
    optionRootId: value.optionRootId,
    expiryDates: value.expiryDates,
    optionSpaceSegment: value.optionSpaceSegment,
    strikeCount: value.strikeCount,
    keywords: value.keywords,
    exchangeId: value.exchangeId,
    horizon: value.horizon,
    orderId: value.orderId,
    orderIds: value.orderIds,
    status: value.status,
    fromDate: value.fromDate,
    toDate: value.toDate,
    fieldGroups: value.fieldGroups,
    query: value.query,
    limit: value.limit,
  };
}

function jsonToolResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export const SAXO_TOOL_IDS = SAXO_CAPABILITIES.map(capability => capability.id);
