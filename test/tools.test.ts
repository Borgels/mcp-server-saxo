import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCapabilities } from '../src/saxo/capabilities.js';
import { SaxoClient } from '../src/saxo/client.js';
import { checkToolAllowed } from '../src/saxo/policy.js';
import { registerSaxoTools } from '../src/tools/saxo.js';

const ENV_KEYS = [
  'SAXO_AUDIT_LOG',
  'SAXO_ENABLE_LIVE_ALERT_WRITES',
  'SAXO_ENABLE_LIVE_TRADING',
  'SAXO_POLICY_PATH',
  'SAXO_ENVIRONMENT',
];
const savedEnv: Record<string, string | undefined> = {};
let tempDir: string | undefined;

describe('Saxo tool registration', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('registers all Saxo tools with correct annotations', () => {
    const registered = captureRegisteredTools();

    const ids = Object.keys(registered);
    expect(ids).toEqual([
      'saxo_capabilities',
      'saxo_session_me',
      'saxo_diagnostics',
      'saxo_feature_availability',
      'saxo_search_instruments',
      'saxo_get_instrument_details',
      'saxo_list_exchanges',
      'saxo_get_option_chain',
      'saxo_list_option_expiries',
      'saxo_list_standard_option_expiries',
      'saxo_find_option_leg',
      'saxo_get_infoprice',
      'saxo_get_infoprices_list',
      'saxo_get_market_depth',
      'saxo_stream_prices',
      'saxo_get_chart',
      'saxo_screen_market',
      'saxo_compute_spread_quote',
      'saxo_estimate_vertical_spread',
      'saxo_plan_option_strategy',
      'saxo_screen_option_strategies',
      'saxo_screen_stock_strategies',
      'saxo_plan_portfolio_strategy',
      'saxo_review_strategy_positions',
      'saxo_list_accounts',
      'saxo_get_balance',
      'saxo_list_positions',
      'saxo_list_net_positions',
      'saxo_list_closed_positions',
      'saxo_list_activities',
      'saxo_list_orders',
      'saxo_get_order',
      'saxo_list_price_alerts',
      'saxo_get_price_alert',
      'saxo_create_price_alert',
      'saxo_update_price_alert',
      'saxo_delete_price_alerts',
      'saxo_get_price_alert_user_settings',
      'saxo_update_price_alert_user_settings',
      'saxo_precheck_order',
      'saxo_place_order',
      'saxo_modify_order',
      'saxo_cancel_order',
      'saxo_precheck_multileg_order',
      'saxo_place_multileg_order',
      'saxo_modify_multileg_order',
      'saxo_cancel_multileg_order',
      'saxo_oauth_login',
      'saxo_oauth_start',
      'saxo_oauth_complete',
      'saxo_oauth_cancel',
    ]);

    const readOnly = [
      'saxo_capabilities',
      'saxo_session_me',
      'saxo_diagnostics',
      'saxo_feature_availability',
      'saxo_search_instruments',
      'saxo_get_instrument_details',
      'saxo_list_exchanges',
      'saxo_get_option_chain',
      'saxo_list_option_expiries',
      'saxo_list_standard_option_expiries',
      'saxo_find_option_leg',
      'saxo_get_infoprice',
      'saxo_get_infoprices_list',
      'saxo_get_market_depth',
      'saxo_stream_prices',
      'saxo_get_chart',
      'saxo_screen_market',
      'saxo_compute_spread_quote',
      'saxo_estimate_vertical_spread',
      'saxo_plan_option_strategy',
      'saxo_screen_option_strategies',
      'saxo_screen_stock_strategies',
      'saxo_plan_portfolio_strategy',
      'saxo_review_strategy_positions',
      'saxo_list_accounts',
      'saxo_get_balance',
      'saxo_list_positions',
      'saxo_list_net_positions',
      'saxo_list_closed_positions',
      'saxo_list_activities',
      'saxo_list_orders',
      'saxo_get_order',
      'saxo_list_price_alerts',
      'saxo_get_price_alert',
      'saxo_get_price_alert_user_settings',
    ];
    for (const id of readOnly) {
      expect(registered[id]?.config.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }

    const writeIds = [
      'saxo_precheck_order',
      'saxo_place_order',
      'saxo_modify_order',
      'saxo_cancel_order',
      'saxo_precheck_multileg_order',
      'saxo_place_multileg_order',
      'saxo_modify_multileg_order',
      'saxo_cancel_multileg_order',
      'saxo_create_price_alert',
      'saxo_update_price_alert',
      'saxo_delete_price_alerts',
      'saxo_update_price_alert_user_settings',
      'saxo_oauth_login',
      'saxo_oauth_start',
      'saxo_oauth_complete',
      'saxo_oauth_cancel',
    ];
    for (const id of writeIds) {
      expect(registered[id]?.config.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    }
  });

  it('searchCapabilities returns the right tools for queries', () => {
    const results = searchCapabilities('order');
    expect(results.map(r => r.id)).toEqual(expect.arrayContaining(['saxo_place_order', 'saxo_get_order']));
  });

  it('policy denies place_order on LIVE without SAXO_ENABLE_LIVE_TRADING', () => {
    expect(
      checkToolAllowed({ tool: 'saxo_place_order', environment: 'live', liveTradingEnabled: false }),
    ).toMatchObject({ allowed: false });
  });

  it('saxo_place_order on LIVE throws before any fetch when SAXO_ENABLE_LIVE_TRADING is unset', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'));
    const client = new SaxoClient({
      environment: 'live',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const registered = captureRegisteredTools(client);

    const tool = registered.saxo_place_order;
    if (!tool) throw new Error('saxo_place_order not registered');

    await expect(
      tool.handler({
        AccountKey: 'k',
        Uic: 211,
        AssetType: 'Stock',
        BuySell: 'Buy',
        Amount: 1,
        OrderType: 'Market',
        OrderDuration: { DurationType: 'DayOrder' },
      }),
    ).rejects.toThrow(/SAXO_ENABLE_LIVE_TRADING/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saxo_place_multileg_order on LIVE throws before any fetch when SAXO_ENABLE_LIVE_TRADING is unset', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'));
    const client = new SaxoClient({
      environment: 'live',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const registered = captureRegisteredTools(client);

    const tool = registered.saxo_place_multileg_order;
    if (!tool) throw new Error('saxo_place_multileg_order not registered');

    await expect(
      tool.handler({
        AccountKey: 'k',
        OrderType: 'Limit',
        OrderPrice: 1.08,
        OrderDuration: { DurationType: 'GoodTillCancel' },
        Legs: [
          { Uic: 14853018, AssetType: 'StockOption', BuySell: 'Buy', Amount: 1, ToOpenClose: 'ToOpen' },
          { Uic: 14853056, AssetType: 'StockOption', BuySell: 'Sell', Amount: 1, ToOpenClose: 'ToOpen' },
        ],
      }),
    ).rejects.toThrow(/SAXO_ENABLE_LIVE_TRADING/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saxo_create_price_alert on LIVE throws before any fetch when alert writes are unset', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'));
    const client = new SaxoClient({
      environment: 'live',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const registered = captureRegisteredTools(client);

    const tool = registered.saxo_create_price_alert;
    if (!tool) throw new Error('saxo_create_price_alert not registered');

    await expect(
      tool.handler({
        AccountId: 'account-id',
        Uic: 21,
        AssetType: 'FxSpot',
        TargetValue: 1.34595,
        Operator: 'GreaterOrEqual',
      }),
    ).rejects.toThrow(/SAXO_ENABLE_LIVE_ALERT_WRITES/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('audits tool calls without writing raw inputs', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'saxo-audit-'));
    const auditPath = join(tempDir, 'audit.jsonl');
    process.env.SAXO_AUDIT_LOG = auditPath;

    const registered = captureRegisteredTools();
    const tool = registered.saxo_capabilities;
    if (!tool) throw new Error('saxo_capabilities not registered');

    await tool.handler({ query: 'place order', limit: 5 });

    const text = await readFile(auditPath, 'utf8');
    const records = text
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      tool: 'saxo_capabilities',
      action: 'start',
      environment: 'sim',
    });
    expect(records[1]).toMatchObject({
      tool: 'saxo_capabilities',
      action: 'finish',
      status: 'ok',
    });
    expect(text).not.toContain('place order');
  });
});

function captureRegisteredTools(
  client?: SaxoClient,
): Record<
  string,
  {
    config: { annotations?: unknown };
    handler: (input: Record<string, unknown>) => Promise<unknown>;
  }
> {
  const registered: Record<
    string,
    {
      config: { annotations?: unknown };
      handler: (input: Record<string, unknown>) => Promise<unknown>;
    }
  > = {};
  const stub = {
    registerTool: (name: string, config: { annotations?: unknown }, handler: unknown) => {
      registered[name] = {
        config,
        handler: handler as (input: Record<string, unknown>) => Promise<unknown>,
      };
    },
  } as unknown as Parameters<typeof registerSaxoTools>[0];

  const saxo =
    client ??
    new SaxoClient({
      environment: 'sim',
      accessToken: 'fake-token',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

  registerSaxoTools(stub, saxo);
  return registered;
}
