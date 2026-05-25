import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import {
  getStrategy,
  importTradingHistory,
  registerStrategy,
  tradingLedgerReport,
} from '../src/saxo/trading-ledger.js';
import { registerSaxoTools } from '../src/tools/saxo.js';

let tempDir: string | undefined;

describe('trading ledger', () => {
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('registers strategies and stores expected legs', () => {
    const dbPath = freshDbPath();

    const strategy = registerStrategy({
      dbPath,
      strategyId: 'rgti-runner',
      accountKey: 'account-1',
      name: 'RGTI runner',
      thesisName: 'RGTI can continue momentum',
      symbol: 'RGTI',
      strategy: 'long_call',
      conviction: 'high',
      legs: [
        { uic: 101, assetType: 'StockOption', buySell: 'Buy', amount: 10, expiry: '2026-09-18', putCall: 'Call', strike: 30 },
      ],
    });

    expect(strategy).toMatchObject({
      strategyId: 'rgti-runner',
      symbol: 'RGTI',
      status: 'open',
      legs: [{ uic: 101, amount: 10 }],
    });
    expect(getStrategy({ dbPath, strategyId: 'rgti-runner' })?.thesisName).toBe('RGTI can continue momentum');
  });

  it('imports strategy and account-status JSON artefacts idempotently', () => {
    const dbPath = freshDbPath();
    const strategyPath = join(tempDir!, 'live-options-actual-strategy-test.json');
    const accountPath = join(tempDir!, 'account-status-test.json');
    writeFileSync(strategyPath, JSON.stringify({
      accountKey: 'account-1',
      strategyPositions: [
        {
          name: 'AAA spread',
          symbol: 'AAA',
          strategy: 'call_debit_spread',
          openedAt: '2026-01-01T00:00:00.000Z',
          legs: [
            { uic: 201, assetType: 'StockOption', buySell: 'Buy', amount: 1 },
          ],
        },
      ],
    }));
    writeFileSync(accountPath, JSON.stringify({
      generatedAt: '2026-01-02T00:00:00.000Z',
      tradingDate: '2026-01-02',
      environment: 'sim',
      account: { accountKey: 'account-1', accountId: 'account-id', currency: 'USD' },
      balance: { totalValue: 1200, cashAvailableForTrading: 200 },
      positionSummary: { count: 0 },
      positions: [],
    }));

    const first = importTradingHistory({ dbPath, paths: [strategyPath, accountPath] });
    const second = importTradingHistory({ dbPath, paths: [strategyPath, accountPath] });
    const report = tradingLedgerReport({ dbPath });

    expect(first).toMatchObject({ scanned: 2, imported: 2, skipped: 0 });
    expect(second).toMatchObject({ scanned: 2, imported: 0, skipped: 2 });
    expect(report.strategies.total).toBe(1);
    expect(report.accountSnapshots.total).toBe(1);
  });

  it('auto-journals successful order tools without sending local ledger fields to Saxo', async () => {
    const dbPath = freshDbPath();
    const bodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ OrderId: 'order-1' });
    });
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const registered = captureRegisteredTools(client);

    const result = await registered.saxo_place_order!.handler({
      AccountKey: 'account-1',
      Uic: 211,
      AssetType: 'Stock',
      BuySell: 'Buy',
      Amount: 1,
      OrderType: 'Market',
      OrderDuration: { DurationType: 'DayOrder' },
      strategyId: 'strategy-1',
      ledgerNote: 'starter',
      dbPath,
    });
    const report = tradingLedgerReport({ dbPath });

    expect(JSON.stringify(bodies[0])).not.toContain('strategyId');
    expect(JSON.stringify(bodies[0])).not.toContain('ledgerNote');
    expect(JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text)).toMatchObject({ OrderId: 'order-1' });
    expect(report.orderEvents).toMatchObject({
      total: 1,
      recent: [expect.objectContaining({ strategyId: 'strategy-1', orderId: 'order-1', ledgerNote: 'starter' })],
    });
  });
});

function freshDbPath(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'saxo-ledger-'));
  return join(tempDir, 'ledger.sqlite');
}

function captureRegisteredTools(
  client: SaxoClient,
): Record<string, { handler: (input: Record<string, unknown>) => Promise<unknown> }> {
  const registered: Record<string, { handler: (input: Record<string, unknown>) => Promise<unknown> }> = {};
  const stub = {
    registerTool: (name: string, _config: unknown, handler: unknown) => {
      registered[name] = { handler: handler as (input: Record<string, unknown>) => Promise<unknown> };
    },
  } as unknown as Parameters<typeof registerSaxoTools>[0];
  registerSaxoTools(stub, client);
  return registered;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
}
