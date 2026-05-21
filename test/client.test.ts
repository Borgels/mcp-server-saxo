import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatUnknownError, redactSecrets, SaxoHttpError } from '../src/errors.js';
import { SaxoClient } from '../src/saxo/client.js';

const ENV_KEYS = [
  'SAXO_ENVIRONMENT',
  'SAXO_ACCESS_TOKEN',
  'SAXO_REFRESH_TOKEN',
  'SAXO_APP_KEY',
  'SAXO_APP_SECRET',
  'SAXO_TIMEOUT_MS',
  'SAXO_BASE_URL',
];
const savedEnv: Record<string, string | undefined> = {};

describe('SaxoClient', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('sends the Saxo access token as a Bearer header against the SIM gateway', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ClientKey: 'abc' }));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'sim-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.get('/root/v1/sessions/me');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://gateway.saxobank.com/sim/openapi/root/v1/sessions/me');
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer sim-token',
    });
  });

  it('switches to the LIVE gateway when environment=live', () => {
    const client = new SaxoClient({ environment: 'live', accessToken: 'live-token' });
    expect(client.isLive()).toBe(true);
    expect(client.buildUrl('/ref/v1/exchanges')).toBe(
      'https://gateway.saxobank.com/openapi/ref/v1/exchanges',
    );
  });

  it('parses successful JSON responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ Data: [{ Uic: 211 }] }));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.get('/ref/v1/instruments')).resolves.toEqual({ Data: [{ Uic: 211 }] });
  });

  it('surfaces Saxo error payloads via SaxoHttpError', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        { ErrorCode: 'InvalidRequest', Message: 'Uic is required' },
        400,
      ),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.get('/ref/v1/instruments')).rejects.toBeInstanceOf(SaxoHttpError);
    try {
      await client.get('/ref/v1/instruments');
    } catch (error) {
      expect(error).toBeInstanceOf(SaxoHttpError);
      expect((error as SaxoHttpError).status).toBe(400);
      expect((error as SaxoHttpError).message).toMatch(/InvalidRequest/);
      expect((error as SaxoHttpError).message).toMatch(/Uic is required/);
    }
  });

  it('surfaces nested Saxo ErrorInfo payloads via SaxoHttpError', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          ErrorInfo: {
            ErrorCode: 'OtherError',
            Message: 'Your option trading profile does not allow shorting options.',
          },
          Orders: [
            {
              ErrorInfo: {
                ErrorCode: 'OtherError',
                Message: 'Your option trading profile does not allow shorting options.',
              },
            },
          ],
        },
        400,
      ),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.post('/trade/v2/orders/multileg', {})).rejects.toThrow(
      /option trading profile does not allow shorting options/,
    );
  });

  it('exposes retry-after on 429', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        { ErrorCode: 'RateLimitExceeded', Message: 'Too many requests' },
        429,
        { 'retry-after': '11' },
      ),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    try {
      await client.get('/port/v1/positions/me');
    } catch (error) {
      expect(error).toBeInstanceOf(SaxoHttpError);
      expect((error as SaxoHttpError).retryAfter).toBe('11');
      expect((error as SaxoHttpError).message).toMatch(/retry-after=11s/);
    }
  });

  it('refreshes the token on 401 when refresh credentials are configured', async () => {
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (url, _init) => {
      const stringUrl = String(url);
      if (stringUrl.includes('/token')) {
        return jsonResponse({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 1200 });
      }
      call += 1;
      if (call === 1) {
        return jsonResponse({ ErrorCode: 'Unauthorized' }, 401);
      }
      return jsonResponse({ ok: true });
    });

    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      appKey: 'app-key',
      appSecret: 'app-secret',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.get<unknown>('/port/v1/orders/me');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/token$/);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer new-token',
    });
  });

  it('does not retry on 401 when refresh credentials are missing', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}, 401));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'expired',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.get('/port/v1/orders/me')).rejects.toBeInstanceOf(SaxoHttpError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('serializes JSON bodies for POST/PATCH', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ OrderId: '1' }));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.post('/trade/v2/orders', { AccountKey: 'k', Uic: 211 });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"AccountKey":"k","Uic":211}');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('places multi-leg orders against /trade/v2/orders/multileg with the documented body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ MultiLegOrderId: '88608648', Orders: [{ OrderId: '88608649' }, { OrderId: '88608650' }] }),
    );
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { placeMultiLegOrder } = await import('../src/saxo/trading.js');

    const result = await placeMultiLegOrder(client, {
      AccountKey: 'zlE1Jm-x97p5WwV7-wOGkA==',
      OrderType: 'Limit',
      OrderPrice: 1.08,
      OrderDuration: { DurationType: 'GoodTillCancel' },
      ManualOrder: true,
      ExternalReference: 'nok-bull-call-spread-1',
      Legs: [
        { Uic: 14853018, AssetType: 'StockOption', BuySell: 'Buy', Amount: 150, ToOpenClose: 'ToOpen' },
        { Uic: 14853056, AssetType: 'StockOption', BuySell: 'Sell', Amount: 150, ToOpenClose: 'ToOpen' },
      ],
    });

    expect(result).toEqual({
      MultiLegOrderId: '88608648',
      Orders: [{ OrderId: '88608649' }, { OrderId: '88608650' }],
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://gateway.saxobank.com/sim/openapi/trade/v2/orders/multileg');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      AccountKey: 'zlE1Jm-x97p5WwV7-wOGkA==',
      OrderType: 'Limit',
      OrderPrice: 1.08,
      OrderDuration: { DurationType: 'GoodTillCancel' },
      ManualOrder: true,
      ExternalReference: 'nok-bull-call-spread-1',
    });
    expect((body.Legs as unknown[]).length).toBe(2);
    expect((body.Legs as unknown[])[0]).toEqual({
      Uic: 14853018,
      AssetType: 'StockOption',
      BuySell: 'Buy',
      Amount: 150,
      ToOpenClose: 'ToOpen',
    });
  });

  it('cancels multi-leg orders via DELETE with AccountKey query', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { cancelMultiLegOrder } = await import('../src/saxo/trading.js');

    await cancelMultiLegOrder(client, {
      multiLegOrderId: '88608648',
      accountKey: 'AK',
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('https://gateway.saxobank.com/sim/openapi/trade/v2/orders/multileg/88608648?AccountKey=AK');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('creates price alerts against /vas/v1/pricealerts/definitions', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ AlertDefinitionId: '30834' }, 201));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { createPriceAlert } = await import('../src/saxo/price-alerts.js');

    await createPriceAlert(client, {
      AccountId: '13457INET',
      AssetType: 'FxSpot',
      Comment: 'EURUSD breakout',
      ExpiryDate: '2026-09-30T12:00:00Z',
      IsExtendedHours: false,
      IsRecurring: true,
      Operator: 'GreaterOrEqual',
      PriceVariable: 'AskTick',
      State: 'Enabled',
      TargetValue: 1.34595,
      Uic: 21,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://gateway.saxobank.com/sim/openapi/vas/v1/pricealerts/definitions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      AccountId: '13457INET',
      AssetType: 'FxSpot',
      Operator: 'GreaterOrEqual',
      PriceVariable: 'AskTick',
      TargetValue: 1.34595,
      Uic: 21,
    });
  });

  it('lists and deletes price alerts with Saxo query and route shape', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { deletePriceAlerts, listPriceAlerts } = await import('../src/saxo/price-alerts.js');

    await listPriceAlerts(client, { inlinecount: 'AllPages', skip: 1, top: 10, state: 'Enabled' });
    await deletePriceAlerts(client, { alertDefinitionIds: [30834, '30835'] });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://gateway.saxobank.com/sim/openapi/vas/v1/pricealerts/definitions?%24inlinecount=AllPages&%24skip=1&%24top=10&State=Enabled',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://gateway.saxobank.com/sim/openapi/vas/v1/pricealerts/definitions/30834,30835',
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
  });

  it('updates price alerts by fetching existing definition and PUTing a merged body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === 'GET') {
        return jsonResponse({
          AccountId: '13457INET',
          AssetType: 'FxSpot',
          ExpiryDate: '2026-09-30T12:00:00Z',
          IsRecurring: true,
          Operator: 'GreaterOrEqual',
          PriceVariable: 'AskTick',
          State: 'Enabled',
          TargetValue: 1.34595,
          Uic: 21,
        });
      }
      return jsonResponse({});
    });
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { updatePriceAlert } = await import('../src/saxo/price-alerts.js');

    await updatePriceAlert(client, { AlertDefinitionId: '30834', State: 'Disabled' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://gateway.saxobank.com/sim/openapi/vas/v1/pricealerts/definitions/30834',
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      AccountId: '13457INET',
      AssetType: 'FxSpot',
      Operator: 'GreaterOrEqual',
      PriceVariable: 'AskTick',
      State: 'Disabled',
      TargetValue: 1.34595,
      Uic: 21,
    });
  });

  it('updates price alert user settings by merging current settings before PUT', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'GET') {
        return jsonResponse({
          EmailAddress: 'john.doe@broker.com',
          EmailAddressValidated: true,
          NotifyWithMail: false,
          NotifyWithPopup: true,
          Sound: 'None',
        });
      }
      return jsonResponse({});
    });
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const { updatePriceAlertUserSettings } = await import('../src/saxo/price-alerts.js');

    await updatePriceAlertUserSettings(client, { NotifyWithMail: true });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://gateway.saxobank.com/sim/openapi/vas/v1/pricealerts/usersettings',
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      EmailAddress: 'john.doe@broker.com',
      NotifyWithMail: true,
      NotifyWithPopup: true,
      Sound: 'None',
    });
  });

  it('redacts tokens and secrets from error formatting', () => {
    expect(redactSecrets('Authorization: Bearer abc123def')).toMatch(/Authorization: \[REDACTED\]/);
    expect(redactSecrets('access_token=verysecret')).toMatch(/access_token=\[REDACTED\]/);
    expect(formatUnknownError(new Error('SAXO_APP_SECRET=hunter2'))).toMatch(/SAXO_APP_SECRET=\[REDACTED\]/);
  });

  it('fails clearly when SAXO_ACCESS_TOKEN is missing', async () => {
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: '',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    await expect(client.get('/root/v1/sessions/me')).rejects.toThrow(/SAXO_ACCESS_TOKEN/);
  });

  it('refuses non-https custom base URLs', () => {
    expect(
      () =>
        new SaxoClient({
          environment: 'sim',
          accessToken: 'token',
          baseUrl: 'http://gateway.saxobank.com/sim/openapi',
        }),
    ).toThrow(/https/);
  });

  it('allows http:// loopback for local mocks', () => {
    expect(
      () =>
        new SaxoClient({
          environment: 'sim',
          accessToken: 'token',
          baseUrl: 'http://127.0.0.1:9999',
        }),
    ).not.toThrow();
  });

  it('uses SAXO_TIMEOUT_MS when no timeout is passed', async () => {
    process.env.SAXO_TIMEOUT_MS = '1234';
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new SaxoClient({
      environment: 'sim',
      accessToken: 'token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.get('/root/v1/sessions/me');
    expect(timeoutSpy).toHaveBeenCalledWith(1234);
    timeoutSpy.mockRestore();
  });
});

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}
