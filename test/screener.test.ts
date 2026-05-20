import { describe, expect, it, vi } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import { screenMarket } from '../src/saxo/screener.js';

describe('screenMarket', () => {
  it('ranks top gainers by Saxo percent change and lets exchangeIds override market presets', async () => {
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/ref/v1/instruments')) {
        return jsonResponse({
          Data: [
            instrument(1, 'AAA:xfoo', 'AAA Inc.', 'FOO'),
            instrument(2, 'BBB:xfoo', 'BBB Inc.', 'FOO'),
            instrument(3, 'CCC:xfoo', 'CCC Inc.', 'FOO'),
          ],
        });
      }
      if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
        return jsonResponse({
          Data: [
            price(1, 'AAA:xfoo', 1.25),
            price(2, 'BBB:xfoo', 5.5),
            price(3, 'CCC:xfoo', -2),
          ],
        });
      }
      return jsonResponse({});
    });
    const client = testClient(fetchMock);

    const result = await screenMarket(client, {
      preset: 'top_gainers',
      market: 'denmark',
      exchangeIds: ['FOO'],
      limit: 2,
      maxInstruments: 3,
    });

    expect(result.exchangeIds).toEqual(['FOO']);
    expect(result.Data.map(row => row.symbol)).toEqual(['BBB:xfoo', 'AAA:xfoo']);
    const firstInstrumentCall = fetchMock.mock.calls.find(call =>
      String(call[0]).includes('/ref/v1/instruments'),
    );
    expect(new URL(String(firstInstrumentCall?.[0])).searchParams.get('ExchangeId')).toBe('FOO');
  });

  it('ranks top losers ascending across market presets and deduplicates instruments', async () => {
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/ref/v1/instruments')) {
        const exchangeId = parsed.searchParams.get('ExchangeId');
        return jsonResponse({
          Data:
            exchangeId === 'NASDAQ'
              ? [instrument(1, 'AAA:xnas', 'AAA Inc.', 'NASDAQ'), instrument(2, 'BBB:xnas', 'BBB Inc.', 'NASDAQ')]
              : [instrument(2, 'BBB:xnys', 'BBB Inc.', 'NYSE'), instrument(3, 'CCC:xnys', 'CCC Inc.', 'NYSE')],
        });
      }
      if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
        return jsonResponse({
          Data: [price(1, 'AAA:xnas', 3), price(2, 'BBB:xnas', -4), price(3, 'CCC:xnys', 0)],
        });
      }
      return jsonResponse({});
    });
    const client = testClient(fetchMock);

    const result = await screenMarket(client, {
      preset: 'top_losers',
      market: 'us',
      limit: 3,
      maxInstruments: 4,
    });

    expect(result.exchangeIds).toEqual(['NASDAQ', 'NYSE']);
    expect(result.Data.map(row => row.uic)).toEqual([2, 3, 1]);
  });

  it('excludes rows without usable percent change and reports a warning', async () => {
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/ref/v1/instruments')) {
        return jsonResponse({
          Data: [instrument(1, 'AAA:xfoo', 'AAA Inc.', 'FOO'), instrument(2, 'BBB:xfoo', 'BBB Inc.', 'FOO')],
        });
      }
      if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
        return jsonResponse({
          Data: [
            { AssetType: 'Stock', DisplayAndFormat: { Symbol: 'AAA:xfoo' }, Uic: 1 },
            price(2, 'BBB:xfoo', 2),
          ],
        });
      }
      return jsonResponse({});
    });
    const client = testClient(fetchMock);

    const result = await screenMarket(client, {
      preset: 'top_gainers',
      exchangeIds: ['FOO'],
      limit: 2,
      maxInstruments: 2,
    });

    expect(result.Data.map(row => row.uic)).toEqual([2]);
    expect(result.warnings).toContain('Some instruments were excluded because Saxo did not return a usable percent change.');
  });

  it('batches InfoPrice requests at 100 instruments', async () => {
    const candidates = Array.from({ length: 101 }, (_, index) =>
      instrument(index + 1, `SYM${index + 1}:xfoo`, `Company ${index + 1}`, 'FOO'),
    );
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/ref/v1/instruments')) {
        const skip = Number(parsed.searchParams.get('$skip') ?? 0);
        const top = Number(parsed.searchParams.get('$top') ?? 100);
        return jsonResponse({ Data: candidates.slice(skip, skip + top) });
      }
      if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
        const uics = (parsed.searchParams.get('Uics') ?? '').split(',').map(Number);
        return jsonResponse({ Data: uics.map(uic => price(uic, `SYM${uic}:xfoo`, uic)) });
      }
      return jsonResponse({});
    });
    const client = testClient(fetchMock);

    await screenMarket(client, {
      preset: 'top_gainers',
      exchangeIds: ['FOO'],
      limit: 5,
      maxInstruments: 101,
    });

    const priceCalls = fetchMock.mock.calls.filter(call =>
      String(call[0]).includes('/trade/v1/infoprices/list'),
    );
    expect(priceCalls).toHaveLength(2);
    expect(new URL(String(priceCalls[0]?.[0])).searchParams.get('Uics')?.split(',')).toHaveLength(100);
    expect(new URL(String(priceCalls[1]?.[0])).searchParams.get('Uics')?.split(',')).toHaveLength(1);
  });

  it('filters pre-market presets to instruments currently in a PreMarket session', async () => {
    const now = new Date('2026-05-20T12:00:00.000Z');
    const fetchMock = vi.fn<typeof fetch>(async url => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/ref/v1/instruments')) {
        return jsonResponse({
          Data: [instrument(1, 'AAA:xfoo', 'AAA Inc.', 'FOO'), instrument(2, 'BBB:xfoo', 'BBB Inc.', 'FOO')],
        });
      }
      if (parsed.pathname.endsWith('/ref/v1/instruments/details')) {
        return jsonResponse({
          Data: [
            details(1, 'PreMarket'),
            details(2, 'AutomatedTrading'),
          ],
        });
      }
      if (parsed.pathname.endsWith('/trade/v1/infoprices/list')) {
        return jsonResponse({ Data: [price(1, 'AAA:xfoo', 8)] });
      }
      return jsonResponse({});
    });
    const client = testClient(fetchMock);

    const result = await screenMarket(
      client,
      {
        preset: 'premarket_gainers',
        exchangeIds: ['FOO'],
        limit: 5,
        maxInstruments: 2,
      },
      now,
    );

    expect(result.Data).toMatchObject([{ uic: 1, sessionState: 'PreMarket' }]);
    const priceCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/trade/v1/infoprices/list'));
    expect(new URL(String(priceCall?.[0])).searchParams.get('Uics')).toBe('1');
  });
});

function testClient(fetchMock: typeof fetch): SaxoClient {
  return new SaxoClient({
    environment: 'sim',
    accessToken: 'token',
    fetchImpl: fetchMock,
  });
}

function instrument(
  Identifier: number,
  Symbol: string,
  Description: string,
  ExchangeId: string,
) {
  return {
    AssetType: 'Stock',
    CurrencyCode: 'USD',
    Description,
    ExchangeId,
    Identifier,
    Symbol,
  };
}

function price(Uic: number, Symbol: string, PercentChange: number) {
  return {
    AssetType: 'Stock',
    DisplayAndFormat: { Description: Symbol, Symbol },
    HistoricalChanges: { PercentChangeDaily: PercentChange },
    InstrumentPriceDetails: { IsMarketOpen: true },
    LastUpdated: '2026-05-20T12:00:00.000Z',
    PriceInfo: { NetChange: PercentChange / 10, PercentChange },
    PriceInfoDetails: { LastClose: 100, LastTraded: 100 + PercentChange, Open: 100, Volume: 1000 },
    PriceSource: 'TEST',
    Quote: { Ask: 101, Bid: 100, DelayedByMinutes: 15, ErrorCode: 'None', Mid: 100.5 },
    Uic,
  };
}

function details(Uic: number, State: string) {
  return {
    AssetType: 'Stock',
    TradingSessions: {
      Sessions: [
        {
          EndTime: '2026-05-20T13:00:00.000Z',
          StartTime: '2026-05-20T11:00:00.000Z',
          State,
        },
      ],
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
