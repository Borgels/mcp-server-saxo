import type { SaxoClient } from './client.js';

export type VolatilityRegime = 'low' | 'medium' | 'high' | 'unknown';

export interface OptionVolatilityContext {
  source: 'saxo_optionschain';
  optionRootId: number;
  assetType: 'StockOption';
  impliedVolatility?: number;
  impliedVolatilityPercentile?: number;
  impliedVolatilityRank?: number;
  regime: VolatilityRegime;
  summary?: string;
  riskNotes: string[];
  skew: {
    available: boolean;
    reason?: string;
  };
}

interface GetOptionVolatilityContextInput {
  accountKey: string;
  optionRootId: number;
  maxStrikesPerExpiry?: number;
  expiries?: number[];
}

interface OptionsChainSubscriptionResponse {
  Snapshot?: {
    ImpliedVolatilityData?: ImpliedVolatilityData;
  };
}

interface ImpliedVolatilityData {
  ImpliedVolatility?: number;
  ImpliedVolatilityPercentile?: number;
  ImpliedVolatilityRank?: number;
}

export async function getOptionVolatilityContext(
  client: SaxoClient,
  input: GetOptionVolatilityContextInput,
): Promise<OptionVolatilityContext> {
  const contextId = `mcp_saxo_iv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referenceId = `root_${input.optionRootId}`;
  let created = false;

  try {
    const response = await client.post<OptionsChainSubscriptionResponse>('/trade/v1/optionschain/subscriptions', {
      Arguments: {
        AccountKey: input.accountKey,
        AssetType: 'StockOption',
        Identifier: input.optionRootId,
      },
      ContextId: contextId,
      ReferenceId: referenceId,
      RefreshRate: 5000,
      MaxStrikesPerExpiry: input.maxStrikesPerExpiry ?? 12,
      Expiries: (input.expiries ?? [0, 1]).map(index => ({ Index: index })),
    });
    created = true;

    return toVolatilityContext(input.optionRootId, response.Snapshot?.ImpliedVolatilityData);
  } finally {
    if (created) {
      try {
        await client.delete(
          `/trade/v1/optionschain/subscriptions/${encodeURIComponent(contextId)}/${encodeURIComponent(referenceId)}`,
        );
      } catch {
        // Best-effort cleanup. The subscription also has a Saxo inactivity timeout.
      }
    }
  }
}

function toVolatilityContext(
  optionRootId: number,
  data: ImpliedVolatilityData | undefined,
): OptionVolatilityContext {
  const rank = data?.ImpliedVolatilityRank;
  const percentile = data?.ImpliedVolatilityPercentile;
  const regime = classifyRegime(rank ?? percentile);
  return {
    source: 'saxo_optionschain',
    optionRootId,
    assetType: 'StockOption',
    impliedVolatility: round(data?.ImpliedVolatility),
    impliedVolatilityPercentile: round(percentile),
    impliedVolatilityRank: round(rank),
    regime,
    summary: volatilitySummary(regime, data),
    riskNotes: volatilityRiskNotes(regime),
    skew: {
      available: false,
      reason: 'Saxo OptionsChain did not return stable strike-level volatility/skew fields for this snapshot.',
    },
  };
}

function classifyRegime(value: number | undefined): VolatilityRegime {
  if (value === undefined || !Number.isFinite(value)) {
    return 'unknown';
  }
  if (value < 30) {
    return 'low';
  }
  if (value > 70) {
    return 'high';
  }
  return 'medium';
}

function volatilitySummary(
  regime: VolatilityRegime,
  data: ImpliedVolatilityData | undefined,
): string {
  if (!data) {
    return 'Saxo OptionsChain implied-volatility context was unavailable.';
  }
  return [
    `Saxo OptionsChain IV regime is ${regime}.`,
    formatMetric('IV', data.ImpliedVolatility),
    formatMetric('IV percentile', data.ImpliedVolatilityPercentile),
    formatMetric('IV rank', data.ImpliedVolatilityRank),
  ].filter(Boolean).join(' ');
}

function volatilityRiskNotes(regime: VolatilityRegime): string[] {
  if (regime === 'low') {
    return ['Low IV regime; debit spreads are favored over short-premium structures.'];
  }
  if (regime === 'high') {
    return ['High IV regime; defined-risk credit structures are favored and position sizing should be conservative.'];
  }
  return [];
}

function formatMetric(label: string, value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return `${label} ${round(value)}.`;
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}
