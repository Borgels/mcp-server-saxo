import type { SaxoClient } from './client.js';
import {
  screenOptionStrategies,
  type RiskProfile,
  type ScreenOptionStrategiesResult,
  type UnderlyingUniverse,
} from './option-strategy-screener.js';
import type { OptionStrategyKind } from './options.js';
import type { MarketScreenPreset } from './screener.js';
import {
  screenStockStrategies,
  type ScreenStockStrategiesResult,
  type StockStrategyObjective,
  type StockUniverse,
} from './stock-strategy-screener.js';
import type { OptionThesisInput, OptionsMode } from './option-portfolio-planner.js';

export type PortfolioObjective = 'balanced_growth_income' | 'income_options' | 'capital_preservation' | 'growth';
export type DeploymentStyle = 'staged' | 'immediate' | 'watchlist';
export type PortfolioProfile = 'balanced' | 'concentrated_conviction';
export type StrategyPlaybook =
  | 'income_30_60d'
  | 'aggressive_short_term'
  | 'earnings_defined_risk'
  | 'long_term_directional'
  | 'leaps_replacement'
  | 'quality_put_write';

export interface PlanPortfolioStrategyInput {
  accountKey: string;
  objective?: PortfolioObjective;
  riskProfile?: RiskProfile;
  portfolioProfile?: PortfolioProfile;
  deploymentStyle?: DeploymentStyle;
  targetInvestedPercent?: number;
  cashReservePercent?: number;
  maxCashDollars?: number;
  maxSingleNamePercent?: number;
  maxSectorPercent?: number;
  maxOptionsRiskPercent?: number;
  maxThesisRiskPercent?: number;
  maxSingleTradeRiskPercent?: number;
  riskBudgetPercentPerIdea?: number;
  allowShortOptionLegs?: boolean;
  requireGreeks?: boolean;
  maxThetaDailyPercentOfRisk?: number;
  optionsMode?: OptionsMode;
  fragmentationPolicy?: 'warn' | 'reject';
  maxContractsPerPosition?: number;
  maxSelectedUnderlyings?: number;
  maxMonitoringSymbols?: number;
  minPositionRiskDollars?: number;
  minPositionRiskPercent?: number;
  includeStocks?: boolean;
  includeOptions?: boolean;
  stockMarket?: 'us' | 'us_nasdaq' | 'us_nyse';
  stockUniverse?: StockUniverse;
  stockMaxCandidates?: number;
  stockMaxTechnicalCandidates?: number;
  discoverOptionCandidates?: boolean;
  optionDiscoveryUniverse?: UnderlyingUniverse;
  optionDiscoveryPreset?: MarketScreenPreset;
  optionDiscoveryPlaybook?: StrategyPlaybook;
  optionDiscoveryMaxUnderlyings?: number;
  optionDiscoveryMaxSymbolsToPlan?: number;
  optionDiscoveryTargetRiskPercent?: number;
  stockSymbols?: string[];
  optionSymbols?: string[];
  optionTheses?: OptionThesisInput[];
  maxStockIdeas?: number;
  maxOptionIdeas?: number;
  includeNewsContext?: boolean;
  includeFundamentalContext?: boolean;
}

export interface PortfolioStrategyResult {
  generatedAt: string;
  filters: {
    objective: PortfolioObjective;
    riskProfile: RiskProfile;
    portfolioProfile: PortfolioProfile;
    deploymentStyle: DeploymentStyle;
    includeStocks: boolean;
    includeOptions: boolean;
    stockMarket?: 'us' | 'us_nasdaq' | 'us_nyse';
    stockUniverse?: StockUniverse;
    discoverOptionCandidates: boolean;
    optionDiscoveryUniverse?: UnderlyingUniverse;
    optionDiscoveryPreset?: MarketScreenPreset;
    maxSingleNamePercent: number;
    maxSectorPercent: number;
    maxOptionsRiskPercent: number;
    riskBudgetPercentPerIdea: number;
  };
  portfolioSnapshot: {
    accountContextAvailable: boolean;
    netValue?: number;
    cashAvailable?: number;
    positionsCount: number;
    currentSymbolExposure: Record<string, number>;
  };
  riskBudgets: {
    maxSingleNameDollars?: number;
    maxOptionsRiskDollars?: number;
    perIdeaRiskBudgetDollars?: number;
    cashReserveDollars?: number;
  };
  stockContext: Array<{
    rank: number;
    symbol: string;
    price?: number;
    sector?: string;
    factorScores: ScreenStockStrategiesResult['Data'][number]['factorScores'];
    sizingStatus?: string;
    keyRisks: string[];
  }>;
  optionContext: Array<{
    rank: number;
    symbol: string;
    strategy: OptionStrategyKind;
    expiry: string;
    daysToExpiry: number;
    maxLoss?: number;
    factorScores?: ScreenOptionStrategiesResult['Data'][number]['factorScores'];
    sizingStatus?: string;
    keyRisks: string[];
  }>;
  constraintSummary: {
    sectorExposure: Record<string, number>;
    optionRiskBySymbol: Record<string, number>;
    warnings: string[];
  };
  stockScreen?: ScreenStockStrategiesResult;
  optionScreen?: ScreenOptionStrategiesResult;
  warnings: string[];
}

export async function planPortfolioStrategy(
  client: SaxoClient,
  input: PlanPortfolioStrategyInput,
  now: Date = new Date(),
): Promise<PortfolioStrategyResult> {
  const objective = input.objective ?? 'balanced_growth_income';
  const riskProfile = input.riskProfile ?? 'balanced';
  const portfolioProfile = input.portfolioProfile ?? 'balanced';
  const deploymentStyle = input.deploymentStyle ?? 'staged';
  const includeStocks = input.includeStocks ?? true;
  const includeOptions = input.includeOptions ?? true;
  const discoverOptionCandidates = input.discoverOptionCandidates ?? false;
  const maxSingleNamePercent = clampNumber(input.maxSingleNamePercent ?? 10, 0.1, 100);
  const maxSectorPercent = clampNumber(input.maxSectorPercent ?? 35, 1, 100);
  const maxOptionsRiskPercent = clampNumber(input.maxOptionsRiskPercent ?? 5, 0, 100);
  const riskBudgetPercentPerIdea = clampNumber(input.riskBudgetPercentPerIdea ?? 1, 0.01, 100);
  const maxStockIdeas = clampInt(input.maxStockIdeas ?? 8, 1, 25);
  const maxOptionIdeas = clampInt(input.maxOptionIdeas ?? (portfolioProfile === 'concentrated_conviction' ? 5 : 6), 1, 25);
  const optionStrategies = optionStrategiesForInput(input);

  const stockScreen = includeStocks
    ? await screenStockStrategies(client, {
      accountKey: input.accountKey,
      market: input.stockMarket ?? 'us',
      symbols: input.stockSymbols,
      universe: input.stockUniverse ?? (input.stockSymbols?.length ? 'symbols' : 'auto'),
      objective: stockObjectiveForPortfolio(objective),
      riskProfile,
      maxResults: Math.min(25, Math.max(maxStockIdeas * 3, maxStockIdeas)),
      maxCandidates: input.stockMaxCandidates,
      maxTechnicalCandidates: input.stockMaxTechnicalCandidates,
      includeAccountContext: true,
      riskBudgetPercentPerIdea,
      maxSingleNamePercent,
      includeNewsContext: input.includeNewsContext ?? false,
      includeFundamentalContext: input.includeFundamentalContext ?? true,
    }, now)
    : undefined;

  const optionScreen = includeOptions
    ? await screenOptionStrategies(client, {
      accountKey: input.accountKey,
      symbols: resolveOptionSymbols(input.optionSymbols, input.optionTheses),
      strategies: optionStrategies,
      underlyingUniverse: input.optionDiscoveryUniverse ?? (discoverOptionCandidates ? 'auto' : 'two_sided_movers'),
      underlyingPreset: input.optionDiscoveryPreset,
      maxUnderlyings: input.optionDiscoveryMaxUnderlyings ?? 50,
      maxSymbolsToPlan: input.optionDiscoveryMaxSymbolsToPlan ?? Math.min(10, Math.max(5, maxOptionIdeas)),
      maxPlans: Math.min(25, Math.max(maxOptionIdeas * 3, maxOptionIdeas)),
      includeAccountContext: true,
      riskBudgetPercent: riskBudgetPercentPerIdea,
      maxPortfolioRiskPercent: maxOptionsRiskPercent,
      maxSymbolExposurePercent: maxSingleNamePercent,
      allowShortOptionLegs: input.allowShortOptionLegs ?? true,
      requireGreeks: input.requireGreeks ?? false,
      maxThetaDailyPercentOfRisk: input.maxThetaDailyPercentOfRisk,
      includeNewsContext: input.includeNewsContext ?? false,
    }, now)
    : undefined;

  const warnings = Array.from(new Set([...(stockScreen?.warnings ?? []), ...(optionScreen?.warnings ?? [])]));
  const accountContext = stockScreen?.accountContext ?? optionScreen?.accountContext;
  const netValue = accountContext?.netValue;
  const cashReserveDollars = resolveCashReserveDollars(netValue, input.cashReservePercent, input.maxCashDollars);
  const stockContext = (stockScreen?.Data ?? []).slice(0, maxStockIdeas).map(candidate => ({
    rank: candidate.rank,
    symbol: candidate.symbol,
    price: candidate.mid ?? candidate.lastTraded,
    sector: sectorName(candidate),
    factorScores: candidate.factorScores,
    sizingStatus: candidate.positionSizing?.sizingStatus,
    keyRisks: candidate.keyRisks,
  }));
  const optionContext = (optionScreen?.Data ?? []).slice(0, maxOptionIdeas).map(plan => ({
    rank: plan.rank,
    symbol: plan.symbol,
    strategy: plan.strategy,
    expiry: plan.expiry,
    daysToExpiry: plan.daysToExpiry,
    maxLoss: plan.maxLoss,
    factorScores: plan.factorScores,
    sizingStatus: plan.positionSizing?.sizingStatus,
    keyRisks: plan.keyRisks ?? plan.warnings,
  }));

  return {
    generatedAt: now.toISOString(),
    filters: {
      objective,
      riskProfile,
      portfolioProfile,
      deploymentStyle,
      includeStocks,
      includeOptions,
      stockMarket: input.stockMarket,
      stockUniverse: input.stockUniverse,
      discoverOptionCandidates,
      optionDiscoveryUniverse: input.optionDiscoveryUniverse,
      optionDiscoveryPreset: input.optionDiscoveryPreset,
      maxSingleNamePercent,
      maxSectorPercent,
      maxOptionsRiskPercent,
      riskBudgetPercentPerIdea,
    },
    portfolioSnapshot: {
      accountContextAvailable: accountContext?.available ?? false,
      netValue,
      cashAvailable: accountContext?.cashAvailable,
      positionsCount: accountContext?.positionsCount ?? 0,
      currentSymbolExposure: accountContext?.symbolExposure ?? {},
    },
    riskBudgets: {
      maxSingleNameDollars: dollars(netValue, maxSingleNamePercent),
      maxOptionsRiskDollars: dollars(netValue, maxOptionsRiskPercent),
      perIdeaRiskBudgetDollars: dollars(netValue, riskBudgetPercentPerIdea),
      cashReserveDollars,
    },
    stockContext,
    optionContext,
    constraintSummary: {
      sectorExposure: summarizeSectorExposure(stockContext),
      optionRiskBySymbol: summarizeOptionRisk(optionContext),
      warnings: riskDashboardNotes({ netValue, cashReserveDollars, stockScreen, optionScreen }),
    },
    stockScreen,
    optionScreen,
    warnings,
  };
}

function optionStrategiesForInput(input: PlanPortfolioStrategyInput): OptionStrategyKind[] {
  const thesisStructures = input.optionTheses
    ?.flatMap(thesis => thesis.preferredStructures ?? [])
    .filter((item): item is OptionStrategyKind =>
      ['cash_secured_put', 'put_credit_spread', 'call_credit_spread', 'long_call', 'debit_spread', 'iron_condor'].includes(item),
    );
  if (thesisStructures?.length) {
    return Array.from(new Set(thesisStructures));
  }
  if (input.objective === 'income_options') {
    return ['cash_secured_put', 'put_credit_spread', 'iron_condor'];
  }
  if (input.objective === 'growth') {
    return ['long_call', 'debit_spread', 'put_credit_spread'];
  }
  return ['debit_spread', 'put_credit_spread', 'call_credit_spread'];
}

function stockObjectiveForPortfolio(objective: PortfolioObjective): StockStrategyObjective {
  if (objective === 'growth') return 'core_growth';
  if (objective === 'capital_preservation') return 'defensive';
  if (objective === 'income_options') return 'quality_value';
  return 'balanced';
}

function resolveOptionSymbols(symbols: string[] | undefined, theses: OptionThesisInput[] | undefined): string[] | undefined {
  const all = [
    ...(symbols ?? []),
    ...(theses?.flatMap(thesis => thesis.symbols) ?? []),
  ].map(symbol => symbol.trim()).filter(Boolean);
  return all.length ? Array.from(new Set(all)) : undefined;
}

function resolveCashReserveDollars(netValue: number | undefined, percent: number | undefined, maxCashDollars: number | undefined): number | undefined {
  const percentValue = dollars(netValue, percent ?? 10);
  return minDefined(percentValue, maxCashDollars) ?? percentValue ?? maxCashDollars;
}

function riskDashboardNotes(input: {
  netValue?: number;
  cashReserveDollars?: number;
  stockScreen?: ScreenStockStrategiesResult;
  optionScreen?: ScreenOptionStrategiesResult;
}): string[] {
  return Array.from(new Set([
    !input.netValue ? 'Account net value was unavailable; budget fields are partial.' : undefined,
    input.cashReserveDollars === undefined ? 'Cash reserve dollars could not be derived.' : undefined,
    input.stockScreen && input.stockScreen.Data.length === 0 ? 'No stock factor candidates returned.' : undefined,
    input.optionScreen && input.optionScreen.Data.length === 0 ? 'No option factor candidates returned.' : undefined,
  ].filter(isDefined)));
}

function sectorName(candidate: ScreenStockStrategiesResult['Data'][number]): string | undefined {
  const sector = candidate.fundamentalsContext?.sector?.trim();
  return sector && sector !== 'None' ? sector : undefined;
}

function summarizeSectorExposure(plan: PortfolioStrategyResult['stockContext']): Record<string, number> {
  const exposure: Record<string, number> = {};
  for (const item of plan) {
    const sector = item.sector ?? 'Unknown';
    exposure[sector] = (exposure[sector] ?? 0) + 1;
  }
  return exposure;
}

function summarizeOptionRisk(plan: PortfolioStrategyResult['optionContext']): Record<string, number> {
  const risk: Record<string, number> = {};
  for (const item of plan) {
    risk[item.symbol] = roundMoney((risk[item.symbol] ?? 0) + (item.maxLoss ?? 0)) ?? 0;
  }
  return risk;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function dollars(netValue: number | undefined, percent: number | undefined): number | undefined {
  return netValue !== undefined && percent !== undefined ? roundMoney(netValue * percent / 100) : undefined;
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return defined.length ? Math.min(...defined) : undefined;
}

function roundMoney(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
