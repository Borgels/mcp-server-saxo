import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { accountStatusReport } from '../src/saxo/account-status-report.js';
import { SaxoClient } from '../src/saxo/client.js';

let tempDir: string | undefined;

describe('accountStatusReport', () => {
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('writes a dated snapshot and summarizes account status', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'saxo-account-status-'));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: accountStatusFetchMock(),
    });

    const result = await accountStatusReport(
      client,
      { accountKey: 'account-1', outputDir: tempDir, dbPath: join(tempDir, 'ledger.sqlite') },
      new Date('2026-05-22T20:00:00.000Z'),
    );

    expect(result).toMatchObject({
      tradingDate: '2026-05-22',
      balance: {
        cashAvailableForTrading: 1000,
        totalValue: 7000,
        optionPremiumsMarketValue: 5500,
      },
      positionSummary: {
        count: 2,
        totalMarketValue: 5500,
        totalUnrealizedPnl: 1500,
      },
      orders: {
        workingCount: 1,
        allCount: 2,
      },
    });
    expect(result.positionSummary.bySymbol[0]).toMatchObject({
      key: 'AAA',
      marketValue: 5500,
      unrealizedPnl: 1500,
    });
    expect(result.positionSummary.byUnderlying[0]).toMatchObject({
      key: 'AAA',
      marketValue: 5500,
      unrealizedPnl: 1500,
    });
    expect(result.snapshotPath).toBeTruthy();
    expect(readFileSync(result.snapshotPath!, 'utf8')).toContain('"dailyHistory"');
  });

  it('compares with the previous snapshot in the output directory', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'saxo-account-status-'));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: accountStatusFetchMock(),
    });

    await accountStatusReport(
      client,
      { accountKey: 'account-1', outputDir: tempDir, dbPath: join(tempDir, 'ledger.sqlite') },
      new Date('2026-05-21T20:00:00.000Z'),
    );
    const second = await accountStatusReport(
      client,
      { accountKey: 'account-1', outputDir: tempDir, dbPath: join(tempDir, 'ledger.sqlite') },
      new Date('2026-05-22T20:00:00.000Z'),
    );

    expect(second.delta).toMatchObject({
      balance: {
        totalValue: 0,
        cashAvailableForTrading: 0,
      },
      positionSummary: {
        totalMarketValue: 0,
        totalUnrealizedPnl: 0,
      },
    });
    expect(second.dailyHistory.map(entry => entry.tradingDate)).toEqual(['2026-05-21', '2026-05-22']);
  });
});

function accountStatusFetchMock(): typeof fetch {
  return async (url): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/port/v1/users/me')) {
      return jsonResponse({ ClientKey: 'client-1', UserKey: 'user-1' });
    }
    if (parsed.pathname.endsWith('/port/v1/accounts/me')) {
      return jsonResponse({
        Data: [
          {
            AccountId: 'account-id',
            AccountKey: 'account-1',
            ClientKey: 'client-1',
            Currency: 'USD',
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/port/v1/balances')) {
      return jsonResponse({
        Currency: 'USD',
        CashAvailableForTrading: 1000,
        CashBalance: 900,
        TotalValue: 7000,
        NetPositionsValue: 5500,
        OptionPremiumsMarketValue: 5500,
        UnrealizedPositionsValue: 1500,
        MarginUtilizationPct: 0,
      });
    }
    if (parsed.pathname.endsWith('/port/v1/positions')) {
      return jsonResponse({
        Data: [
          {
            PositionId: 'p1',
            NetPositionId: 'n1',
            DisplayAndFormat: { Symbol: 'AAA:xnas', Description: 'AAA Jul 100 Call' },
            PositionBase: { Uic: 101, AssetType: 'StockOption', BuySell: 'Buy', Amount: 10 },
            PositionView: { MarketValue: 8000, ProfitLossOnTrade: 2500 },
          },
          {
            PositionId: 'p2',
            NetPositionId: 'n2',
            DisplayAndFormat: { Symbol: 'AAA:xnas', Description: 'AAA Jul 120 Call' },
            PositionBase: { Uic: 102, AssetType: 'StockOption', BuySell: 'Sell', Amount: 10 },
            PositionView: { MarketValue: -2500, ProfitLossOnTrade: -1000 },
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/port/v1/netpositions')) {
      return jsonResponse({
        Data: [
          {
            NetPositionId: 'n1',
            NetPositionBase: { Uic: 101, AssetType: 'StockOption', OpeningDirection: 'Buy', Amount: 10 },
            NetPositionView: { MarketValue: 8000, ProfitLossOnTrade: 2500 },
          },
          {
            NetPositionId: 'n2',
            NetPositionBase: { Uic: 102, AssetType: 'StockOption', OpeningDirection: 'Sell', Amount: 10 },
            NetPositionView: { MarketValue: -2500, ProfitLossOnTrade: -1000 },
          },
        ],
      });
    }
    if (parsed.pathname.endsWith('/port/v1/orders')) {
      const status = parsed.searchParams.get('Status');
      return jsonResponse({
        Data: status === 'Working'
          ? [{ OrderId: 'working-1' }]
          : [{ OrderId: 'working-1' }, { OrderId: 'filled-1' }],
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
