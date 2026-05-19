import { describe, expect, it, vi } from 'vitest';
import { SaxoPolicyDeniedError } from '../src/errors.js';
import { SaxoClient } from '../src/saxo/client.js';
import {
  computeSpreadQuote,
  estimateVerticalSpread,
  getInfoPrice,
} from '../src/saxo/prices.js';
import {
  contractMultiplier,
  checkMultiLegOrder,
  checkOrder,
  DEFAULT_POLICY,
  type SaxoPolicy,
} from '../src/saxo/policy.js';
import {
  normalizeOptionChain,
  type OptionChainRawResponse,
} from '../src/saxo/reference.js';
import { inspectAccessToken } from '../src/saxo/session.js';

describe('contractMultiplier', () => {
  it('returns 100 for option asset types', () => {
    expect(contractMultiplier('StockOption')).toBe(100);
    expect(contractMultiplier('IndexOption')).toBe(100);
    expect(contractMultiplier('StockIndexOption')).toBe(100);
    expect(contractMultiplier('FuturesOption')).toBe(100);
  });

  it('returns 1 for non-option assets', () => {
    expect(contractMultiplier('Stock')).toBe(1);
    expect(contractMultiplier('FxSpot')).toBe(1);
    expect(contractMultiplier(undefined)).toBe(1);
  });
});

describe('Saxo policy.checkOrder applies option contract multiplier', () => {
  it('rejects 150 StockOption contracts @ $1.08 against max_notional=$1000 (true notional $16,200)', () => {
    const policy: SaxoPolicy = { ...DEFAULT_POLICY, max_notional: 1000 };
    expect(() =>
      checkOrder({ AssetType: 'StockOption', Amount: 150, OrderPrice: 1.08 }, policy),
    ).toThrow(SaxoPolicyDeniedError);
  });

  it('allows 1 Stock @ $20 with max_notional=$1000 (notional $20)', () => {
    const policy: SaxoPolicy = { ...DEFAULT_POLICY, max_notional: 1000 };
    expect(() => checkOrder({ AssetType: 'Stock', Amount: 1, OrderPrice: 20 }, policy)).not.toThrow();
  });
});

describe('Saxo policy.checkMultiLegOrder applies option contract multiplier', () => {
  it('rejects 150 contracts @ $1.08 net debit against max_notional=$10,000 (true notional $16,200)', () => {
    const policy: SaxoPolicy = { ...DEFAULT_POLICY, max_notional: 10_000 };
    expect(() =>
      checkMultiLegOrder(
        {
          OrderPrice: 1.08,
          Legs: [
            { Uic: 1, AssetType: 'StockOption', Amount: 150 },
            { Uic: 2, AssetType: 'StockOption', Amount: 150 },
          ],
        },
        policy,
      ),
    ).toThrow(SaxoPolicyDeniedError);
  });

  it('allows 150 contracts @ $1.08 against max_notional=$20,000', () => {
    const policy: SaxoPolicy = { ...DEFAULT_POLICY, max_notional: 20_000 };
    expect(() =>
      checkMultiLegOrder(
        {
          OrderPrice: 1.08,
          Legs: [
            { Uic: 1, AssetType: 'StockOption', Amount: 150 },
            { Uic: 2, AssetType: 'StockOption', Amount: 150 },
          ],
        },
        policy,
      ),
    ).not.toThrow();
  });

  it('treats credit spreads symmetrically (uses |OrderPrice|)', () => {
    const policy: SaxoPolicy = { ...DEFAULT_POLICY, max_notional: 10_000 };
    expect(() =>
      checkMultiLegOrder(
        {
          OrderPrice: -1.08,
          Legs: [
            { Uic: 1, AssetType: 'StockOption', Amount: 150 },
            { Uic: 2, AssetType: 'StockOption', Amount: 150 },
          ],
        },
        policy,
      ),
    ).toThrow(SaxoPolicyDeniedError);
  });
});

describe('normalizeOptionChain', () => {
  it('pivots Put/Call rows into one row per strike', () => {
    const raw: OptionChainRawResponse = {
      Symbol: 'NOK:xcbf',
      Description: 'Nokia Corp.',
      OptionRootId: 1467,
      OptionSpace: [
        {
          Expiry: '2027-01-15',
          DisplayDaysToExpiry: 600,
          LastTradeDate: '2027-01-15T21:00:00.000000Z',
          SpecificOptions: [
            { Uic: 100, StrikePrice: 15, PutCall: 'Call', TradingStatus: 'Tradable' },
            { Uic: 101, StrikePrice: 15, PutCall: 'Put', TradingStatus: 'Tradable' },
            { Uic: 200, StrikePrice: 20, PutCall: 'Call', TradingStatus: 'Tradable' },
          ],
        },
      ],
    };
    const norm = normalizeOptionChain(raw);
    expect(norm.expiries).toEqual([
      expect.objectContaining({ expiry: '2027-01-15', strikeCount: 2, displayDaysToExpiry: 600 }),
    ]);
    expect(norm.strikes).toEqual([
      expect.objectContaining({ expiry: '2027-01-15', strike: 15, callUic: 100, putUic: 101 }),
      expect.objectContaining({ expiry: '2027-01-15', strike: 20, callUic: 200 }),
    ]);
  });

  it('handles empty chains', () => {
    expect(normalizeOptionChain({ OptionSpace: [] })).toMatchObject({ expiries: [], strikes: [] });
    expect(normalizeOptionChain({})).toMatchObject({ expiries: [], strikes: [] });
  });
});

describe('estimateVerticalSpread', () => {
  it('computes a bull call spread correctly', () => {
    const r = estimateVerticalSpread({
      side: 'BullCall',
      longStrike: 15,
      shortStrike: 20,
      debit: 1.08,
      contracts: 150,
    });
    expect(r).toMatchObject({
      multiplier: 100,
      maxLossPerContract: 1.08,
      maxGainPerContract: 5 - 1.08,
      maxLoss: 1.08 * 100 * 150,
      maxGain: (5 - 1.08) * 100 * 150,
      breakeven: 16.08,
    });
    expect(r.riskRewardRatio).toBeCloseTo((5 - 1.08) / 1.08, 4);
  });

  it('computes a bear put spread correctly', () => {
    const r = estimateVerticalSpread({
      side: 'BearPut',
      longStrike: 20,
      shortStrike: 15,
      debit: 1.5,
      contracts: 10,
    });
    expect(r.breakeven).toBe(18.5);
    expect(r.maxLoss).toBe(1.5 * 100 * 10);
    expect(r.maxGain).toBe((5 - 1.5) * 100 * 10);
  });

  it('handles credit spreads (negative debit)', () => {
    const r = estimateVerticalSpread({
      side: 'BullPut',
      longStrike: 15,
      shortStrike: 20,
      debit: -0.5,
      contracts: 1,
    });
    expect(r.maxGainPerContract).toBe(0.5);
    expect(r.maxLossPerContract).toBe(4.5);
    expect(r.breakeven).toBe(19.5);
  });

  it('warns on invalid bull call configuration', () => {
    const r = estimateVerticalSpread({
      side: 'BullCall',
      longStrike: 20,
      shortStrike: 15,
      debit: 1,
      contracts: 1,
    });
    expect(r.notes.some(n => /shortStrike > longStrike/.test(n))).toBe(true);
  });
});

describe('computeSpreadQuote', () => {
  it('computes worst-case / mid debit and surfaces NoAccess warnings', async () => {
    const responses: Record<number, unknown> = {
      100: {
        Uic: 100,
        AssetType: 'StockOption',
        Quote: { Bid: 1.5, Ask: 1.7, PriceTypeAsk: 'Tradable', PriceTypeBid: 'Tradable' },
      },
      200: {
        Uic: 200,
        AssetType: 'StockOption',
        Quote: { Bid: 0.4, Ask: 0.6, PriceTypeAsk: 'Tradable', PriceTypeBid: 'Tradable' },
      },
    };
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const uic = Number(new URL(url as string).searchParams.get('Uic') ?? 0);
      return new Response(JSON.stringify(responses[uic]), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await computeSpreadQuote(client, {
      legs: [
        { uic: 100, assetType: 'StockOption', buySell: 'Buy', amount: 150 },
        { uic: 200, assetType: 'StockOption', buySell: 'Sell', amount: 150 },
      ],
    });

    // mid = 1.6 - 0.5 = 1.1
    expect(result.midDebit).toBeCloseTo(1.1, 5);
    // worst-case = ask(buy) - bid(sell) = 1.7 - 0.4 = 1.3
    expect(result.worstCaseDebit).toBeCloseTo(1.3, 5);
    // best-case = bid(buy) - ask(sell) = 1.5 - 0.6 = 0.9
    expect(result.bestCaseDebit).toBeCloseTo(0.9, 5);
    // bidAskWidth = (1.7-1.5) + -(0.6-0.4) = 0.2 - 0.2 = 0
    expect(result.bidAskWidth).toBeCloseTo(0, 5);
    expect(result.warnings).toHaveLength(0);
  });

  it('marks a leg with NoAccess warning', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            Uic: 1,
            AssetType: 'StockOption',
            Quote: { Amount: 0, PriceTypeAsk: 'NoAccess', PriceTypeBid: 'NoAccess' },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await computeSpreadQuote(client, {
      legs: [{ uic: 1, assetType: 'StockOption', buySell: 'Buy', amount: 1 }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/NoAccess/);
    expect(result.legs[0]?.bid).toBeUndefined();
  });
});

describe('getInfoPrice annotates NoAccess responses', () => {
  it('adds _warning when PriceType=NoAccess', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            Uic: 1,
            Quote: { Amount: 0, PriceTypeAsk: 'NoAccess', PriceTypeBid: 'NoAccess' },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await getInfoPrice(client, { uic: 1, assetType: 'Stock' });
    expect(result._warning).toMatch(/NoAccess/);
  });

  it('does not add _warning for tradable prices', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            Uic: 1,
            Quote: { Bid: 1, Ask: 1.5, PriceTypeAsk: 'Tradable', PriceTypeBid: 'Tradable' },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await getInfoPrice(client, { uic: 1, assetType: 'Stock' });
    expect(result._warning).toBeUndefined();
  });
});

describe('createServer reports package.json version', () => {
  it('serverInfo.version matches package.json', async () => {
    const { createServer } = await import('../src/server.js');
    const pkg = JSON.parse(
      await (await import('node:fs/promises')).readFile(
        new URL('../package.json', import.meta.url),
        'utf8',
      ),
    ) as { version: string };
    const server = createServer();
    // McpServer exposes serverInfo via the SDK's internal handler. We
    // check the canonical field that gets sent on initialize.
    const info = (server as unknown as { server: { _serverInfo: { name: string; version: string } } })
      .server._serverInfo;
    expect(info.name).toBe('saxo');
    expect(info.version).toBe(pkg.version);
  });
});

describe('inspectAccessToken', () => {
  it('decodes a Saxo-style JWT exp claim', () => {
    const payload = { exp: '2147483647', iss: 'oa' };
    const token =
      'h.' +
      Buffer.from(JSON.stringify(payload)).toString('base64url') +
      '.sig';
    const info = inspectAccessToken(token);
    expect(info.decoded).toBe(true);
    expect(info.issuer).toBe('oa');
    expect(info.expiresAt).toMatch(/^2038/);
  });

  it('returns decoded=false for non-JWT strings', () => {
    expect(inspectAccessToken('plain-token').decoded).toBe(false);
    expect(inspectAccessToken(undefined).decoded).toBe(false);
  });
});

describe('SaxoClient proactive refresh', () => {
  it('refreshes the token before sending a request when within lead window', async () => {
    const tokenResponse = new Response(
      JSON.stringify({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 86400 }),
      { headers: { 'content-type': 'application/json' } },
    );
    const apiResponse = new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const u = String(url);
      if (u.includes('/token')) {
        return tokenResponse.clone();
      }
      return apiResponse.clone();
    });

    const expiredJwt =
      'h.' +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5 })).toString('base64url') +
      '.sig';

    const client = new SaxoClient({
      environment: 'sim',
      accessToken: expiredJwt,
      refreshToken: 'r',
      appKey: 'k',
      appSecret: 's',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.get('/root/v1/sessions/capabilities');

    const tokenCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/token'));
    expect(tokenCall).toBeDefined();
    expect(client.getAccessToken()).toBe('new-token');
  });
});
