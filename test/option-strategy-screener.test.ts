import { describe, expect, it, vi } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import { setMarketContextFetchImpl } from '../src/saxo/market-context.js';
import { screenOptionStrategies } from '../src/saxo/option-strategy-screener.js';
import { planPortfolioStrategy } from '../src/saxo/portfolio-strategy.js';

describe('screenOptionStrategies', () => {
  it('uses explicit symbols, ranks globally, and caps returned plans per symbol before filling', async () => {
    const client = testClient(strategyScreenerFetchMock());

    const result = await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        symbols: ['AAA:xnas', 'BBB:xnas'],
        strategies: ['put_credit_spread', 'iron_condor'],
        maxPlans: 4,
        maxSymbolsToPlan: 2,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.counters.symbolsPlanned).toBe(2);
    expect(result.Data).toHaveLength(4);
    expect(result.underlyings.map(item => item.source)).toEqual(['symbols', 'symbols']);
    const counts = result.Data.reduce<Record<string, number>>((acc, plan) => {
      acc[plan.symbol] = (acc[plan.symbol] ?? 0) + 1;
      return acc;
    }, {});
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(3);
    expect(result.Data.every(plan => plan.rank > 0 && plan.optionRootId !== undefined)).toBe(true);
  });

  it('discovers underlyings from the market screener when symbols are omitted', async () => {
    const fetchMock = strategyScreenerFetchMock();
    const client = testClient(fetchMock);

    const result = await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        market: 'us_nasdaq',
        maxUnderlyings: 2,
        maxSymbolsToPlan: 1,
        maxPlans: 2,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.underlyings[0]).toMatchObject({
      source: 'market_screener',
      symbol: 'AAA',
      planned: true,
    });
    expect(result.Data.length).toBeGreaterThan(0);
    const stockScreenCall = fetchMock.mock.calls.find(call => {
      const url = new URL(String(call[0]));
      return url.pathname.endsWith('/ref/v1/instruments') && url.searchParams.get('AssetTypes') === 'Stock';
    });
    expect(stockScreenCall).toBeTruthy();
  });

  it('derives Saxo chart technical context and feeds it into strategy screening', async () => {
    const fetchMock = strategyScreenerFetchMock();
    const client = testClient(fetchMock);

    const result = await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        market: 'us_nasdaq',
        maxUnderlyings: 1,
        maxSymbolsToPlan: 1,
        maxPlans: 2,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.filters.includeTechnicalContext).toBe(true);
    expect(result.filters.includeVolatilityContext).toBe(true);
    expect(result.underlyings[0]?.screeningContext).toMatchObject({
      source: 'saxo_chart',
      technicalBias: 'bullish',
    });
    expect(result.Data[0]?.effectiveContext?.technicalBias).toBe('bullish');
    expect(result.Data[0]?.effectiveContext?.volatility).toMatchObject({
      source: 'saxo_optionschain',
      regime: 'high',
      impliedVolatilityRank: 82,
    });
    expect(result.Data[0]?.screeningContext?.metrics.return20dPercent).toBeGreaterThan(0);
    const chartCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/chart/v3/charts'));
    expect(chartCall).toBeTruthy();
    const optionsChainCall = fetchMock.mock.calls.find(call =>
      String(call[0]).includes('/trade/v1/optionschain/subscriptions') && (call[1]?.method ?? 'GET') === 'POST',
    );
    expect(optionsChainCall).toBeTruthy();
    const optionsChainCleanup = fetchMock.mock.calls.find(call =>
      String(call[0]).includes('/trade/v1/optionschain/subscriptions') && call[1]?.method === 'DELETE',
    );
    expect(optionsChainCleanup).toBeTruthy();
  });

  it('adds account-aware sizing, ranking breakdown, and decision briefs by default', async () => {
    const fetchMock = strategyScreenerFetchMock();
    const client = testClient(fetchMock);

    const result = await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        symbols: ['AAA'],
        maxSymbolsToPlan: 1,
        maxPlans: 2,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.accountContext).toMatchObject({
      available: true,
      netValue: 100_000,
      cashAvailable: 50_000,
      positionsCount: 0,
    });
    expect(result.Data[0]?.positionSizing).toMatchObject({
      sizingVerdict: 'pass',
      maxRiskBudget: 1_000,
    });
    expect(result.Data[0]?.rankingBreakdown).toMatchObject({
      liquidityScore: expect.any(Number),
      playbookFitScore: expect.any(Number),
      accountFitScore: expect.any(Number),
      finalScore: expect.any(Number),
    });
    expect(result.decisionBriefs[0]).toMatchObject({
      symbol: 'AAA',
      verdict: expect.stringMatching(/pass|watchlist/),
      confidence: expect.stringMatching(/low|medium|high/),
      accountFit: expect.objectContaining({ sizingVerdict: 'pass' }),
    });
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/port/v1/balances'))).toBe(true);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/port/v1/positions'))).toBe(true);
  });

  it('marks plans too large when an explicit risk budget cannot support one contract', async () => {
    const client = testClient(strategyScreenerFetchMock());

    const result = await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        symbols: ['AAA'],
        maxSymbolsToPlan: 1,
        maxPlans: 1,
        riskBudgetPercent: 0.01,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.Data[0]?.positionSizing).toMatchObject({
      sizingVerdict: 'too_large',
      maxContracts: 0,
    });
    expect(result.decisionBriefs[0]?.verdict).toBe('reject');
  });

  it('does not fetch portfolio endpoints when account context is disabled', async () => {
    const fetchMock = strategyScreenerFetchMock();
    const client = testClient(fetchMock);

    await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        symbols: ['AAA'],
        maxSymbolsToPlan: 1,
        maxPlans: 1,
        includeAccountContext: false,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/port/v1/balances'))).toBe(false);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/port/v1/positions'))).toBe(false);
  });

  it('optionally adds Alpha Vantage news and earnings context to screening', async () => {
    const fetchMock = strategyScreenerFetchMock();
    const previousKey = process.env.ALPHA_VANTAGE_API_KEY;
    process.env.ALPHA_VANTAGE_API_KEY = 'demo-key';
    const client = testClient(fetchMock);
    setMarketContextFetchImpl(fetchMock);

    try {
      const result = await screenOptionStrategies(
        client,
        {
          accountKey: 'account-1',
          market: 'us_nasdaq',
          maxUnderlyings: 1,
          maxSymbolsToPlan: 1,
          maxPlans: 2,
          minOpenInterest: 10,
          maxSpreadPercent: 40,
          includeNewsContext: true,
          newsProvider: 'alpha_vantage',
        },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(result.filters.includeNewsContext).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.underlyings[0]?.newsContext).toMatchObject({
        provider: 'alpha_vantage',
        sentiment: 'bullish',
        headlineCount: 1,
        earnings: {
          reportDate: '2026-01-05',
          daysUntil: 4,
        },
      });
      expect(result.Data[0]?.effectiveContext?.news?.sentiment).toBe('bullish');
      expect(result.Data[0]?.effectiveContext?.riskNotes?.join(' ')).toContain('Earnings are within 4 days');
      const newsCall = fetchMock.mock.calls.find(call => String(call[0]).includes('function=NEWS_SENTIMENT'));
      const earningsCall = fetchMock.mock.calls.find(call => String(call[0]).includes('function=EARNINGS_CALENDAR'));
      expect(newsCall).toBeTruthy();
      expect(earningsCall).toBeTruthy();
    } finally {
      if (previousKey === undefined) {
        delete process.env.ALPHA_VANTAGE_API_KEY;
      } else {
        process.env.ALPHA_VANTAGE_API_KEY = previousKey;
      }
      setMarketContextFetchImpl(undefined);
    }
  });

  it('skips symbols without option roots and continues', async () => {
    const client = testClient(strategyScreenerFetchMock());

    const result = await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        symbols: ['MISS', 'AAA'],
        maxSymbolsToPlan: 2,
        maxPlans: 2,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.underlyings.find(item => item.symbol === 'MISS')).toMatchObject({
      planned: false,
      skipReason: expect.stringContaining('No StockOption root'),
    });
    expect(result.underlyings.find(item => item.symbol === 'AAA')).toMatchObject({ planned: true });
    expect(result.Data.length).toBeGreaterThan(0);
  });

  it('returns partial results and stops after a rate-limit response', async () => {
    const client = testClient(strategyScreenerFetchMock());

    const result = await screenOptionStrategies(
      client,
      {
        accountKey: 'account-1',
        symbols: ['AAA', 'RATE', 'BBB'],
        maxSymbolsToPlan: 3,
        maxPlans: 3,
        minOpenInterest: 10,
        maxSpreadPercent: 40,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.Data.length).toBeGreaterThan(0);
    expect(result.underlyings.find(item => item.symbol === 'RATE')?.skipReason).toContain('Saxo HTTP 429');
    expect(result.underlyings.find(item => item.symbol === 'BBB')?.skipReason).toContain('rate-limit');
    expect(result.warnings.join(' ')).toContain('Stopped option strategy screening early');
  });

  it('builds guardrailed options portfolio sleeves from explicit option theses', async () => {
    const client = testClient(strategyScreenerFetchMock());

    const result = await planPortfolioStrategy(
      client,
      {
        accountKey: 'account-1',
        includeStocks: false,
        includeOptions: true,
        maxOptionsRiskPercent: 20,
        maxOptionIdeas: 3,
        optionTheses: [
          {
            name: 'AAA conviction',
            symbols: ['AAA'],
            role: 'core_conviction',
            conviction: 'high',
            horizon: 'swing',
            preferredStructures: ['debit_spread', 'put_credit_spread'],
            targetRiskPercent: 50,
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.optionsPortfolioPlan).toMatchObject({
      mode: 'guardrailed',
      totalBudget: 20_000,
    });
    expect(result.optionsPortfolioPlan?.sleeves[0]).toMatchObject({
      thesisName: 'AAA conviction',
      targetRisk: 10_000,
    });
    expect(result.optionsPortfolioPlan?.selectedCandidates.length).toBeGreaterThan(0);
    expect(result.optionsPortfolioPlan?.selectedCandidates[0]?.plannedRisk).toBeLessThanOrEqual(5_000);
    expect(result.optionsPortfolioPlan?.selectedCandidates[0]?.greeks).toMatchObject({
      theta: expect.any(Number),
      thetaDailyPercentOfRisk: expect.any(Number),
    });
    expect(result.optionsPortfolioPlan?.selectedCandidates[0]?.rationale).toContain('Net theta');
    expect(result.optionsRiskDashboard).toMatchObject({
      maxOptionsRiskDollars: 20_000,
      maxThesisRiskDollars: 10_000,
      maxSingleTradeRiskDollars: 5_000,
    });
    expect(result.optionAllocationPlan[0]).toMatchObject({
      symbol: 'AAA',
      recommendedContracts: 1,
    });
  });

  it('keeps option-root failures visible as rejected portfolio candidates', async () => {
    const client = testClient(strategyScreenerFetchMock());

    const result = await planPortfolioStrategy(
      client,
      {
        accountKey: 'account-1',
        includeStocks: false,
        includeOptions: true,
        optionTheses: [
          {
            name: 'Unavailable options',
            symbols: ['MISS'],
            preferredStructures: ['long_call'],
            horizon: 'leaps',
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.optionsPortfolioPlan?.selectedCandidates).toHaveLength(0);
    expect(result.optionsPortfolioPlan?.rejectedCandidates[0]).toMatchObject({
      thesisName: 'Unavailable options',
      symbol: 'MISS',
      reason: expect.stringContaining('No StockOption root'),
    });
  });
});

function testClient(fetchMock: typeof fetch): SaxoClient {
  return new SaxoClient({
    environment: 'sim',
    accessToken: 'token',
    fetchImpl: fetchMock,
  });
}

function strategyScreenerFetchMock() {
  return vi.fn<typeof fetch>(async (url, init) => {
    const parsed = new URL(String(url));
    if (String(url).includes('alphavantage.co')) {
      if (parsed.searchParams.get('function') === 'NEWS_SENTIMENT') {
        return jsonResponse({
          feed: [
            {
              title: 'AAA raises outlook after strong demand',
              url: 'https://example.test/aaa',
              time_published: '20251231T180000',
              source: 'Example News',
              summary: 'AAA guidance improved after strong demand.',
              overall_sentiment_score: 0.4,
              overall_sentiment_label: 'Bullish',
              topics: [{ topic: 'Earnings', relevance_score: '0.8' }],
              ticker_sentiment: [
                {
                  ticker: 'AAA',
                  relevance_score: '0.95',
                  ticker_sentiment_score: '0.45',
                  ticker_sentiment_label: 'Bullish',
                },
              ],
            },
          ],
        });
      }
      if (parsed.searchParams.get('function') === 'EARNINGS_CALENDAR') {
        return new Response('symbol,name,reportDate,fiscalDateEnding,estimate,currency\nAAA,AAA Inc.,2026-01-05,2025-12-31,1.23,USD\n', {
          headers: { 'content-type': 'text/csv' },
        });
      }
    }
    if (parsed.pathname.endsWith('/ref/v1/instruments')) {
      const assetType = parsed.searchParams.get('AssetTypes');
      const keyword = (parsed.searchParams.get('Keywords') ?? '').toUpperCase();
      if (assetType === 'Stock') {
        return jsonResponse({
          Data: [
            stock(11, 'AAA:xnas', 'AAA Inc.', 4.5),
            stock(22, 'BBB:xnas', 'BBB Inc.', 2.5),
          ],
        });
      }
      if (assetType === 'StockOption') {
        if (keyword === 'MISS') {
          return jsonResponse({ Data: [] });
        }
        if (keyword === 'RATE') {
          return jsonResponse({ ErrorCode: 'RateLimitExceeded' }, 429, { 'retry-after': '3' });
        }
        return jsonResponse({
          Data: [
            {
              AssetType: 'StockOption',
              CanParticipateInMultiLegOrder: true,
              CurrencyCode: 'USD',
              Description: `${keyword} Inc.`,
              ExchangeId: 'OPRA',
              GroupOptionRootId: rootId(keyword),
              Identifier: rootId(keyword),
              SummaryType: 'ContractOptionRoot',
              Symbol: `${keyword}:xcbf`,
            },
          ],
        });
      }
    }
    if (parsed.pathname.includes('/ref/v1/instruments/contractoptionspaces/')) {
      const optionRootId = Number(parsed.pathname.split('/').pop());
      return jsonResponse(optionSpace(optionRootId));
    }
    if (parsed.pathname.endsWith('/trade/v1/infoprices')) {
      return jsonResponse({
        Quote: {
          Bid: 99.9,
          Ask: 100.1,
          Mid: 100,
        },
        Uic: Number(parsed.searchParams.get('Uic')),
      });
    }
    if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
      const assetType = parsed.searchParams.get('AssetType');
      const uics = (parsed.searchParams.get('Uics') ?? '').split(',').filter(Boolean).map(Number);
      if (assetType === 'Stock') {
        return jsonResponse({ Data: uics.map((uic, index) => stockPrice(uic, index === 0 ? 'AAA:xnas' : 'BBB:xnas')) });
      }
      return jsonResponse({ Data: uics.map(optionPrice) });
    }
    if (parsed.pathname.endsWith('/chart/v3/charts')) {
      return jsonResponse(chart(Number(parsed.searchParams.get('Uic'))));
    }
    if (parsed.pathname.endsWith('/trade/v1/optionschain/subscriptions') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { Arguments?: { Identifier?: number } };
      return jsonResponse(optionChainSnapshot(body.Arguments?.Identifier ?? 101));
    }
    if (parsed.pathname.includes('/trade/v1/optionschain/subscriptions/') && init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (parsed.pathname.endsWith('/trade/v1/prices/multileg')) {
      return jsonResponse({
        Quote: { Bid: 1.8, Ask: 2, Mid: 1.9, ErrorCode: 'None' },
        Legs: [],
        StrategyType: 'Custom',
      });
    }
    if (parsed.pathname.endsWith('/port/v1/accounts/me')) {
      return jsonResponse({
        Data: [{ AccountKey: 'account-1', ClientKey: 'client-1' }],
      });
    }
    if (parsed.pathname.endsWith('/port/v1/balances')) {
      expect(parsed.searchParams.get('ClientKey')).toBe('client-1');
      return jsonResponse({
        NetEquityForMargin: 100_000,
        CashAvailableForTrading: 50_000,
        MarginAvailableForTrading: 75_000,
      });
    }
    if (parsed.pathname.endsWith('/port/v1/positions') || parsed.pathname.endsWith('/port/v1/positions/me')) {
      return jsonResponse({ Data: [] });
    }
    throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${parsed.pathname}`);
  });
}

function optionChainSnapshot(optionRootId: number) {
  const rank = optionRootId === 202 ? 18 : 82;
  return {
    ContextId: 'context-1',
    ReferenceId: 'reference-1',
    Snapshot: {
      AssetType: 'StockOption',
      ExpiryCount: 1,
      ImpliedVolatilityData: {
        ImpliedVolatility: optionRootId === 202 ? 0.21 : 0.68,
        ImpliedVolatilityPercentile: optionRootId === 202 ? 22 : 91,
        ImpliedVolatilityRank: rank,
      },
      LastUpdated: '2026-01-01T12:00:00.000Z',
    },
  };
}

function chart(uic: number) {
  const start = uic === 22 ? 120 : 80;
  const step = uic === 22 ? -0.15 : 0.35;
  return {
    Data: Array.from({ length: 90 }, (_, index) => {
      const close = start + index * step;
      return {
        CloseMid: close,
        HighMid: close + 1,
        LowMid: close - 1,
        OpenMid: close - step / 2,
        Time: new Date(Date.UTC(2025, 9, index + 1)).toISOString(),
      };
    }),
  };
}

function rootId(symbol: string): number {
  return symbol === 'BBB' ? 202 : 101;
}

function stock(Identifier: number, Symbol: string, Description: string, PercentChange: number) {
  return {
    AssetType: 'Stock',
    CurrencyCode: 'USD',
    Description,
    ExchangeId: 'NASDAQ',
    Identifier,
    Symbol,
    PercentChange,
  };
}

function stockPrice(Uic: number, Symbol: string) {
  return {
    AssetType: 'Stock',
    DisplayAndFormat: { Symbol },
    HistoricalChanges: { PercentChangeDaily: Symbol.startsWith('AAA') ? 4.5 : 2.5 },
    InstrumentPriceDetails: { IsMarketOpen: true },
    PriceInfo: { PercentChange: Symbol.startsWith('AAA') ? 4.5 : 2.5 },
    PriceInfoDetails: { LastTraded: 100 },
    Quote: { Bid: 99.9, Ask: 100.1, ErrorCode: 'None', Mid: 100 },
    Uic,
  };
}

function optionSpace(optionRootId: number) {
  const base = optionRootId * 100;
  return {
    AssetType: 'StockOption',
    CanParticipateInMultiLegOrder: true,
    ContractSize: 100,
    CurrencyCode: 'USD',
    DefaultOption: { UnderlyingUic: optionRootId === 202 ? 22 : 11 },
    Description: optionRootId === 202 ? 'BBB Inc.' : 'AAA Inc.',
    Exchange: { ExchangeId: 'OPRA', Name: 'Options Price Reporting Authority' },
    ExerciseStyle: 'American',
    OptionRootId: optionRootId,
    OptionSpace: [
      {
        DisplayDaysToExpiry: 31,
        DisplayExpiry: '2026-02-01',
        Expiry: '2026-02-01',
        SpecificOptions: [
          option(base + 1, 'Put', 90),
          option(base + 2, 'Put', 95),
          option(base + 3, 'Put', 100),
          option(base + 4, 'Call', 100),
          option(base + 5, 'Call', 105),
          option(base + 6, 'Call', 110),
        ],
      },
    ],
  };
}

function option(Uic: number, PutCall: 'Put' | 'Call', StrikePrice: number) {
  return { PutCall, StrikePrice, TradingStatus: 'Tradable', Uic, UnderlyingUic: 11 };
}

function optionPrice(Uic: number) {
  const lastTwo = Uic % 100;
  const table: Record<number, { bid: number; ask: number; oi: number }> = {
    1: { bid: 1.1, ask: 1.2, oi: 700 },
    2: { bid: 2.2, ask: 2.35, oi: 1000 },
    3: { bid: 4.8, ask: 5, oi: 1200 },
    4: { bid: 4.6, ask: 4.8, oi: 1100 },
    5: { bid: 2.1, ask: 2.25, oi: 900 },
    6: { bid: 1.05, ask: 1.15, oi: 800 },
  };
  const quote = table[lastTwo] ?? { bid: 1, ask: 1.2, oi: 500 };
  return {
    DisplayAndFormat: { Description: `OPT${Uic}`, Symbol: `OPT${Uic}` },
    Greeks: {
      Delta: lastTwo <= 3 ? -0.35 : 0.45,
      Gamma: 0.03,
      Theta: -0.04,
      Vega: 0.1,
    },
    InstrumentPriceDetails: { IsMarketOpen: true, OpenInterest: quote.oi, ShortTradeDisabled: false },
    LastUpdated: '2026-01-01T12:00:00.000Z',
    PriceInfoDetails: { AskSize: 25, BidSize: 25, Volume: 50 },
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

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}
