import { describe, expect, it } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import { reviewStrategyPositions } from '../src/saxo/position-strategy-review.js';

describe('reviewStrategyPositions', () => {
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
      positionsFetched: 2,
      matchedLegs: 2,
      unmatchedLegs: 0,
    });
    expect(result.reviews[0]).toMatchObject({
      name: 'AAA call debit spread',
      verdict: 'consider_trim',
      openLegsMatched: 2,
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
          { PositionBase: { Uic: 101, Amount: 1, BuySell: 'Buy' } },
          { PositionBase: { Uic: 102, Amount: 1, BuySell: 'Sell' } },
        ],
      });
    }
    if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
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
