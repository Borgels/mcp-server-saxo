import type { SaxoClient } from './client.js';

export const CONTRACT_OPTION_ASSET_TYPES = [
  'StockOption',
  'IndexOption',
  'StockIndexOption',
  'FuturesOption',
] as const;

export type ContractOptionAssetType = typeof CONTRACT_OPTION_ASSET_TYPES[number];

export const DEFAULT_CONTRACT_OPTION_ASSET_TYPE: ContractOptionAssetType = 'StockOption';

export function isContractOptionAssetType(value: unknown): value is ContractOptionAssetType {
  return typeof value === 'string' &&
    (CONTRACT_OPTION_ASSET_TYPES as readonly string[]).includes(value);
}

export function normalizeContractOptionAssetType(
  value: unknown,
  fallback: ContractOptionAssetType = DEFAULT_CONTRACT_OPTION_ASSET_TYPE,
): ContractOptionAssetType {
  return isContractOptionAssetType(value) ? value : fallback;
}

export function normalizeContractOptionAssetTypes(
  values: readonly unknown[] | undefined,
  fallback: readonly ContractOptionAssetType[] = [DEFAULT_CONTRACT_OPTION_ASSET_TYPE],
): ContractOptionAssetType[] {
  const normalized = Array.from(new Set((values ?? []).filter(isContractOptionAssetType)));
  return normalized.length > 0 ? normalized : [...fallback];
}

export interface GetContractOptionTradingConditionsInput {
  accountKey: string;
  optionRootId: number;
  uic?: number;
  fieldGroups?: string[];
}

export function getContractOptionTradingConditions(
  client: SaxoClient,
  input: GetContractOptionTradingConditionsInput,
): Promise<unknown> {
  return client.get(
    `/cs/v1/tradingconditions/ContractOptionSpaces/${encodeURIComponent(input.accountKey)}/${encodeURIComponent(String(input.optionRootId))}`,
    {
      FieldGroups: input.fieldGroups?.join(','),
      Uic: input.uic,
    },
  );
}
