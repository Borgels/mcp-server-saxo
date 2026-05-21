import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import { reviewStrategyPositions } from '../src/saxo/position-strategy-review.js';

describe('reviewStrategyPositions', () => {
  it('reviews stock positions without option-only Greeks or DTE assumptions', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(
      client,
      {
        accountKey: 'account-1',
        defaultRules: {
          profitTakePercentOfCost: 15,
          lossExitPercentOfCost: 10,
        },
        strategyPositions: [
          {
            name: 'AAA core stock',
            thesisName: 'AAA operating momentum',
            symbol: 'AAA',
            strategy: 'stock_core',
            entryPrice: 100,
            legs: [
              { uic: 201, assetType: 'Stock', buySell: 'Buy', amount: 10 },
            ],
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.reviews[0]).toMatchObject({
      name: 'AAA core stock',
      instrumentType: 'stock',
      verdict: 'consider_trim',
      entryValue: 1000,
      currentValue: 1200,
      unrealizedPnL: 200,
      unrealizedPnLPercentOfMaxRisk: 20,
      netGreeks: undefined,
      daysToEarliestExpiry: undefined,
      warnings: [],
    });
    expect(result.portfolioStatus).toMatchObject({
      cashAvailableForTrading: 5000,
      workingOrdersCount: 1,
      strategiesReviewed: 1,
      considerTrimCount: 1,
      totalCurrentValue: 1200,
      totalUnrealizedPnL: 200,
    });
    expect(result.reviews[0]?.legs[0]).toMatchObject({
      assetType: 'Stock',
      closeMid: 120,
      closeValue: 1200,
    });
    expect(result.reviews[0]?.triggeredRules.join(' ')).toContain('entry cost');
  });

  it('matches executed legs and triggers deterministic follow-up rules', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(
      client,
      {
        accountKey: 'account-1',
        defaultRules: {
          profitTakePercentOfMaxProfit: 50,
          lossExitPercentOfMaxRisk: 50,
          rollWhenDaysToExpiryBelow: 21,
          closeWhenDaysToExpiryBelow: 7,
          maxThetaDailyPercentOfRisk: 1,
        },
        strategyPositions: [
          {
            name: 'AAA call debit spread',
            thesisName: 'AAA momentum',
            symbol: 'AAA',
            strategy: 'debit_spread',
            entryNetDebit: 2,
            entryMaxRisk: 200,
            entryMaxProfit: 300,
            legs: [
              { uic: 101, buySell: 'Buy', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 100 },
              { uic: 102, buySell: 'Sell', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 105 },
            ],
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.accountPositions).toMatchObject({
      positionsFetched: 3,
      matchedLegs: 2,
      unmatchedLegs: 0,
    });
    expect(result.portfolioStatus).toMatchObject({
      strategiesReviewed: 1,
      considerTrimCount: 1,
      totalMaxRisk: 200,
      totalMaxProfit: 300,
      totalCurrentValue: 400,
      totalUnrealizedPnL: 200,
      totalUnrealizedPnLPercentOfMaxRisk: 100,
      totalDelta: 35,
    });
    expect(result.reviews[0]).toMatchObject({
      name: 'AAA call debit spread',
      verdict: 'consider_trim',
      openLegsMatched: 2,
      currentUnderlyingPrice: 102,
      currentValue: 400,
      unrealizedPnL: 200,
      unrealizedPnLPercentOfMaxRisk: 100,
      unrealizedPnLPercentOfMaxProfit: 66.67,
      netGreeks: expect.objectContaining({
        delta: expect.any(Number),
        theta: expect.any(Number),
        thetaDailyPercentOfRisk: expect.any(Number),
      }),
    });
    expect(result.reviews[0]?.triggeredRules.join(' ')).toContain('Profit target trim');
  });

  it('uses underlying prices for option thesis invalidation and reports EV when supplied', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(
      client,
      {
        accountKey: 'account-1',
        strategyPositions: [
          {
            name: 'AAA call debit spread',
            symbol: 'AAA',
            strategy: 'debit_spread',
            entryNetDebit: 2,
            entryMaxRisk: 200,
            entryMaxProfit: 300,
            probabilityOfProfit: 60,
            rules: {
              thesisInvalidBelow: 103,
            },
            legs: [
              { uic: 101, buySell: 'Buy', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 100 },
              { uic: 102, buySell: 'Sell', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 105 },
            ],
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.reviews[0]).toMatchObject({
      verdict: 'review',
      currentUnderlyingPrice: 102,
      expectedValue: expect.objectContaining({
        probabilityOfProfit: 60,
        estimatedExpectedValue: 100,
      }),
    });
    expect(result.reviews[0]?.triggeredRules.join(' ')).toContain('Thesis invalidation');
  });

  it('applies playbook-aware soft stops and time stops for option follow-up', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(
      client,
      {
        accountKey: 'account-1',
        strategyPositions: [
          {
            name: 'AAA soft stop spread',
            symbol: 'AAA',
            strategy: 'debit_spread',
            entryNetDebit: 2,
            entryMaxRisk: 200,
            entryMaxProfit: 300,
            playbook: 'aggressive_short_term',
            openedDte: 30,
            rules: {
              softStopSpot: 103,
            },
            legs: [
              { uic: 101, buySell: 'Buy', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 100 },
              { uic: 102, buySell: 'Sell', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 105 },
            ],
          },
          {
            name: 'AAA time stop spread',
            symbol: 'AAA',
            strategy: 'debit_spread',
            entryNetDebit: 5,
            entryMaxRisk: 500,
            entryMaxProfit: 500,
            rules: {
              timeStopDte: 20,
            },
            legs: [
              { uic: 101, buySell: 'Buy', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 100 },
              { uic: 102, buySell: 'Sell', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 105 },
            ],
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.reviews[0]).toMatchObject({
      verdict: 'consider_close',
      riskAnalytics: expect.objectContaining({
        playbook: 'aggressive_short_term',
      }),
    });
    expect(result.reviews[0]?.triggeredRules.join(' ')).toContain('Soft stop reached');
    expect(result.reviews[1]).toMatchObject({
      verdict: 'consider_close',
    });
    expect(result.reviews[1]?.triggeredRules.join(' ')).toContain('Time stop reached');
  });

  it('uses adjusted long-dated profit targets before trimming winners', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(
      client,
      {
        accountKey: 'account-1',
        strategyPositions: [
          {
            name: 'AAA LEAPS-style spread',
            symbol: 'AAA',
            strategy: 'debit_spread',
            entryNetDebit: 2,
            entryMaxRisk: 200,
            entryMaxProfit: 300,
            playbook: 'leaps_replacement',
            openedDte: 239,
            legs: [
              { uic: 101, buySell: 'Buy', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 100 },
              { uic: 102, buySell: 'Sell', amount: 1, expiry: '2026-01-17', putCall: 'Call', strike: 105 },
            ],
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.reviews[0]?.verdict).not.toBe('consider_trim');
    expect(result.reviews[0]?.triggeredRules.join(' ')).not.toContain('Profit target reached');
  });

  it('returns DTE-aware trim sizing, stop raise, and a close order draft', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(
      client,
      {
        accountKey: 'account-1',
        reviewDepth: 'standard',
        strategyPositions: [
          {
            name: 'AAA scaled winner',
            symbol: 'AAA',
            strategy: 'debit_spread',
            entryCost: 600,
            entryMaxRisk: 600,
            entryMaxProfit: 900,
            openedDte: 30,
            playbook: 'aggressive_short_term',
            rules: {
              profitTakePercentOfMaxProfit: 50,
            },
            legs: [
              { uic: 101, buySell: 'Buy', amount: 3, expiry: '2026-01-17', putCall: 'Call', strike: 100 },
              { uic: 102, buySell: 'Sell', amount: 3, expiry: '2026-01-17', putCall: 'Call', strike: 105 },
            ],
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.reviews[0]).toMatchObject({
      verdict: 'consider_trim',
      dteFractionElapsed: 0.4667,
      dteFractionElapsedPercent: 46.67,
      profitVelocity: expect.any(Number),
      suggestedTrim: {
        fractionToClose: 0.5,
        percentToClose: 50,
        label: 'close_half',
      },
      suggestedStopRaiseLevel: 900,
      suggestedTrimOrderDraft: {
        AccountKey: 'account-1',
        OrderPrice: 4,
        OrderType: 'Limit',
        Legs: [
          { Uic: 101, BuySell: 'Sell', Amount: 2, ToOpenClose: 'ToClose' },
          { Uic: 102, BuySell: 'Buy', Amount: 2, ToOpenClose: 'ToClose' },
        ],
      },
      expectedRemainingProfit: expect.objectContaining({
        notes: expect.arrayContaining([expect.any(String)]),
      }),
      regretAsymmetry: expect.objectContaining({
        flag: expect.any(Boolean),
      }),
    });
  });

  it('loads strategy positions from a saved snapshot path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'saxo-strategy-'));
    const snapshotPath = join(dir, 'strategy-snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify({
      accountKey: 'account-1',
      strategyPositions: [
        {
          name: 'AAA core stock',
          symbol: 'AAA',
          strategy: 'stock_core',
          entryPrice: 100,
          legs: [
            { uic: 201, assetType: 'Stock', buySell: 'Buy', amount: 10 },
          ],
        },
      ],
    }));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(client, { strategySnapshotPath: snapshotPath });

    expect(result.filters).toMatchObject({
      accountKey: 'account-1',
      strategiesProvided: 1,
    });
    expect(result.warnings.join(' ')).toContain('Loaded strategy snapshot');
    expect(result.reviews[0]).toMatchObject({
      symbol: 'AAA',
      currentValue: 1200,
    });
  });

  it('infers unmanaged standalone reviews from Saxo positions when no strategy snapshot is supplied', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(client, {}, new Date('2026-01-01T00:00:00.000Z'));

    expect(result.filters.strategiesProvided).toBe(3);
    expect(result.warnings.join(' ')).toContain('Inferred 3 standalone strategy review entries');
    expect(result.accountPositions).toMatchObject({
      positionsFetched: 3,
      matchedLegs: 3,
      unmatchedLegs: 0,
    });
    expect(result.reviews.map(review => review.strategy)).toEqual([
      'inferred_unmanaged_position',
      'inferred_unmanaged_position',
      'inferred_unmanaged_position',
    ]);
    expect(result.reviews[0]).toMatchObject({
      symbol: 'AAA',
      instrumentType: 'option',
      openLegsMatched: 1,
    });
  });

  it('ignores a missing env-configured strategy snapshot and falls back to inferred positions', async () => {
    const previous = process.env.SAXO_STRATEGY_SNAPSHOT_PATH;
    process.env.SAXO_STRATEGY_SNAPSHOT_PATH = join(tmpdir(), 'missing-saxo-strategy-snapshot.json');
    try {
      const client = new SaxoClient({
        environment: 'sim',
        accessToken: 'token',
        fetchImpl: followUpFetchMock(),
      });

      const result = await reviewStrategyPositions(client, {}, new Date('2026-01-01T00:00:00.000Z'));

      expect(result.filters.strategiesProvided).toBe(3);
      expect(result.warnings.join(' ')).toContain('Ignoring configured SAXO_STRATEGY_SNAPSHOT_PATH');
    } finally {
      if (previous === undefined) {
        delete process.env.SAXO_STRATEGY_SNAPSHOT_PATH;
      } else {
        process.env.SAXO_STRATEGY_SNAPSHOT_PATH = previous;
      }
    }
  });

  it('adds technical and liquidity context for stock strategy reviews', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: followUpFetchMock(),
    });

    const result = await reviewStrategyPositions(
      client,
      {
        accountKey: 'account-1',
        reviewDepth: 'standard',
        strategyPositions: [
          {
            name: 'AAA core stock',
            symbol: 'AAA',
            strategy: 'stock_core',
            entryPrice: 100,
            legs: [
              { uic: 201, assetType: 'Stock', buySell: 'Buy', amount: 10 },
            ],
          },
        ],
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result.reviews[0]?.technicalContext).toMatchObject({
      source: 'saxo_chart',
      bias: 'bullish',
      metrics: expect.objectContaining({
        sma20: expect.any(Number),
      }),
    });
    expect(result.reviews[0]?.liquidityContext).toMatchObject({
      source: 'saxo_prices',
      volume: 123456,
    });
  });
});

function followUpFetchMock(): typeof fetch {
  return async (url): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/port/v1/users/me')) {
      return jsonResponse({ ClientKey: 'client-1' });
    }
    if (parsed.pathname.endsWith('/port/v1/positions') || parsed.pathname.endsWith('/port/v1/positions/me')) {
      return jsonResponse({
        Data: [
          {
            DisplayAndFormat: { Symbol: 'AAA:xnas' },
            PositionBase: { Uic: 101, AssetType: 'StockOption', Amount: 3, BuySell: 'Buy' },
            PositionView: { UnderlyingCurrentPrice: 102 },
          },
          {
            DisplayAndFormat: { Symbol: 'AAA:xnas' },
            PositionBase: { Uic: 102, AssetType: 'StockOption', Amount: 3, BuySell: 'Sell' },
            PositionView: { UnderlyingCurrentPrice: 102 },
          },
          {
            DisplayAndFormat: { Symbol: 'AAA:xnas' },
            PositionBase: { Uic: 201, AssetType: 'Stock', Amount: 10, BuySell: 'Buy' },
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/port/v1/balances')) {
      return jsonResponse({
        CashAvailableForTrading: 5000,
        CashBalance: 6000,
        TotalValue: 7000,
        NetPositionsValue: 1000,
        MarginUtilizationPct: 0,
      });
    }
    if (parsed.pathname.endsWith('/port/v1/orders') || parsed.pathname.endsWith('/port/v1/orders/me')) {
      return jsonResponse({
        Data: [
          { OrderId: 'order-1', Status: 'Working' },
        ],
      });
    }
    if (parsed.pathname.endsWith('/trade/v1/prices/multileg')) {
      return jsonResponse({
        Legs: [
          {
            Uic: 101,
            Quote: { Bid: 5.95, Ask: 6.05, Mid: 6 },
            Greeks: { Delta: 0.7, Gamma: 0.02, Theta: -0.05, Vega: 0.2 },
          },
          {
            Uic: 102,
            Quote: { Bid: 1.95, Ask: 2.05, Mid: 2 },
            Greeks: { Delta: 0.35, Gamma: 0.01, Theta: -0.03, Vega: 0.12 },
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
      if (parsed.searchParams.get('AssetType') === 'Stock') {
        return jsonResponse({
          Data: [
            {
              Uic: 201,
              AssetType: 'Stock',
              Quote: { Bid: 119.5, Ask: 120.5, Mid: 120 },
              PriceInfoDetails: { Volume: 123456 },
            },
          ],
        });
      }
      return jsonResponse({
        Data: [
          {
            Uic: 101,
            Quote: { Bid: 5.95, Ask: 6.05, Mid: 6 },
            Greeks: { Delta: 0.7, Gamma: 0.02, Theta: -0.05, Vega: 0.2 },
          },
          {
            Uic: 102,
            Quote: { Bid: 1.95, Ask: 2.05, Mid: 2 },
            Greeks: { Delta: 0.35, Gamma: 0.01, Theta: -0.03, Vega: 0.12 },
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/chart/v3/charts')) {
      return jsonResponse({
        Data: Array.from({ length: 90 }, (_, index) => {
          const close = 80 + index * 0.5;
          return {
            Close: close,
            High: close * 1.01,
            Low: close * 0.99,
          };
        }),
      });
    }
    throw new Error(`Unexpected request ${parsed.pathname}`);
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
}
