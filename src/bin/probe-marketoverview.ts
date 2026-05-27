import { SaxoHttpError } from '../errors.js';
import { SaxoClient } from '../saxo/client.js';

interface ProbeResult {
  method: 'GET';
  path: string;
  status: number | 'ok' | 'error';
  note?: string;
}

async function main(): Promise<void> {
  const client = new SaxoClient();
  const probes = [
    '/root/v1/features/availability',
    '/mkt/v1/instrumentdocument',
    '/mkt/v2/instrumentdocument',
    '/mkt/v1/gainerslosers',
    '/mkt/v1/gainersandlosers',
    '/mkt/v1/marketmovers',
    '/mkt/v1/movers',
    '/mkt/v1/gainers',
    '/mkt/v1/losers',
  ];

  const results: ProbeResult[] = [];
  for (const path of probes) {
    results.push(await probeGet(client, path));
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    environment: client.environment,
    results,
  }, null, 2));
}

async function probeGet(client: SaxoClient, path: string): Promise<ProbeResult> {
  try {
    const payload = await client.get<unknown>(path);
    return {
      method: 'GET',
      path,
      status: 'ok',
      note: summarizePayload(payload),
    };
  } catch (error) {
    if (error instanceof SaxoHttpError) {
      return {
        method: 'GET',
        path,
        status: error.status,
        note: error.message,
      };
    }
    return {
      method: 'GET',
      path,
      status: 'error',
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizePayload(payload: unknown): string {
  if (Array.isArray(payload)) {
    return `array(${payload.length})`;
  }
  if (payload && typeof payload === 'object') {
    const keys = Object.keys(payload).slice(0, 8);
    return `object keys: ${keys.join(', ')}`;
  }
  return typeof payload;
}

main().catch(error => {
  console.error('MarketOverview probe failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
