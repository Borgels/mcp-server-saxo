import { describe, expect, it, vi } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import { getOptionChain, planOptionStrategy } from '../src/saxo/options.js';

describe('options tools', () => {
  it('resolves a StockOption root and returns a filtered priced chain', async () => {
    const fetchMock = optionFetchMock();
    const client = testClient(fetchMock);

    const result = await getOptionChain(
      client,
      {
        keywords: 'AAPL',
        minDte: 14,
        maxDte: 60,
        strikeWindowPercent: 12,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.optionRoot).toMatchObject({
      optionRootId: 309,
      assetType: 'StockOption',
      contractSize: 100,
      underlyingPrice: 100,
      underlyingUic: 211,
    });
    expect(result.expiries).toHaveLength(1);
    expect(result.expiries[0]?.contracts.map(contract => contract.strikePrice).sort((a, b) => a - b)).toEqual([
      90, 95, 95, 105, 105, 110, 110,
    ]);
    expect(result.expiries[0]?.contracts[0]).toMatchObject({
      assetType: 'StockOption',
      bid: expect.any(Number),
      ask: expect.any(Number),
      openInterest: expect.any(Number),
    });
  });

  it('prefers OPRA/USD option roots when Saxo also returns non-US roots', async () => {
    const fetchMock = optionFetchMock();
    const client = testClient(fetchMock);

    const result = await getOptionChain(
      client,
      {
        keywords: 'NOK',
        minDte: 14,
        maxDte: 60,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.optionRoot).toMatchObject({
      optionRootId: 1467,
      currencyCode: 'USD',
      exchangeId: 'OPRA',
      symbol: 'NOK:xcbf',
    });
  });

  it('generates ranked read-only strategy plans with precheck drafts', async () => {
    const fetchMock = optionFetchMock();
    const client = testClient(fetchMock);

    const result = await planOptionStrategy(
      client,
      {
        accountKey: 'account-1',
        keywords: 'AAPL',
        strategies: ['cash_secured_put', 'put_credit_spread', 'iron_condor'],
        maxCandidates: 5,
        minOpenInterest: 10,
        maxSpreadPercent: 25,
        externalContext: {
          sentiment: 'neutral',
          technicalBias: 'neutral',
          summary: 'No strong directional edge; prefer defined-risk or income structures.',
        },
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.optionRoot.optionRootId).toBe(309);
    expect(result.Data.length).toBeGreaterThan(0);
    expect(result.Data.map(plan => plan.rank)).toEqual([1, 2, 3, 4]);
    expect(result.Data.every(plan => plan.maxProfit !== undefined && plan.maxLoss !== undefined)).toBe(true);
    expect(result.Data.some(plan => plan.strategy === 'iron_condor')).toBe(true);
    expect(result.Data.some(plan => plan.singleLegPrecheckInput || plan.multilegPrecheckInput)).toBe(true);
    expect(result.Data.filter(plan => plan.legs.length > 1).every(plan => plan.pricing !== undefined)).toBe(true);
    expect(result.Data[0]?.score).toMatchObject({
      liquidity: expect.any(Number),
      structure: expect.any(Number),
      context: expect.any(Number),
      greekRisk: expect.any(Number),
    });
  });

  it('filters strategy candidates by risk budget', async () => {
    const fetchMock = optionFetchMock();
    const client = testClient(fetchMock);

    const result = await planOptionStrategy(
      client,
      {
        accountKey: 'account-1',
        keywords: 'AAPL',
        strategies: ['cash_secured_put', 'put_credit_spread'],
        maxCandidates: 10,
        riskBudget: 600,
        minOpenInterest: 10,
        maxSpreadPercent: 25,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.Data.length).toBeGreaterThan(0);
    expect(result.Data.every(plan => (plan.maxLoss ?? 0) <= 600)).toBe(true);
    expect(result.Data.every(plan => plan.strategy !== 'cash_secured_put')).toBe(true);
  });

  it('generates long-call plans for conviction-style defined premium risk', async () => {
    const fetchMock = optionFetchMock();
    const client = testClient(fetchMock);

    const result = await planOptionStrategy(
      client,
      {
        accountKey: 'account-1',
        keywords: 'AAPL',
        strategies: ['long_call'],
        maxCandidates: 3,
        minOpenInterest: 10,
        maxSpreadPercent: 25,
        includeVolatilityContext: false,
        externalContext: {
          sentiment: 'bullish',
          technicalBias: 'bullish',
        },
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.Data.length).toBeGreaterThan(0);
    expect(result.Data.every(plan => plan.strategy === 'long_call')).toBe(true);
    expect(result.Data[0]).toMatchObject({
      orderSide: 'Buy',
      estimatedDebit: expect.any(Number),
      maxLoss: expect.any(Number),
      greeks: expect.objectContaining({
        delta: expect.any(Number),
        theta: expect.any(Number),
        thetaDailyPercentOfRisk: expect.any(Number),
      }),
      singleLegPrecheckInput: expect.objectContaining({
        BuySell: 'Buy',
        AssetType: 'StockOption',
      }),
    });
    expect(result.Data[0]?.maxProfit).toBeUndefined();
  });

  it('filters strategies that open short option legs when disabled', async () => {
    const fetchMock = optionFetchMock();
    const client = testClient(fetchMock);

    const result = await planOptionStrategy(
      client,
      {
        accountKey: 'account-1',
        keywords: 'AAPL',
        strategies: ['long_call', 'debit_spread', 'put_credit_spread'],
        allowShortOptionLegs: false,
        maxCandidates: 10,
        minOpenInterest: 10,
        maxSpreadPercent: 25,
        includeVolatilityContext: false,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.Data.length).toBeGreaterThan(0);
    expect(result.Data.every(plan => plan.strategy === 'long_call')).toBe(true);
    expect(result.Data.every(plan => plan.legs.every(leg => leg.buySell === 'Buy'))).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/allowShortOptionLegs=false/),
    ]));
  });

  it('filters short call strategies for restricted underlyings', async () => {
    const fetchMock = optionFetchMock();
    const client = testClient(fetchMock);

    const result = await planOptionStrategy(
      client,
      {
        accountKey: 'account-1',
        keywords: 'AAPL',
        strategies: ['long_call', 'debit_spread'],
        restrictedShortCallSymbols: ['AAPL'],
        maxCandidates: 10,
        minOpenInterest: 10,
        maxSpreadPercent: 25,
        includeVolatilityContext: false,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.Data.length).toBeGreaterThan(0);
    expect(result.Data.every(plan => plan.strategy === 'long_call')).toBe(true);
    expect(result.Data.every(plan =>
      plan.legs.every(leg => !(leg.buySell === 'Sell' && leg.putCall === 'Call')),
    )).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/restrictedShortCallSymbols/),
    ]));
  });
});

function testClient(fetchMock: typeof fetch): SaxoClient {
  return new SaxoClient({
    environment: 'sim',
    accessToken: 'token',
    fetchImpl: fetchMock,
  });
}

function optionFetchMock(): typeof fetch {
  return vi.fn<typeof fetch>(async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/ref/v1/instruments')) {
      const keyword = (parsed.searchParams.get('Keywords') ?? '').toUpperCase();
      if (keyword === 'NOK') {
        return jsonResponse({
          Data: [
            {
              AssetType: 'StockOption',
              CanParticipateInMultiLegOrder: true,
              CurrencyCode: 'EUR',
              Description: 'Nokia',
              ExchangeId: 'EUREX',
              GroupOptionRootId: 680,
              Identifier: 680,
              SummaryType: 'ContractOptionRoot',
              Symbol: 'NOKIA:xeur',
            },
            {
              AssetType: 'StockOption',
              CanParticipateInMultiLegOrder: true,
              CurrencyCode: 'USD',
              Description: 'Nokia Corp.',
              ExchangeId: 'OPRA',
              GroupOptionRootId: 1467,
              Identifier: 1467,
              SummaryType: 'ContractOptionRoot',
              Symbol: 'NOK:xcbf',
            },
          ],
        });
      }
      return jsonResponse({
        Data: [
          {
            AssetType: 'StockOption',
            CanParticipateInMultiLegOrder: true,
            CurrencyCode: 'USD',
            Description: 'Apple Inc.',
            ExchangeId: 'OPRA',
            GroupOptionRootId: 309,
            Identifier: 309,
            SummaryType: 'ContractOptionRoot',
            Symbol: 'AAPL:xcbf',
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/ref/v1/instruments/contractoptionspaces/309')) {
      return jsonResponse(optionSpace());
    }
    if (parsed.pathname.endsWith('/ref/v1/instruments/contractoptionspaces/1467')) {
      return jsonResponse({ ...optionSpace(), OptionRootId: 1467, Description: 'Nokia Corp.' });
    }
    if (parsed.pathname.endsWith('/trade/v1/infoprices')) {
      return jsonResponse({
        Quote: {
          Bid: 99.9,
          Ask: 100.1,
          Mid: 100,
        },
        Uic: 211,
      });
    }
    if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
      const uics = (parsed.searchParams.get('Uics') ?? '').split(',').map(Number);
      return jsonResponse({
        Data: uics.map(optionPrice),
      });
    }
    if (parsed.pathname.endsWith('/trade/v1/prices/multileg')) {
      return jsonResponse({
        Quote: {
          Bid: 1.8,
          Ask: 2.0,
          Mid: 1.9,
          ErrorCode: 'None',
        },
        Legs: [],
        StrategyType: 'Custom',
      });
    }
    throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${parsed.pathname}`);
  }) as unknown as typeof fetch;
}

function optionSpace() {
  return {
    AssetType: 'StockOption',
    CanParticipateInMultiLegOrder: true,
    ContractSize: 100,
    CurrencyCode: 'USD',
    DefaultOption: {
      UnderlyingUic: 211,
    },
    Description: 'Apple Inc.',
    Exchange: {
      ExchangeId: 'OPRA',
      Name: 'Options Price Reporting Authority',
    },
    ExerciseStyle: 'American',
    OptionRootId: 309,
    OptionSpace: [
      {
        DisplayDaysToExpiry: 31,
        DisplayExpiry: '2026-02-01',
        Expiry: '2026-02-01',
        SpecificOptions: [
          option(1001, 'Put', 80),
          option(1002, 'Put', 90),
          option(1003, 'Put', 95),
          option(1004, 'Call', 95),
          option(1005, 'Put', 105),
          option(1006, 'Call', 105),
          option(1007, 'Put', 110),
          option(1008, 'Call', 110),
          option(1009, 'Call', 120),
        ],
      },
    ],
  };
}

function option(Uic: number, PutCall: 'Put' | 'Call', StrikePrice: number) {
  return {
    PutCall,
    StrikePrice,
    TradingStatus: 'Tradable',
    Uic,
    UnderlyingUic: 211,
  };
}

function optionPrice(Uic: number) {
  const table: Record<number, { bid: number; ask: number; symbol: string; oi: number; volume: number }> = {
    1001: { bid: 0.35, ask: 0.45, symbol: 'AAPL/01B26P80:xcbf', oi: 200, volume: 20 },
    1002: { bid: 1.15, ask: 1.25, symbol: 'AAPL/01B26P90:xcbf', oi: 500, volume: 50 },
    1003: { bid: 2.1, ask: 2.25, symbol: 'AAPL/01B26P95:xcbf', oi: 1200, volume: 110 },
    1004: { bid: 2.2, ask: 2.35, symbol: 'AAPL/01B26C95:xcbf', oi: 1100, volume: 120 },
    1005: { bid: 6.8, ask: 7.05, symbol: 'AAPL/01B26P105:xcbf', oi: 800, volume: 80 },
    1006: { bid: 2.0, ask: 2.15, symbol: 'AAPL/01B26C105:xcbf', oi: 900, volume: 90 },
    1007: { bid: 11.1, ask: 11.35, symbol: 'AAPL/01B26P110:xcbf', oi: 500, volume: 40 },
    1008: { bid: 1.05, ask: 1.15, symbol: 'AAPL/01B26C110:xcbf', oi: 700, volume: 70 },
    1009: { bid: 0.25, ask: 0.35, symbol: 'AAPL/01B26C120:xcbf', oi: 300, volume: 30 },
  };
  const quote = table[Uic] ?? { bid: 1, ask: 1.2, symbol: `OPT${Uic}`, oi: 100, volume: 10 };
  return {
    DisplayAndFormat: {
      Description: quote.symbol,
      Symbol: quote.symbol,
    },
    InstrumentPriceDetails: {
      IsMarketOpen: true,
      OpenInterest: quote.oi,
      ShortTradeDisabled: false,
    },
    Greeks: {
      Delta: quote.symbol.includes('C') ? 0.45 : -0.35,
      Gamma: 0.03,
      Theta: quote.symbol.includes('C') ? -0.04 : -0.03,
      Vega: 0.12,
    },
    LastUpdated: '2026-01-01T12:00:00.000Z',
    PriceInfoDetails: {
      AskSize: 25,
      BidSize: 25,
      Volume: quote.volume,
    },
    PriceSource: 'OPRA',
    Quote: {
      Ask: quote.ask,
      AskSize: 25,
      Bid: quote.bid,
      BidSize: 25,
      DelayedByMinutes: 15,
      ErrorCode: 'None',
      Mid: (quote.bid + quote.ask) / 2,
    },
    Uic,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}
