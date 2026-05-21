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
    expect(result.reviews[0]?.triggeredRules.join(' ')).toContain('Profit target reached');
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
});

function followUpFetchMock(): typeof fetch {
  return async (url): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/port/v1/users/me')) {
      return jsonResponse({ ClientKey: 'client-1' });
    }
    if (parsed.pathname.endsWith('/port/v1/positions')) {
      return jsonResponse({
        Data: [
          { PositionBase: { Uic: 101, Amount: 1, BuySell: 'Buy' }, PositionView: { UnderlyingCurrentPrice: 102 } },
          { PositionBase: { Uic: 102, Amount: 1, BuySell: 'Sell' }, PositionView: { UnderlyingCurrentPrice: 102 } },
          { PositionBase: { Uic: 201, Amount: 10, BuySell: 'Buy' } },
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
    if (parsed.pathname.endsWith('/port/v1/orders')) {
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
    throw new Error(`Unexpected request ${parsed.pathname}`);
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
}
