import { SaxoClient } from '../src/saxo/client.js';
import { searchInstruments } from '../src/saxo/reference.js';
import { getDiagnostics, getSessionMe } from '../src/saxo/session.js';
import { getInfoPrice, getMarketDepth } from '../src/saxo/prices.js';
import { streamPrices } from '../src/saxo/streaming.js';

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
  const session = await getSessionMe(client);
  console.error(
    `   Name=${session.Name ?? 'unknown'} ClientKey=${session.ClientKey ?? 'unknown'} ` +
      `MarketDataTerms=${session.MarketDataViaOpenApiTermsAccepted ?? 'unknown'}`,
  );

  console.error('-> saxo_diagnostics');
  const diag = await getDiagnostics(client);
  console.error(
    `   environment=${diag.environment} dataLevel=${diag.capabilities.dataLevel} ` +
      `tokenExpiresInSeconds=${diag.token.expiresInSeconds ?? 'unknown'} warnings=${diag.warnings.length}`,
  );
  for (const w of diag.warnings) {
    console.error(`   ! ${w}`);
  }

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
    fieldGroups: ['Quote'],
  });
  if (infoprice._warning) {
    console.error(`   note: ${infoprice._warning}`);
  }
  console.error('   ok:', JSON.stringify(infoprice.Quote).slice(0, 160));

  console.error('-> saxo_get_market_depth (confirm MarketDepth field shape)');
  const depth = await getMarketDepth(client, {
    uic: first.Identifier,
    assetType: first.AssetType,
  });
  if (depth._warning) {
    console.error(`   note: ${depth._warning}`);
  }
  console.error('   MarketDepth keys:', Object.keys(depth.MarketDepth ?? {}).join(', ') || '(none)');
  console.error('   ok:', JSON.stringify(depth.MarketDepth).slice(0, 200));

  console.error('-> saxo_stream_prices (maxSeconds=5)');
  const stream = await streamPrices(client, {
    uic: first.Identifier,
    assetType: first.AssetType,
    maxSeconds: 5,
  });
  if (stream._warning) {
    console.error(`   note: ${stream._warning}`);
  }
  console.error(
    `   ticks=${stream.ticks.length} durationMs=${stream.durationMs} ` +
      `control=[${stream.controlMessages.join(',')}]`,
  );
  console.error('   finalQuote:', JSON.stringify(stream.finalQuote).slice(0, 160));

  console.error('\nSmoke test passed.');
}

main().catch(error => {
  console.error('Smoke test failed:', error);
  process.exit(1);
});
