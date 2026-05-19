import type { SaxoClient } from './client.js';

export interface SearchInstrumentsInput {
  keywords?: string;
  assetTypes?: string[];
  exchangeIds?: string[];
  top?: number;
  skip?: number;
  accountKey?: string;
  includeNonTradable?: boolean;
}

export function searchInstruments(client: SaxoClient, input: SearchInstrumentsInput): Promise<unknown> {
  return client.get('/ref/v1/instruments', {
    Keywords: input.keywords,
    AssetTypes: input.assetTypes?.join(','),
    ExchangeIds: input.exchangeIds?.join(','),
    $top: input.top,
    $skip: input.skip,
    AccountKey: input.accountKey,
    IncludeNonTradable: input.includeNonTradable,
  });
}

export interface GetInstrumentDetailsInput {
  uics: number[];
  assetType: string;
  accountKey?: string;
  fieldGroups?: string[];
}

export function getInstrumentDetails(
  client: SaxoClient,
  input: GetInstrumentDetailsInput,
): Promise<unknown> {
  return client.get('/ref/v1/instruments/details', {
    Uics: input.uics.join(','),
    AssetType: input.assetType,
    AccountKey: input.accountKey,
    FieldGroups: input.fieldGroups?.join(','),
  });
}

export interface ListExchangesInput {
  top?: number;
  skip?: number;
  exchangeId?: string;
}

export function listExchanges(client: SaxoClient, input: ListExchangesInput): Promise<unknown> {
  if (input.exchangeId) {
    return client.get(`/ref/v1/exchanges/${encodeURIComponent(input.exchangeId)}`);
  }

  return client.get('/ref/v1/exchanges', {
    $top: input.top,
    $skip: input.skip,
  });
}

export interface GetOptionChainInput {
  optionRootId: number;
  expiryDates?: string[];
  strikeCount?: number;
  clientKey?: string;
  accountKey?: string;
  trading?: 'AllTrading' | 'OnlyTradable';
}

export interface OptionChainRawResponse {
  Symbol?: string;
  Description?: string;
  OptionRootId?: number;
  ExchangeId?: string;
  OptionSpace?: OptionChainExpiry[];
  [key: string]: unknown;
}

export interface OptionChainExpiry {
  Expiry: string;
  DisplayExpiry?: string;
  DisplayDaysToExpiry?: number;
  LastTradeDate?: string;
  SpecificOptions?: OptionChainSpecificOption[];
}

export interface OptionChainSpecificOption {
  Uic: number;
  StrikePrice: number;
  PutCall: 'Put' | 'Call';
  TradingStatus?: string;
  UnderlyingUic?: number;
}

export function getOptionChain(
  client: SaxoClient,
  input: GetOptionChainInput,
): Promise<OptionChainRawResponse> {
  return client.get<OptionChainRawResponse>(
    `/ref/v1/instruments/contractoptionspaces/${encodeURIComponent(input.optionRootId)}`,
    {
      ExpiryDates: input.expiryDates?.join(','),
      StrikeCount: input.strikeCount,
      ClientKey: input.clientKey,
      AccountKey: input.accountKey,
      Trading: input.trading,
    },
  );
}

export interface NormalizedExpiry {
  expiry: string;
  displayExpiry?: string;
  displayDaysToExpiry?: number;
  lastTradeDate?: string;
  strikeCount: number;
}

export interface NormalizedStrike {
  expiry: string;
  strike: number;
  callUic?: number;
  putUic?: number;
  callTradingStatus?: string;
  putTradingStatus?: string;
}

export interface NormalizedOptionChain {
  optionRootId?: number;
  symbol?: string;
  description?: string;
  exchangeId?: string;
  expiries: NormalizedExpiry[];
  strikes: NormalizedStrike[];
}

export function normalizeOptionChain(raw: OptionChainRawResponse): NormalizedOptionChain {
  const expiries: NormalizedExpiry[] = [];
  const strikes: NormalizedStrike[] = [];

  for (const expiry of raw.OptionSpace ?? []) {
    const options = expiry.SpecificOptions ?? [];
    expiries.push({
      expiry: expiry.Expiry,
      displayExpiry: expiry.DisplayExpiry,
      displayDaysToExpiry: expiry.DisplayDaysToExpiry,
      lastTradeDate: expiry.LastTradeDate,
      strikeCount: countDistinctStrikes(options),
    });

    const byStrike = new Map<number, NormalizedStrike>();
    for (const opt of options) {
      const row =
        byStrike.get(opt.StrikePrice) ??
        ({ expiry: expiry.Expiry, strike: opt.StrikePrice } as NormalizedStrike);
      if (opt.PutCall === 'Call') {
        row.callUic = opt.Uic;
        row.callTradingStatus = opt.TradingStatus;
      } else if (opt.PutCall === 'Put') {
        row.putUic = opt.Uic;
        row.putTradingStatus = opt.TradingStatus;
      }
      byStrike.set(opt.StrikePrice, row);
    }
    for (const row of Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike)) {
      strikes.push(row);
    }
  }

  return {
    optionRootId: raw.OptionRootId,
    symbol: raw.Symbol,
    description: raw.Description,
    exchangeId: raw.ExchangeId,
    expiries,
    strikes,
  };
}

function countDistinctStrikes(options: OptionChainSpecificOption[]): number {
  const set = new Set<number>();
  for (const o of options) {
    set.add(o.StrikePrice);
  }
  return set.size;
}

export interface ListOptionExpiriesInput {
  optionRootId: number;
  clientKey?: string;
  accountKey?: string;
  trading?: 'AllTrading' | 'OnlyTradable';
}

export async function listOptionExpiries(
  client: SaxoClient,
  input: ListOptionExpiriesInput,
): Promise<NormalizedExpiry[]> {
  const raw = await getOptionChain(client, input);
  return normalizeOptionChain(raw).expiries;
}
