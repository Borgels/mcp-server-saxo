import { describe, expect, it, vi } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import { planPortfolioStrategy } from '../src/saxo/portfolio-strategy.js';
import { setMarketContextFetchImpl } from '../src/saxo/market-context.js';
import { screenStockStrategies } from '../src/saxo/stock-strategy-screener.js';

describe('screenStockStrategies', () => {
  it('returns account-aware stock factors with Alpha Vantage market cap fundamentals', async () => {
    const previousKey = process.env.ALPHA_VANTAGE_API_KEY;
    process.env.ALPHA_VANTAGE_API_KEY = 'demo-key';
    const fetchMock = stockFetchMock();
    setMarketContextFetchImpl(fetchMock);
    const client = testClient(fetchMock);

    try {
      const result = await screenStockStrategies(
        client,
        {
          accountKey: 'account-1',
          symbols: ['AAA', 'BBB'],
          maxResults: 2,
          includeFundamentalContext: true,
          fundamentalsLimit: 2,
          includeNewsContext: false,
        },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(result.Data).toHaveLength(2);
      expect(result.accountContext).toMatchObject({
        available: true,
        netValue: 100_000,
        cashAvailable: 100_000,
      });
      expect(result.Data[0]?.fundamentalsContext).toMatchObject({
        marketCapitalization: 250_000_000_000,
        marketCapBucket: 'mega',
      });
      expect(result.Data[0]?.factorScores).toMatchObject({
        liquidityScore: expect.any(Number),
        trendScore: expect.any(Number),
        accountFitScore: expect.any(Number),
      });
      expect(result.Data[0]?.positionSizing).toMatchObject({
        sizingStatus: 'fits',
        maxRiskBudget: 1_000,
      });
      expect(result).not.toHaveProperty('decisionBriefs');
      const priceCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/trade/v1/infoprices/list'));
      expect(priceCalls).toHaveLength(1);
      expect(fetchMock.mock.calls.some(call => String(call[0]).includes('function=OVERVIEW'))).toBe(true);
    } finally {
      if (previousKey === undefined) {
        delete process.env.ALPHA_VANTAGE_API_KEY;
      } else {
        process.env.ALPHA_VANTAGE_API_KEY = previousKey;
      }
      setMarketContextFetchImpl(undefined);
    }
  });

  it('defers candidates that would breach single-name exposure caps', async () => {
    const fetchMock = stockFetchMock({ existingExposure: 9_950 });
    const client = testClient(fetchMock);

    const result = await screenStockStrategies(
      client,
      {
        accountKey: 'account-1',
        symbols: ['AAA'],
        maxResults: 1,
        includeFundamentalContext: false,
        maxSingleNamePercent: 10,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.Data).toHaveLength(0);
    expect(result.constraintLimitedCandidates[0]?.positionSizing?.sizingStatus).toBe('over_budget');
  });
});

describe('planPortfolioStrategy', () => {
  it('builds a staged whole-account plan from stock screening without order/precheck calls', async () => {
    const fetchMock = stockFetchMock();
    const client = testClient(fetchMock);

    const result = await planPortfolioStrategy(
      client,
      {
        accountKey: 'account-1',
        includeOptions: false,
        includeStocks: true,
        stockSymbols: ['AAA', 'BBB'],
        maxSectorPercent: 40,
        includeFundamentalContext: false,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.portfolioSnapshot).toMatchObject({
      accountContextAvailable: true,
      netValue: 100_000,
      cashAvailable: 100_000,
    });
    expect(result.stockScreen?.Data.length).toBeGreaterThan(0);
    expect(result.stockContext).toHaveLength(2);
    expect(result.riskBudgets.perIdeaRiskBudgetDollars).toBe(1_000);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/trade/v2/orders'))).toBe(false);
  });

  it('caps stock allocation by known sector exposure when fundamentals are available', async () => {
    const previousKey = process.env.ALPHA_VANTAGE_API_KEY;
    process.env.ALPHA_VANTAGE_API_KEY = 'demo-key';
    const fetchMock = stockFetchMock();
    setMarketContextFetchImpl(fetchMock);
    const client = testClient(fetchMock);

    try {
      const result = await planPortfolioStrategy(
        client,
        {
          accountKey: 'account-1',
          includeOptions: false,
          includeStocks: true,
          stockSymbols: ['AAA', 'BBB'],
          maxStockIdeas: 2,
          maxSectorPercent: 5,
          includeFundamentalContext: true,
        },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(result.stockContext.map(item => item.sector)).toEqual(['Technology', 'Industrials']);
      expect(result.constraintSummary.sectorExposure.Technology).toBe(1);
      expect(result.constraintSummary.sectorExposure.Industrials).toBe(1);
    } finally {
      if (previousKey === undefined) {
        delete process.env.ALPHA_VANTAGE_API_KEY;
      } else {
        process.env.ALPHA_VANTAGE_API_KEY = previousKey;
      }
      setMarketContextFetchImpl(undefined);
    }
  });
});

function testClient(fetchMock: typeof fetch): SaxoClient {
  return new SaxoClient({
    environment: 'sim',
    accessToken: 'token',
    fetchImpl: fetchMock,
  });
}

function stockFetchMock(options: { existingExposure?: number } = {}) {
  return vi.fn<typeof fetch>(async (url, init) => {
    const parsed = new URL(String(url));
    if (String(url).includes('alphavantage.co')) {
      if (parsed.searchParams.get('function') === 'OVERVIEW') {
        const symbol = parsed.searchParams.get('symbol');
        return jsonResponse({
          Symbol: symbol,
          Sector: symbol === 'AAA' ? 'Technology' : 'Industrials',
          Industry: 'Software',
          MarketCapitalization: symbol === 'AAA' ? '250000000000' : '12000000000',
          PERatio: symbol === 'AAA' ? '31' : '18',
          Beta: symbol === 'AAA' ? '1.1' : '0.9',
          ProfitMargin: '0.18',
          RevenueTTM: '10000000000',
          SharesOutstanding: '1000000000',
        });
      }
    }
    if (parsed.pathname.endsWith('/ref/v1/instruments')) {
      const keyword = (parsed.searchParams.get('Keywords') ?? '').toUpperCase();
      const rows = [
        stock(11, 'AAA:xnas', 'AAA Inc.'),
        stock(22, 'BBB:xnys', 'BBB Inc.'),
      ];
      return jsonResponse({
        Data: keyword ? rows.filter(row => String(row.Symbol).startsWith(keyword)) : rows,
      });
    }
    if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
      const uics = (parsed.searchParams.get('Uics') ?? '').split(',').filter(Boolean).map(Number);
      return jsonResponse({ Data: uics.map(stockPrice) });
    }
    if (parsed.pathname.endsWith('/chart/v3/charts')) {
      return jsonResponse(chart(Number(parsed.searchParams.get('Uic'))));
    }
    if (parsed.pathname.endsWith('/port/v1/accounts/me')) {
      return jsonResponse({ Data: [{ AccountKey: 'account-1', ClientKey: 'client-1' }] });
    }
    if (parsed.pathname.endsWith('/port/v1/balances')) {
      expect(parsed.searchParams.get('ClientKey')).toBe('client-1');
      return jsonResponse({
        NetEquityForMargin: 100_000,
        CashAvailableForTrading: 100_000,
        MarginAvailableForTrading: 100_000,
      });
    }
    if (parsed.pathname.endsWith('/port/v1/positions') || parsed.pathname.endsWith('/port/v1/positions/me')) {
      return jsonResponse({
        Data: options.existingExposure
          ? [
            {
              DisplayAndFormat: { Symbol: 'AAA:xnas' },
              PositionView: { MarketValue: options.existingExposure },
            },
          ]
          : [],
      });
    }
    throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${parsed.pathname}`);
  });
}

function stock(Identifier: number, Symbol: string, Description: string) {
  return {
    AssetType: 'Stock',
    CurrencyCode: 'USD',
    Description,
    ExchangeId: Symbol.endsWith('xnas') ? 'NASDAQ' : 'NYSE',
    Identifier,
    SummaryType: 'Instrument',
    Symbol,
  };
}

function stockPrice(Uic: number) {
  const aaa = Uic === 11;
  return {
    AssetType: 'Stock',
    DisplayAndFormat: { Symbol: aaa ? 'AAA:xnas' : 'BBB:xnys', Description: aaa ? 'AAA Inc.' : 'BBB Inc.' },
    HistoricalChanges: { PercentChangeDaily: aaa ? 2.5 : -0.5 },
    PriceInfo: { PercentChange: aaa ? 2.5 : -0.5 },
    PriceInfoDetails: { LastClose: aaa ? 98 : 50, LastTraded: aaa ? 100 : 50, Volume: aaa ? 3_000_000 : 1_200_000 },
    Quote: { Bid: aaa ? 99.95 : 49.95, Ask: aaa ? 100.05 : 50.05, ErrorCode: 'None', Mid: aaa ? 100 : 50 },
    Uic,
  };
}

function chart(uic: number) {
  const start = uic === 11 ? 80 : 52;
  const step = uic === 11 ? 0.25 : -0.02;
  return {
    Data: Array.from({ length: 90 }, (_, index) => {
      const close = start + index * step;
      return {
        CloseMid: close,
        HighMid: close + 1,
        LowMid: close - 1,
      };
    }),
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
