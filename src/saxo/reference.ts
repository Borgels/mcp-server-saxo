import type { SaxoClient } from './client.js';
import {
  CONTRACT_OPTION_ASSET_TYPES,
  isContractOptionAssetType,
  normalizeContractOptionAssetTypes,
  type ContractOptionAssetType,
} from './contract-options.js';

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

export async function getOptionChain(
  client: SaxoClient,
  input: GetOptionChainInput,
): Promise<OptionChainRawResponse> {
  const response = await client.get<OptionChainRawResponse>(
    `/ref/v1/instruments/contractoptionspaces/${encodeURIComponent(input.optionRootId)}`,
    {
      ExpiryDates: input.expiryDates?.join(','),
      StrikeCount: input.strikeCount,
      ClientKey: input.clientKey,
      AccountKey: input.accountKey,
      Trading: input.trading,
    },
  );

  // Saxo's `ExpiryDates` query param is unreliable — observed against SIM:
  // when a single expiry is passed, the response still includes every
  // expiry with full `SpecificOptions` populated. Filter client-side so
  // the caller actually gets what they asked for.
  if (input.expiryDates && input.expiryDates.length > 0 && response.OptionSpace) {
    const wanted = new Set(input.expiryDates);
    response.OptionSpace = response.OptionSpace.filter(e => wanted.has(e.Expiry));
  }

  return response;
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

  // Saxo's `/ref/v1/instruments/contractoptionspaces/{id}?ExpiryDates=...`
  // ALWAYS returns the full OptionSpace array (one entry per expiry the
  // underlying has), but only populates `SpecificOptions` for the
  // expiries the caller asked about. Without the filter, every entry is
  // populated. Either way, an entry with no SpecificOptions is just an
  // empty placeholder — drop it so a filtered query returns only what
  // the caller asked for, and an unfiltered query still returns
  // everything (since every entry is populated in that case).
  for (const expiry of raw.OptionSpace ?? []) {
    const options = expiry.SpecificOptions ?? [];
    if (options.length === 0) {
      continue;
    }
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

export interface ListStandardOptionExpiriesInput {
  /** ISO date YYYY-MM-DD; defaults to today on Saxo side if omitted. */
  fromDate?: string;
}

/**
 * Saxo `GET /ref/v1/standarddates/optionexpiry`. Returns the
 * standardized option-expiry calendar (3rd Friday monthlies,
 * quarterlies, weeklies). Different from `listOptionExpiries`, which
 * returns expiries for a specific option root.
 */
export function listStandardOptionExpiries(
  client: SaxoClient,
  input: ListStandardOptionExpiriesInput = {},
): Promise<unknown> {
  return client.get('/ref/v1/standarddates/optionexpiry', {
    FromDate: input.fromDate,
  });
}

export interface FindOptionLegInput {
  symbol: string;
  expiry: string;
  strike: number;
  putCall: 'Call' | 'Put';
  /** Disambiguate ambiguous tickers (e.g. NOK on NYSE vs Helsinki). */
  exchangeId?: string;
  /** Restrict option-root search to one contract option asset type. */
  assetType?: ContractOptionAssetType;
  /** Restrict option-root search to specific contract option asset types. Defaults to all exchange-traded contract options. */
  assetTypes?: ContractOptionAssetType[];
}

export interface FoundOptionLeg {
  uic: number;
  assetType: ContractOptionAssetType;
  symbol?: string;
  description?: string;
  optionRootId: number;
  underlyingUic?: number;
  expiry: string;
  strike: number;
  putCall: 'Call' | 'Put';
  tradingStatus?: string;
  warnings: string[];
}

/**
 * Compress the 4-step option-discovery workflow (search instrument →
 * search option root → fetch chain → locate strike) into one call.
 *
 * Returns the resolved leg Uic plus the per-strike metadata. When
 * multiple option roots match (e.g. `NOK` has both NYSE+OPRA US
 * options and Helsinki+Eurex EU options), prefers the root with
 * `CanParticipateInMultiLegOrder: true`. Surfaces ambiguity in
 * `warnings`. Throws if the requested strike isn't in the chain.
 */
export async function findOptionLeg(
  client: SaxoClient,
  input: FindOptionLegInput,
): Promise<FoundOptionLeg> {
  const warnings: string[] = [];
  const assetTypes = normalizeContractOptionAssetTypes(
    input.assetTypes ?? (input.assetType ? [input.assetType] : undefined),
    CONTRACT_OPTION_ASSET_TYPES,
  );
  const search = (await searchInstruments(client, {
    keywords: input.symbol,
    assetTypes,
    top: 20,
  })) as {
    Data?: Array<{
      Identifier: number;
      AssetType?: string;
      Description?: string;
      Symbol?: string;
      ExchangeId?: string;
      CanParticipateInMultiLegOrder?: boolean;
      CurrencyCode?: string;
    }>;
  };
  const candidates = (search.Data ?? []).filter(d => isContractOptionAssetType(d.AssetType));
  if (candidates.length === 0) {
    throw new Error(`No contract option root found for symbol "${input.symbol}" and asset types ${assetTypes.join(', ')}.`);
  }
  let filtered = candidates;
  if (input.exchangeId) {
    filtered = candidates.filter(d => d.ExchangeId === input.exchangeId);
    if (filtered.length === 0) {
      throw new Error(
        `No contract option root for "${input.symbol}" on exchange "${input.exchangeId}". ` +
          `Candidates without filter: ${candidates.map(c => `${c.Identifier}@${c.ExchangeId}`).join(', ')}`,
      );
    }
  }
  let picked = filtered.find(c => c.CanParticipateInMultiLegOrder) ?? filtered[0];
  if (filtered.length > 1) {
    warnings.push(
      `Multiple option roots matched "${input.symbol}"; picked Uic=${picked!.Identifier} (${picked!.ExchangeId}, ${picked!.CurrencyCode}). ` +
        `Others: ${filtered.filter(c => c !== picked).map(c => `${c.Identifier}@${c.ExchangeId}`).join(', ')}. Pass exchangeId to disambiguate.`,
    );
  }
  const optionRootId = picked!.Identifier;
  const assetType = picked!.AssetType as ContractOptionAssetType;

  const chainRaw = await getOptionChain(client, {
    optionRootId,
    expiryDates: [input.expiry],
  });
  const chain = normalizeOptionChain(chainRaw);
  const expiry = chain.expiries.find(e => e.expiry === input.expiry);
  if (!expiry) {
    throw new Error(
      `Expiry "${input.expiry}" not in chain for option root ${optionRootId}. ` +
        `Available: ${chain.expiries.map(e => e.expiry).join(', ') || '(none)'}`,
    );
  }
  const strikeRow = chain.strikes.find(s => s.strike === input.strike);
  if (!strikeRow) {
    const available = chain.strikes.map(s => s.strike);
    const min = Math.min(...available);
    const max = Math.max(...available);
    throw new Error(
      `Strike ${input.strike} not in chain for ${input.symbol} ${input.expiry} on option root ${optionRootId}. ` +
        `Available range: ${min}–${max} (${available.length} strikes).`,
    );
  }
  const uic = input.putCall === 'Call' ? strikeRow.callUic : strikeRow.putUic;
  const tradingStatus =
    input.putCall === 'Call' ? strikeRow.callTradingStatus : strikeRow.putTradingStatus;
  if (uic === undefined) {
    throw new Error(
      `Strike ${input.strike} ${input.putCall} not available in chain (other side may exist).`,
    );
  }

  return {
    uic,
    assetType,
    symbol: picked!.Symbol,
    description: picked!.Description,
    optionRootId,
    expiry: input.expiry,
    strike: input.strike,
    putCall: input.putCall,
    tradingStatus,
    warnings,
  };
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
