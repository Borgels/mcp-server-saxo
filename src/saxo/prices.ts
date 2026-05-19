import type { SaxoClient } from './client.js';

export interface InfoPriceInput {
  uic: number;
  assetType: string;
  accountKey?: string;
  amount?: number;
  fieldGroups?: string[];
}

export function getInfoPrice(client: SaxoClient, input: InfoPriceInput): Promise<unknown> {
  return client.get('/trade/v1/infoprices', {
    Uic: input.uic,
    AssetType: input.assetType,
    AccountKey: input.accountKey,
    Amount: input.amount,
    FieldGroups: input.fieldGroups?.join(','),
  });
}

export interface InfoPriceListInput {
  uics: number[];
  assetType: string;
  accountKey?: string;
  fieldGroups?: string[];
}

export function getInfoPricesList(client: SaxoClient, input: InfoPriceListInput): Promise<unknown> {
  return client.get('/trade/v1/infoprices/list', {
    Uics: input.uics.join(','),
    AssetType: input.assetType,
    AccountKey: input.accountKey,
    FieldGroups: input.fieldGroups?.join(','),
  });
}

export interface GetChartInput {
  uic: number;
  assetType: string;
  horizon: number;
  count?: number;
  mode?: 'From' | 'UpTo';
  time?: string;
  fieldGroups?: string[];
}

export function getChart(client: SaxoClient, input: GetChartInput): Promise<unknown> {
  return client.get('/chart/v3/charts', {
    Uic: input.uic,
    AssetType: input.assetType,
    Horizon: input.horizon,
    Count: input.count,
    Mode: input.mode,
    Time: input.time,
    FieldGroups: input.fieldGroups?.join(','),
  });
}
