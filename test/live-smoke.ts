import { SaxoClient } from '../src/saxo/client.js';
import { searchInstruments } from '../src/saxo/reference.js';
import { getSessionMe } from '../src/saxo/session.js';
import { getInfoPrice } from '../src/saxo/prices.js';

async function main(): Promise<void> {
  const accessToken = process.env.SAXO_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Set SAXO_ACCESS_TOKEN (24-hour SIM token) before running the smoke test.');
  }

  const environment = (process.env.SAXO_ENVIRONMENT ?? 'sim') as 'sim' | 'live';
  if (environment === 'live') {
    throw new Error('Refusing to run live smoke test on LIVE. Use SAXO_ENVIRONMENT=sim.');
  }

  const client = new SaxoClient({ environment, accessToken });

  console.error('-> saxo_session_me');
  const session = (await getSessionMe(client)) as { ClientKey?: string };
  console.error(`   ClientKey=${session.ClientKey ?? 'unknown'}`);

  console.error('-> saxo_search_instruments (keywords=AAPL, assetTypes=[Stock])');
  const search = (await searchInstruments(client, {
    keywords: 'AAPL',
    assetTypes: ['Stock'],
    top: 5,
  })) as { Data?: Array<{ Identifier: number; AssetType: string; Description: string }> };
  const first = search.Data?.[0];
  if (!first) {
    throw new Error('No instruments returned for AAPL.');
  }
  console.error(`   Uic=${first.Identifier} AssetType=${first.AssetType} (${first.Description})`);

  console.error('-> saxo_get_infoprice (the first match)');
  const infoprice = await getInfoPrice(client, {
    uic: first.Identifier,
    assetType: first.AssetType,
  });
  console.error('   ok:', JSON.stringify(infoprice).slice(0, 160));

  console.error('\nSmoke test passed.');
}

main().catch(error => {
  console.error('Smoke test failed:', error);
  process.exit(1);
});
