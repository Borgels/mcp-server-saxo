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
  optionSpaceSegment?: 'AllStrikes' | 'DefaultStrikes' | 'SpecificStrikes';
  strikeCount?: number;
  clientKey?: string;
  accountKey?: string;
  trading?: 'AllTrading' | 'OnlyTradable';
}

export function getOptionChain(
  client: SaxoClient,
  input: GetOptionChainInput,
): Promise<unknown> {
  return client.get(
    `/ref/v1/instruments/contractoptionspaces/${encodeURIComponent(input.optionRootId)}`,
    {
      ExpiryDates: input.expiryDates?.join(','),
      OptionSpaceSegment: input.optionSpaceSegment,
      StrikeCount: input.strikeCount,
      ClientKey: input.clientKey,
      AccountKey: input.accountKey,
      Trading: input.trading,
    },
  );
}
