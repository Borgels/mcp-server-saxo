import type { SaxoClient } from './client.js';

export type MarketScreenPreset =
  | 'top_gainers'
  | 'top_losers'
  | 'premarket_gainers'
  | 'premarket_losers';

export type MarketScreenMarket =
  | 'us'
  | 'us_nasdaq'
  | 'us_nyse'
  | 'denmark'
  | 'sweden'
  | 'norway'
  | 'finland'
  | 'nordics'
  | 'europe';

export interface ScreenMarketInput {
  preset: MarketScreenPreset;
  market?: MarketScreenMarket;
  exchangeIds?: string[];
  assetType?: string;
  limit?: number;
  maxInstruments?: number;
  accountKey?: string;
  includeNonTradable?: boolean;
}

interface Feed<T> {
  Data?: T[];
}

interface InstrumentSummary {
  AssetType?: string;
  CurrencyCode?: string;
  Description?: string;
  ExchangeId?: string;
  Identifier?: number;
  Symbol?: string;
}

interface InfoPriceResponse {
  AssetType?: string;
  DisplayAndFormat?: {
    Description?: string;
    Symbol?: string;
  };
  ErrorCode?: string;
  ErrorMessage?: string;
  HistoricalChanges?: {
    PercentChangeDaily?: number;
  };
  InstrumentPriceDetails?: {
    IsMarketOpen?: boolean;
  };
  LastUpdated?: string;
  PriceInfo?: {
    NetChange?: number;
    PercentChange?: number;
  };
  PriceInfoDetails?: {
    LastClose?: number;
    LastTraded?: number;
    Open?: number;
    Volume?: number;
  };
  PriceSource?: string;
  Quote?: {
    Ask?: number;
    Bid?: number;
    DelayedByMinutes?: number;
    ErrorCode?: string;
    Mid?: number;
  };
  Uic?: number;
}

interface InstrumentDetails {
  AssetType?: string;
  IsExtendedTradingHoursEnabled?: boolean;
  Symbol?: string;
  TradingSessions?: {
    Sessions?: Array<{
      EndTime?: string;
      StartTime?: string;
      State?: string;
    }>;
  };
  Uic?: number;
}

interface Candidate {
  assetType: string;
  currencyCode?: string;
  description?: string;
  exchangeId?: string;
  symbol?: string;
  uic: number;
}

export interface MarketScreenResult {
  preset: MarketScreenPreset;
  market: MarketScreenMarket;
  exchangeIds: string[];
  assetType: string;
  generatedAt: string;
  dataSource: string;
  warnings: string[];
  Data: Array<{
    rank: number;
    uic: number;
    assetType: string;
    symbol?: string;
    description?: string;
    exchangeId?: string;
    currencyCode?: string;
    priceSource?: string;
    bid?: number;
    ask?: number;
    mid?: number;
    lastClose?: number;
    lastTraded?: number;
    open?: number;
    volume?: number;
    netChange?: number;
    percentChange: number;
    delayedByMinutes?: number;
    isMarketOpen?: boolean;
    lastUpdated?: string;
    sessionState?: string;
  }>;
}

export const MARKET_PRESET_EXCHANGES: Record<MarketScreenMarket, string[]> = {
  us: ['NASDAQ', 'NYSE'],
  us_nasdaq: ['NASDAQ'],
  us_nyse: ['NYSE'],
  denmark: ['CSE'],
  sweden: ['SSE'],
  norway: ['OSE'],
  finland: ['HSE'],
  nordics: ['CSE', 'SSE', 'OSE', 'HSE'],
  europe: ['LSE_SETS', 'PAR', 'AMS', 'BRU', 'ISE', 'LISB'],
};

const INFO_PRICE_FIELD_GROUPS = [
  'DisplayAndFormat',
  'PriceInfo',
  'PriceInfoDetails',
  'HistoricalChanges',
  'Quote',
  'InstrumentPriceDetails',
].join(',');

export async function screenMarket(
  client: SaxoClient,
  input: ScreenMarketInput,
  now: Date = new Date(),
): Promise<MarketScreenResult> {
  const preset = input.preset;
  const market = input.market ?? 'us';
  const assetType = input.assetType ?? 'Stock';
  const limit = clampInt(input.limit ?? 10, 1, 50);
  const maxInstruments = clampInt(input.maxInstruments ?? 200, 1, 500);
  const exchangeIds = resolveExchangeIds(input);
  const warnings: string[] = [];

  const candidates = await fetchCandidateInstruments(client, {
    accountKey: input.accountKey,
    assetType,
    exchangeIds,
    includeNonTradable: input.includeNonTradable ?? false,
    maxInstruments,
  });

  if (candidates.length === 0) {
    warnings.push('No instruments matched the requested market and asset type.');
  }

  let sessionStates = new Map<string, string | undefined>();
  let screenedCandidates = candidates;
  if (isPremarketPreset(preset) && candidates.length > 0) {
    sessionStates = await fetchCurrentSessionStates(client, candidates, input.accountKey, now);
    screenedCandidates = candidates.filter(candidate => sessionStates.get(candidateKey(candidate)) === 'PreMarket');
    if (screenedCandidates.length === 0) {
      warnings.push('No candidate instruments are currently in a PreMarket session.');
    }
  }

  const prices = await fetchInfoPrices(client, screenedCandidates, assetType, input.accountKey);
  const priceByUic = new Map(prices.map(price => [price.Uic, price]));
  const ranked = screenedCandidates
    .map(candidate => ({ candidate, price: priceByUic.get(candidate.uic) }))
    .map(item => toScreenRow(item.candidate, item.price, sessionStates.get(candidateKey(item.candidate))))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => sortByPreset(a.percentChange, b.percentChange, preset))
    .slice(0, limit)
    .map((row, index) => ({ rank: index + 1, ...row }));

  if (ranked.length < Math.min(limit, screenedCandidates.length)) {
    warnings.push('Some instruments were excluded because Saxo did not return a usable percent change.');
  }

  return {
    preset,
    market,
    exchangeIds,
    assetType,
    generatedAt: now.toISOString(),
    dataSource:
      'Saxo Reference Data instruments + Saxo Trading InfoPrices list. Results depend on Saxo market-data permissions and delay settings.',
    warnings,
    Data: ranked,
  };
}

function resolveExchangeIds(input: ScreenMarketInput): string[] {
  const override = input.exchangeIds
    ?.map(exchangeId => exchangeId.trim())
    .filter(Boolean);
  if (override?.length) {
    return Array.from(new Set(override));
  }

  return MARKET_PRESET_EXCHANGES[input.market ?? 'us'];
}

async function fetchCandidateInstruments(
  client: SaxoClient,
  input: {
    accountKey?: string;
    assetType: string;
    exchangeIds: string[];
    includeNonTradable: boolean;
    maxInstruments: number;
  },
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const perExchangeLimit = Math.max(1, Math.ceil(input.maxInstruments / input.exchangeIds.length));

  for (const exchangeId of input.exchangeIds) {
    let skip = 0;
    while (candidates.length < input.maxInstruments && skip < perExchangeLimit) {
      const top = Math.min(100, perExchangeLimit - skip, input.maxInstruments - candidates.length);
      const response = await client.get<Feed<InstrumentSummary>>('/ref/v1/instruments', {
        AccountKey: input.accountKey,
        AssetTypes: input.assetType,
        ExchangeId: exchangeId,
        IncludeNonTradable: input.includeNonTradable,
        $skip: skip,
        $top: top,
      });
      const page = response.Data ?? [];
      candidates.push(...page.map(toCandidate).filter((candidate): candidate is Candidate => Boolean(candidate)));
      if (page.length < top) {
        break;
      }
      skip += page.length;
    }
  }

  return dedupeCandidates(candidates).slice(0, input.maxInstruments);
}

async function fetchInfoPrices(
  client: SaxoClient,
  candidates: Candidate[],
  assetType: string,
  accountKey?: string,
): Promise<InfoPriceResponse[]> {
  const prices: InfoPriceResponse[] = [];
  for (const batch of chunk(candidates, 100)) {
    const response = await client.get<Feed<InfoPriceResponse>>('/trade/v1/infoprices/list', {
      AccountKey: accountKey,
      AssetType: assetType,
      FieldGroups: INFO_PRICE_FIELD_GROUPS,
      Uics: batch.map(candidate => candidate.uic).join(','),
    });
    prices.push(...(response.Data ?? []));
  }
  return prices;
}

async function fetchCurrentSessionStates(
  client: SaxoClient,
  candidates: Candidate[],
  accountKey: string | undefined,
  now: Date,
): Promise<Map<string, string | undefined>> {
  const states = new Map<string, string | undefined>();
  for (const batch of chunk(candidates, 100)) {
    const response = await client.get<Feed<InstrumentDetails>>('/ref/v1/instruments/details', {
      AccountKey: accountKey,
      AssetTypes: batch[0]?.assetType,
      FieldGroups: 'TradingSessions',
      Uics: batch.map(candidate => candidate.uic).join(','),
    });
    for (const details of response.Data ?? []) {
      if (typeof details.Uic !== 'number' || !details.AssetType) {
        continue;
      }
      states.set(`${details.AssetType}:${details.Uic}`, currentSessionState(details, now));
    }
  }
  return states;
}

function toCandidate(summary: InstrumentSummary): Candidate | undefined {
  if (typeof summary.Identifier !== 'number' || !summary.AssetType) {
    return undefined;
  }
  return {
    assetType: summary.AssetType,
    currencyCode: summary.CurrencyCode,
    description: summary.Description,
    exchangeId: summary.ExchangeId,
    symbol: summary.Symbol,
    uic: summary.Identifier,
  };
}

function toScreenRow(
  candidate: Candidate,
  price: InfoPriceResponse | undefined,
  sessionState: string | undefined,
): Omit<MarketScreenResult['Data'][number], 'rank'> | undefined {
  if (!price || price.ErrorCode || price.Quote?.ErrorCode && price.Quote.ErrorCode !== 'None') {
    return undefined;
  }

  const percentChange = price.PriceInfo?.PercentChange ?? price.HistoricalChanges?.PercentChangeDaily;
  if (typeof percentChange !== 'number' || Number.isNaN(percentChange)) {
    return undefined;
  }

  return {
    uic: candidate.uic,
    assetType: candidate.assetType,
    symbol: price.DisplayAndFormat?.Symbol ?? candidate.symbol,
    description: price.DisplayAndFormat?.Description ?? candidate.description,
    exchangeId: candidate.exchangeId,
    currencyCode: candidate.currencyCode,
    priceSource: price.PriceSource,
    bid: price.Quote?.Bid,
    ask: price.Quote?.Ask,
    mid: price.Quote?.Mid,
    lastClose: price.PriceInfoDetails?.LastClose,
    lastTraded: price.PriceInfoDetails?.LastTraded,
    open: price.PriceInfoDetails?.Open,
    volume: price.PriceInfoDetails?.Volume,
    netChange: price.PriceInfo?.NetChange,
    percentChange,
    delayedByMinutes: price.Quote?.DelayedByMinutes,
    isMarketOpen: price.InstrumentPriceDetails?.IsMarketOpen,
    lastUpdated: price.LastUpdated,
    sessionState,
  };
}

function currentSessionState(details: InstrumentDetails, now: Date): string | undefined {
  for (const session of details.TradingSessions?.Sessions ?? []) {
    if (!session.StartTime || !session.EndTime) {
      continue;
    }
    const start = Date.parse(session.StartTime);
    const end = Date.parse(session.EndTime);
    if (!Number.isNaN(start) && !Number.isNaN(end) && start <= now.getTime() && now.getTime() < end) {
      return session.State;
    }
  }
  return undefined;
}

function candidateKey(candidate: Candidate): string {
  return `${candidate.assetType}:${candidate.uic}`;
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function sortByPreset(a: number, b: number, preset: MarketScreenPreset): number {
  if (preset === 'top_gainers' || preset === 'premarket_gainers') {
    return b - a;
  }
  return a - b;
}

function isPremarketPreset(preset: MarketScreenPreset): boolean {
  return preset === 'premarket_gainers' || preset === 'premarket_losers';
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
