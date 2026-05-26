import { describe, expect, it, vi } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import { getMarketDepth } from '../src/saxo/prices.js';

describe('getMarketDepth', () => {
  it('requests the MarketDepth field group and passes the order book through verbatim', async () => {
    const depth = {
      Bid: [183.1, 183.0, 182.9],
      Ask: [183.2, 183.3, 183.4],
      BidSize: [100, 200, 300],
      AskSize: [150, 250, 350],
      NoOfBids: 3,
      NoOfAsks: 3,
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        Uic: 211,
        AssetType: 'Stock',
        Quote: { Bid: 183.1, Ask: 183.2, PriceTypeBid: 'Tradable', PriceTypeAsk: 'Tradable' },
        MarketDepth: depth,
      }),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'tok',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await getMarketDepth(client, { uic: 211, assetType: 'Stock' });

    expect(result.MarketDepth).toEqual(depth);
    expect(result._warning).toBeUndefined();

    const [url] = fetchMock.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/sim/openapi/trade/v1/infoprices');
    expect(parsed.searchParams.get('Uic')).toBe('211');
    expect(parsed.searchParams.get('FieldGroups')).toBe(
      'Quote,MarketDepth,PriceInfoDetails,DisplayAndFormat',
    );
  });

  it('sets a NoAccess _warning when the quote lacks live market-data access', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        Uic: 211,
        AssetType: 'Stock',
        Quote: { PriceTypeBid: 'NoAccess', PriceTypeAsk: 'NoAccess' },
      }),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'tok',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await getMarketDepth(client, { uic: 211, assetType: 'Stock' });

    expect(result._warning).toMatch(/NoAccess/);
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
