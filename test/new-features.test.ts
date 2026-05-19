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

describe('OAuth supports both Code-grant (with secret) and PKCE-grant (no secret) apps', () => {
  it('Code-grant: token exchange uses HTTP Basic auth with app secret', async () => {
    const { exchangeCodeForTokens } = await import('../src/saxo/auth.js');
    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      capturedHeaders = new Headers((init as RequestInit)?.headers as Record<string, string>);
      capturedBody = (init as RequestInit)?.body as string;
      return new Response(
        JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    await exchangeCodeForTokens({
      code: 'code',
      codeVerifier: 'v',
      redirectUri: 'http://localhost:8765/callback',
      appKey: 'KEY',
      appSecret: 'SECRET',
      environment: 'sim',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(capturedHeaders?.get('authorization')).toMatch(/^Basic /);
    const decoded = Buffer.from(capturedHeaders!.get('authorization')!.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('KEY:SECRET');
    // body should NOT contain client_id (auth is in the header)
    expect(capturedBody).not.toMatch(/client_id=KEY/);
    expect(capturedBody).toMatch(/code_verifier=v/);
  });

  it('PKCE-grant: token exchange sends client_id in body, no Authorization header', async () => {
    const { exchangeCodeForTokens } = await import('../src/saxo/auth.js');
    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      capturedHeaders = new Headers((init as RequestInit)?.headers as Record<string, string>);
      capturedBody = (init as RequestInit)?.body as string;
      return new Response(
        JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    await exchangeCodeForTokens({
      code: 'code',
      codeVerifier: 'v',
      redirectUri: 'http://localhost:8765/callback',
      appKey: 'PKCE_KEY',
      // no appSecret
      environment: 'sim',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(capturedHeaders?.get('authorization')).toBeNull();
    expect(capturedBody).toMatch(/client_id=PKCE_KEY/);
    expect(capturedBody).toMatch(/code_verifier=v/);
  });

  it('PKCE-grant: refresh sends client_id in body, no Authorization header', async () => {
    const { refreshAccessToken } = await import('../src/saxo/auth.js');
    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      capturedHeaders = new Headers((init as RequestInit)?.headers as Record<string, string>);
      capturedBody = (init as RequestInit)?.body as string;
      return new Response(
        JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 1200 }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const tokens = await refreshAccessToken({
      refreshToken: 'RT1',
      appKey: 'PKCE_KEY',
      environment: 'sim',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(capturedHeaders?.get('authorization')).toBeNull();
    expect(capturedBody).toMatch(/client_id=PKCE_KEY/);
    expect(capturedBody).toMatch(/grant_type=refresh_token/);
    expect(tokens.accessToken).toBe('AT2');
  });

  it('hasRefreshCredentials accepts PKCE clients (no secret)', () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'a',
      refreshToken: 'r',
      appKey: 'k',
      // no appSecret
    });
    expect(client.hasRefreshCredentials()).toBe(true);
  });
});

describe('Portfolio endpoints auto-resolve ClientKey from session (regression)', () => {
  it('getBalance falls back to session ClientKey when caller passes only accountKey', async () => {
    const { getBalance } = await import('../src/saxo/portfolio.js');
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/port/v1/users/me')) {
        return new Response(JSON.stringify({ ClientKey: 'CK_FROM_SESSION' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ CashAvailableForTrading: 42, Currency: 'EUR' }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const bal = (await getBalance(client, { accountKey: 'AK_USER_SUPPLIED' })) as {
      CashAvailableForTrading: number;
    };
    expect(bal.CashAvailableForTrading).toBe(42);
    // Confirm both the session call and the balances call happened, with the
    // session-derived ClientKey forwarded to /port/v1/balances.
    const balanceCall = calls.find(u => u.includes('/balances'));
    expect(balanceCall).toMatch(/ClientKey=CK_FROM_SESSION/);
    expect(balanceCall).toMatch(/AccountKey=AK_USER_SUPPLIED/);
  });

  it('caches the resolved ClientKey across calls', async () => {
    const { getBalance, listPositions } = await import('../src/saxo/portfolio.js');
    let meCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const u = String(url);
      if (u.includes('/port/v1/users/me')) {
        meCalls++;
        return new Response(JSON.stringify({ ClientKey: 'CK1' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ Data: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await getBalance(client, { accountKey: 'AK' });
    await listPositions(client, { accountKey: 'AK' });
    expect(meCalls).toBe(1); // not 2 — cached
  });
});

describe('readEnv treats MCPB unresolved placeholders as unset', () => {
  const KEY = 'SAXO_TEST_PLACEHOLDER_KEY';
  it('returns undefined when value is literal ${user_config.NAME}', async () => {
    const { readEnv } = await import('../src/saxo/env.js');
    process.env[KEY] = '${user_config.SAXO_POLICY_PATH}';
    expect(readEnv(KEY)).toBeUndefined();
    delete process.env[KEY];
  });
  it('returns the value when set normally', async () => {
    const { readEnv } = await import('../src/saxo/env.js');
    process.env[KEY] = '/tmp/policy.json';
    expect(readEnv(KEY)).toBe('/tmp/policy.json');
    delete process.env[KEY];
  });
  it('readBoolEnv falls back when value is a placeholder', async () => {
    const { readBoolEnv } = await import('../src/saxo/env.js');
    process.env[KEY] = '${user_config.SAXO_ENABLE_LIVE_TRADING}';
    expect(readBoolEnv(KEY, false)).toBe(false);
    expect(readBoolEnv(KEY, true)).toBe(true);
    delete process.env[KEY];
  });
  it('readNumberEnv falls back when value is a placeholder', async () => {
    const { readNumberEnv } = await import('../src/saxo/env.js');
    process.env[KEY] = '${user_config.SAXO_TIMEOUT_MS}';
    expect(readNumberEnv(KEY, 5000)).toBe(5000);
    delete process.env[KEY];
  });
});

describe('loadPolicy is resilient to MCPB placeholder strings', () => {
  it('returns DEFAULT_POLICY when SAXO_POLICY_PATH is an unresolved placeholder', async () => {
    const { loadPolicy, resetPolicyCache, DEFAULT_POLICY } = await import('../src/saxo/policy.js');
    resetPolicyCache();
    const original = process.env.SAXO_POLICY_PATH;
    process.env.SAXO_POLICY_PATH = '${user_config.SAXO_POLICY_PATH}';
    try {
      expect(loadPolicy()).toEqual(DEFAULT_POLICY);
    } finally {
      if (original === undefined) {
        delete process.env.SAXO_POLICY_PATH;
      } else {
        process.env.SAXO_POLICY_PATH = original;
      }
      resetPolicyCache();
    }
  });
});

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

describe('computeSpreadQuote bidAskWidth (regression — was returning fp noise)', () => {
  it('sums per-leg widths regardless of buy/sell direction', async () => {
    // Reproduces the live SIM case: 15C bid 2.50 ask 2.55 (width 0.05),
    // 20C bid 1.49 ask 1.52 (width 0.03). Old code did
    // width_buy - width_sell which yields 0.02 (or near-zero floating
    // point noise when widths happen to be equal). Correct answer is
    // the sum of leg widths: 0.05 + 0.03 = 0.08.
    const responses: Record<number, unknown> = {
      100: {
        Uic: 100,
        AssetType: 'StockOption',
        Quote: { Bid: 2.5, Ask: 2.55, PriceTypeAsk: 'Tradable', PriceTypeBid: 'Tradable' },
      },
      200: {
        Uic: 200,
        AssetType: 'StockOption',
        Quote: { Bid: 1.49, Ask: 1.52, PriceTypeAsk: 'Tradable', PriceTypeBid: 'Tradable' },
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
      accessToken: 'fake',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await computeSpreadQuote(client, {
      legs: [
        { uic: 100, assetType: 'StockOption', buySell: 'Buy', amount: 150 },
        { uic: 200, assetType: 'StockOption', buySell: 'Sell', amount: 150 },
      ],
    });
    // Should be ~0.08, NOT ~0 or near-fp-noise
    expect(result.bidAskWidth).toBeCloseTo(0.08, 5);
    // Cross-check identity: worstCaseDebit - bestCaseDebit == bidAskWidth
    expect(result.bidAskWidth!).toBeCloseTo(
      (result.worstCaseDebit ?? 0) - (result.bestCaseDebit ?? 0),
      5,
    );
  });

  it('returns same width for equal-width legs (no floating-point cancellation)', async () => {
    // The original bug surfaced as 4.44e-16 when both legs had equal widths
    // because width_buy - width_sell = 0 with fp rounding noise.
    const responses: Record<number, unknown> = {
      100: { Uic: 100, Quote: { Bid: 2.5, Ask: 2.55, PriceTypeAsk: 'Tradable', PriceTypeBid: 'Tradable' } },
      200: { Uic: 200, Quote: { Bid: 1.5, Ask: 1.55, PriceTypeAsk: 'Tradable', PriceTypeBid: 'Tradable' } },
    };
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const uic = Number(new URL(url as string).searchParams.get('Uic') ?? 0);
      return new Response(JSON.stringify(responses[uic]), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await computeSpreadQuote(client, {
      legs: [
        { uic: 100, assetType: 'StockOption', buySell: 'Buy', amount: 1 },
        { uic: 200, assetType: 'StockOption', buySell: 'Sell', amount: 1 },
      ],
    });
    expect(result.bidAskWidth).toBeCloseTo(0.1, 5); // 0.05 + 0.05, NOT 0
    expect(result.bidAskWidth).toBeGreaterThan(1e-10);
  });
});

describe('getOptionChain client-side ExpiryDates filter (regression)', () => {
  it('filters OptionSpace entries to only the requested expiries (Saxo API ignores the param)', async () => {
    const { getOptionChain } = await import('../src/saxo/reference.js');
    // Saxo SIM returns ALL expiries with SpecificOptions populated even
    // when ExpiryDates=2027-01-15 is passed. Confirmed live. Our
    // getOptionChain has to filter client-side.
    const saxoResponse = {
      OptionSpace: [
        { Expiry: '2026-06-18', SpecificOptions: [{ Uic: 1, StrikePrice: 5, PutCall: 'Call' }] },
        { Expiry: '2027-01-15', SpecificOptions: [{ Uic: 2, StrikePrice: 5, PutCall: 'Call' }] },
        { Expiry: '2027-06-17', SpecificOptions: [{ Uic: 3, StrikePrice: 5, PutCall: 'Call' }] },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(saxoResponse), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const filtered = await getOptionChain(client, {
      optionRootId: 1467,
      expiryDates: ['2027-01-15'],
    });
    expect(filtered.OptionSpace?.map(e => e.Expiry)).toEqual(['2027-01-15']);
  });

  it('returns all expiries when no filter is passed', async () => {
    const { getOptionChain } = await import('../src/saxo/reference.js');
    const saxoResponse = {
      OptionSpace: [
        { Expiry: '2026-06-18', SpecificOptions: [] },
        { Expiry: '2027-01-15', SpecificOptions: [] },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(saxoResponse), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'fake',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const all = await getOptionChain(client, { optionRootId: 1467 });
    expect(all.OptionSpace?.length).toBe(2);
  });
});

describe('normalizeOptionChain drops empty expiry slots (regression)', () => {
  it('keeps only expiries with SpecificOptions populated when Saxo returns filler entries', async () => {
    const { normalizeOptionChain } = await import('../src/saxo/reference.js');
    // Reproduces the Saxo behavior with ExpiryDates=2027-01-15: all 15
    // expiry metadata entries come back, only the requested one has
    // SpecificOptions populated. The other 14 should be dropped.
    const raw = {
      OptionSpace: [
        {
          Expiry: '2026-07-17',
          DisplayDaysToExpiry: 100,
          SpecificOptions: [], // empty — should be dropped
        },
        {
          Expiry: '2027-01-15',
          DisplayDaysToExpiry: 300,
          SpecificOptions: [
            { Uic: 1, StrikePrice: 15, PutCall: 'Call' as const, TradingStatus: 'Tradable' },
            { Uic: 2, StrikePrice: 15, PutCall: 'Put' as const, TradingStatus: 'Tradable' },
          ],
        },
        {
          Expiry: '2027-06-17',
          DisplayDaysToExpiry: 500,
          // SpecificOptions omitted entirely
        },
      ],
    };
    const norm = normalizeOptionChain(raw);
    expect(norm.expiries.map(e => e.expiry)).toEqual(['2027-01-15']);
    expect(norm.strikes.map(s => s.strike)).toEqual([15]);
  });

  it('keeps all expiries when all are populated (unfiltered query path)', async () => {
    const { normalizeOptionChain } = await import('../src/saxo/reference.js');
    const raw = {
      OptionSpace: [
        {
          Expiry: '2026-07-17',
          SpecificOptions: [
            { Uic: 10, StrikePrice: 10, PutCall: 'Call' as const },
          ],
        },
        {
          Expiry: '2027-01-15',
          SpecificOptions: [
            { Uic: 20, StrikePrice: 20, PutCall: 'Call' as const },
          ],
        },
      ],
    };
    const norm = normalizeOptionChain(raw);
    expect(norm.expiries.map(e => e.expiry)).toEqual(['2026-07-17', '2027-01-15']);
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
    // bidAskWidth = sum of per-leg widths = (1.7-1.5) + (0.6-0.4) = 0.4.
    // Equal to worstCaseDebit - bestCaseDebit by identity.
    expect(result.bidAskWidth).toBeCloseTo(0.4, 5);
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
