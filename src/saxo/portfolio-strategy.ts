import type { SaxoClient } from './client.js';
import {
  screenOptionStrategies,
  type DecisionConfidence,
  type DecisionVerdict,
  type RiskProfile,
  type ScreenOptionStrategiesResult,
  type StrategyPlaybook,
  type UnderlyingUniverse,
} from './option-strategy-screener.js';
import type { MarketScreenPreset } from './screener.js';
import {
  screenStockStrategies,
  type ScreenStockStrategiesResult,
  type StockStrategyObjective,
  type StockUniverse,
} from './stock-strategy-screener.js';
import {
  buildOptionPortfolioPlan,
  type OptionsMode,
  type OptionsPortfolioPlan,
  type OptionsRiskDashboard,
  type OptionThesisInput,
} from './option-portfolio-planner.js';

export type PortfolioObjective = 'balanced_growth_income' | 'income_options' | 'capital_preservation' | 'growth';
export type DeploymentStyle = 'staged' | 'immediate' | 'watchlist';
export type PortfolioProfile = 'balanced' | 'concentrated_conviction';
export type ProfitOptimizationMode = 'standard' | 'convex_momentum';

export interface PlanPortfolioStrategyInput {
  accountKey: string;
  objective?: PortfolioObjective;
  riskProfile?: RiskProfile;
  portfolioProfile?: PortfolioProfile;
  profitOptimizationMode?: ProfitOptimizationMode;
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
    profitOptimizationMode: ProfitOptimizationMode;
    deploymentStyle: DeploymentStyle;
    targetInvestedPercent: number;
    cashReservePercent: number;
    maxCashDollars?: number;
    maxSingleNamePercent: number;
    maxSectorPercent: number;
    maxOptionsRiskPercent: number;
    maxThesisRiskPercent?: number;
    maxSingleTradeRiskPercent?: number;
    riskBudgetPercentPerIdea: number;
    allowShortOptionLegs: boolean;
    requireGreeks: boolean;
    maxThetaDailyPercentOfRisk?: number;
    optionsMode: OptionsMode;
    fragmentationPolicy: 'warn' | 'reject';
    maxContractsPerPosition?: number;
    maxSelectedUnderlyings?: number;
    maxMonitoringSymbols?: number;
    minPositionRiskDollars?: number;
    minPositionRiskPercent?: number;
    includeStocks: boolean;
    includeOptions: boolean;
    stockMarket?: 'us' | 'us_nasdaq' | 'us_nyse';
    stockUniverse?: StockUniverse;
    stockMaxCandidates?: number;
    stockMaxTechnicalCandidates?: number;
    discoverOptionCandidates: boolean;
    optionDiscoveryUniverse?: UnderlyingUniverse;
    optionDiscoveryPreset?: MarketScreenPreset;
    optionDiscoveryPlaybook?: StrategyPlaybook;
    optionDiscoveryMaxUnderlyings?: number;
    optionDiscoveryMaxSymbolsToPlan?: number;
    optionDiscoveryTargetRiskPercent?: number;
  };
  portfolioSnapshot: {
    accountContextAvailable: boolean;
    netValue?: number;
    cashAvailable?: number;
    investedValue?: number;
    cashPercent?: number;
    investedPercent?: number;
    positionsCount: number;
    currentSymbolExposure: Record<string, number>;
  };
  targetAllocation: Array<{
    sleeve: 'cash_reserve' | 'stock_core' | 'stock_tactical' | 'options_satellite';
    targetPercent: number;
    targetDollars?: number;
    rationale: string;
  }>;
  deploymentPlan: Array<{
    stage: number;
    label: string;
    deployDollars?: number;
    focus: string;
    decisionRule: string;
  }>;
  riskDashboard: {
    maxSingleNameDollars?: number;
    maxOptionsRiskDollars?: number;
    perIdeaRiskBudgetDollars?: number;
    cashReserveDollars?: number;
    deployableCashDollars?: number;
    plannedStockNotional?: number;
    plannedOptionRisk?: number;
    unallocatedStockTarget?: number;
    unallocatedOptionBudget?: number;
    sectorExposure: Record<string, number>;
    cashAfterPlan?: number;
    warnings: string[];
    cappedUpsideRiskPercent?: number;
    uncappedConvexityRiskPercent?: number;
    runnerRiskPercent?: number;
    profitOptimizationWarnings: string[];
  };
  stockAllocationPlan: Array<{
    rank: number;
    symbol: string;
    allocationRole: 'core' | 'tactical';
    verdict: DecisionVerdict;
    confidence: DecisionConfidence;
    score: number;
    sector?: string;
    targetDollars?: number;
    shares?: number;
    notional?: number;
    price?: number;
    rationale: string;
    warnings: string[];
  }>;
  optionAllocationPlan: Array<{
    rank: number;
    symbol: string;
    strategy: string;
    verdict: DecisionVerdict;
    confidence: DecisionConfidence;
    recommendedContracts: number;
    plannedRisk?: number;
    rationale: string;
    warnings: string[];
  }>;
  optionsPortfolioPlan?: OptionsPortfolioPlan;
  optionsRiskDashboard?: OptionsRiskDashboard;
  decisionBriefs: Array<{
    rank: number;
    type: 'stock' | 'option' | 'portfolio';
    symbol?: string;
    verdict: DecisionVerdict;
    confidence: DecisionConfidence;
    oneLine: string;
    allocationRole: string;
    keyRisks: string[];
  }>;
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
  const profitOptimizationMode = input.profitOptimizationMode ?? 'standard';
  const deploymentStyle = input.deploymentStyle ?? 'staged';
  const targetInvestedPercent = clampNumber(input.targetInvestedPercent ?? defaultTargetInvested(objective, riskProfile), 1, 100);
  const configuredCashReservePercent = clampNumber(input.cashReservePercent ?? defaultCashReserve(objective, riskProfile), 0, 95);
  const maxCashDollars = input.maxCashDollars === undefined ? undefined : clampNumber(input.maxCashDollars, 0, Number.MAX_SAFE_INTEGER);
  const maxSingleNamePercent = clampNumber(input.maxSingleNamePercent ?? 10, 0.1, 100);
  const maxSectorPercent = clampNumber(input.maxSectorPercent ?? 35, 1, 100);
  const maxOptionsRiskPercent = clampNumber(input.maxOptionsRiskPercent ?? 5, 0, 100);
  const optionsMode = input.optionsMode ?? 'guardrailed';
  const maxThesisRiskPercent = input.maxThesisRiskPercent === undefined
    ? undefined
    : clampNumber(input.maxThesisRiskPercent, 0.01, 100);
  const maxSingleTradeRiskPercent = input.maxSingleTradeRiskPercent === undefined
    ? undefined
    : clampNumber(input.maxSingleTradeRiskPercent, 0.01, 100);
  const riskBudgetPercentPerIdea = clampNumber(input.riskBudgetPercentPerIdea ?? 1, 0.01, 100);
  const allowShortOptionLegs = input.allowShortOptionLegs ?? true;
  const requireGreeks = input.requireGreeks ?? false;
  const maxThetaDailyPercentOfRisk = input.maxThetaDailyPercentOfRisk === undefined
    ? undefined
    : clampNumber(input.maxThetaDailyPercentOfRisk, 0, 100);
  const includeStocks = input.includeStocks ?? true;
  const includeOptions = input.includeOptions ?? true;
  const discoverOptionCandidates = input.discoverOptionCandidates ?? false;
  const maxMonitoringSymbols = input.maxMonitoringSymbols ?? (portfolioProfile === 'concentrated_conviction' ? 5 : undefined);
  const maxSelectedUnderlyings = input.maxSelectedUnderlyings ?? maxMonitoringSymbols;
  const minPositionRiskDollars = input.minPositionRiskDollars;
  const minPositionRiskPercent = input.minPositionRiskPercent ?? (portfolioProfile === 'concentrated_conviction' ? 5 : undefined);
  const maxContractsPerPosition = input.maxContractsPerPosition ?? (portfolioProfile === 'concentrated_conviction' ? 20 : undefined);
  const fragmentationPolicy = input.fragmentationPolicy ?? (portfolioProfile === 'concentrated_conviction' ? 'reject' : 'warn');
  const maxStockIdeas = clampInt(input.maxStockIdeas ?? 8, 1, 25);
  const maxOptionIdeas = clampInt(input.maxOptionIdeas ?? (portfolioProfile === 'concentrated_conviction' ? 5 : 6), 1, 25);
  const warnings: string[] = [];

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
    ? await screenPortfolioOptions(client, {
      discoverOptionCandidates,
      includeNewsContext: input.includeNewsContext ?? false,
      input,
      maxOptionIdeas,
      maxOptionsRiskPercent,
      maxSingleNamePercent,
      maxThetaDailyPercentOfRisk,
      objective,
      profitOptimizationMode,
      allowShortOptionLegs,
      requireGreeks,
      riskBudgetPercentPerIdea,
      riskProfile,
      now,
    })
    : undefined;

  warnings.push(...(stockScreen?.warnings ?? []), ...(optionScreen?.warnings ?? []));
  const accountContext = stockScreen?.accountContext ?? optionScreen?.accountContext;
  const netValue = accountContext?.netValue;
  const cashAvailable = accountContext?.cashAvailable;
  const investedValue = netValue !== undefined && cashAvailable !== undefined ? Math.max(0, netValue - cashAvailable) : undefined;
  const cashPercent = netValue && cashAvailable !== undefined ? cashAvailable / netValue * 100 : undefined;
  const investedPercent = netValue && investedValue !== undefined ? investedValue / netValue * 100 : undefined;
  const cashReserveDollars = resolveCashReserveDollars(netValue, configuredCashReservePercent, maxCashDollars);
  const cashReservePercent = netValue && cashReserveDollars !== undefined
    ? cashReserveDollars / netValue * 100
    : configuredCashReservePercent;
  const targetAllocation = buildTargetAllocation({
    cashReservePercent,
    includeOptions,
    includeStocks,
    maxOptionsRiskPercent,
    netValue,
    objective,
    targetInvestedPercent,
  });
  const stockTargetDollars = sum(
    targetAllocation
      .filter(item => item.sleeve === 'stock_core' || item.sleeve === 'stock_tactical')
      .map(item => item.targetDollars ?? 0),
  );
  const stockAllocationPlan = buildStockAllocationPlan(stockScreen, {
    maxPositions: maxStockIdeas,
    maxSectorDollars: netValue ? netValue * maxSectorPercent / 100 : undefined,
    maxSingleNameDollars: netValue ? netValue * maxSingleNamePercent / 100 : undefined,
    stockTargetDollars,
  });
  const { optionsPortfolioPlan, optionsRiskDashboard } = buildOptionPortfolioPlan({
    accountContext,
    cashReserveDollars,
    deploymentStyle,
    fragmentationPolicy,
    maxOptionIdeas,
    maxContractsPerPosition,
    maxSelectedUnderlyings,
    maxOptionsRiskPercent,
    maxSingleTradeRiskPercent,
    maxThesisRiskPercent,
    minPositionRiskDollars,
    minPositionRiskPercent,
    netValue,
    optionScreen,
    optionTheses: input.optionTheses,
    discoverOptionCandidates,
    discoveryTargetRiskPercent: input.optionDiscoveryTargetRiskPercent,
    optionsMode,
    profitOptimizationMode,
    riskBudgetPercentPerIdea,
    stockAllocations: stockAllocationPlan,
  });
  const optionAllocationPlan = buildOptionAllocationPlan(optionScreen, optionsPortfolioPlan);
  const plannedStockNotional = sum(stockAllocationPlan.map(item => item.notional ?? 0));
  const plannedOptionRisk = sum(optionAllocationPlan.map(item => item.plannedRisk ?? 0));
  const unallocatedStockTarget = Math.max(0, stockTargetDollars - plannedStockNotional);
  const optionBudgetTarget = optionsPortfolioPlan?.totalBudget;
  const unallocatedOptionBudget = optionBudgetTarget === undefined ? undefined : Math.max(0, optionBudgetTarget - plannedOptionRisk);
  const cashAfterPlan = cashAvailable !== undefined ? cashAvailable - plannedStockNotional - plannedOptionRisk : undefined;
  const deployableCashDollars = cashAvailable !== undefined && cashReserveDollars !== undefined
    ? Math.max(0, cashAvailable - cashReserveDollars)
    : undefined;
  const riskDashboardWarnings = riskDashboardNotes({
    cashAfterPlan,
    cashReserveDollars,
    deployableCashDollars,
    includeOptions,
    includeStocks,
    optionBudgetTarget,
    optionScreen,
    plannedOptionRisk,
    plannedStockNotional,
    sectorExposure: summarizeSectorExposure(stockAllocationPlan),
    stockScreen,
    stockTargetDollars,
    unallocatedOptionBudget,
    unallocatedStockTarget,
  });

  return {
    generatedAt: now.toISOString(),
    filters: {
      objective,
      riskProfile,
      portfolioProfile,
      profitOptimizationMode,
      deploymentStyle,
      targetInvestedPercent,
      cashReservePercent,
      maxCashDollars,
      maxSingleNamePercent,
      maxSectorPercent,
      maxOptionsRiskPercent,
      maxThesisRiskPercent,
      maxSingleTradeRiskPercent,
      riskBudgetPercentPerIdea,
      allowShortOptionLegs,
      requireGreeks,
      maxThetaDailyPercentOfRisk,
      optionsMode,
      fragmentationPolicy,
      maxContractsPerPosition,
      maxSelectedUnderlyings,
      maxMonitoringSymbols,
      minPositionRiskDollars,
      minPositionRiskPercent,
      includeStocks,
      includeOptions,
      stockMarket: input.stockMarket,
      stockUniverse: input.stockUniverse,
      stockMaxCandidates: input.stockMaxCandidates,
      stockMaxTechnicalCandidates: input.stockMaxTechnicalCandidates,
      discoverOptionCandidates,
      optionDiscoveryUniverse: input.optionDiscoveryUniverse,
      optionDiscoveryPreset: input.optionDiscoveryPreset,
      optionDiscoveryPlaybook: input.optionDiscoveryPlaybook,
      optionDiscoveryMaxUnderlyings: input.optionDiscoveryMaxUnderlyings,
      optionDiscoveryMaxSymbolsToPlan: input.optionDiscoveryMaxSymbolsToPlan,
      optionDiscoveryTargetRiskPercent: input.optionDiscoveryTargetRiskPercent,
    },
    portfolioSnapshot: {
      accountContextAvailable: accountContext?.available ?? false,
      netValue,
      cashAvailable,
      investedValue,
      cashPercent: round(cashPercent),
      investedPercent: round(investedPercent),
      positionsCount: accountContext?.positionsCount ?? 0,
      currentSymbolExposure: accountContext?.symbolExposure ?? {},
    },
    targetAllocation,
    deploymentPlan: buildDeploymentPlan({
      cashAvailable,
      cashReservePercent,
      cashReserveDollars,
      deploymentStyle,
      netValue,
      objective,
      targetInvestedPercent,
    }),
    riskDashboard: {
      maxSingleNameDollars: roundMoney(netValue ? netValue * maxSingleNamePercent / 100 : undefined),
      maxOptionsRiskDollars: roundMoney(netValue ? netValue * maxOptionsRiskPercent / 100 : undefined),
      perIdeaRiskBudgetDollars: roundMoney(netValue ? netValue * riskBudgetPercentPerIdea / 100 : undefined),
      cashReserveDollars: roundMoney(cashReserveDollars),
      deployableCashDollars: roundMoney(deployableCashDollars),
      plannedStockNotional: roundMoney(plannedStockNotional),
      plannedOptionRisk: roundMoney(plannedOptionRisk),
      unallocatedStockTarget: roundMoney(unallocatedStockTarget),
      unallocatedOptionBudget: roundMoney(unallocatedOptionBudget),
      sectorExposure: summarizeSectorExposure(stockAllocationPlan),
      cashAfterPlan: roundMoney(cashAfterPlan),
      warnings: riskDashboardWarnings,
      ...profitOptimizationDashboard(optionsPortfolioPlan, profitOptimizationMode),
    },
    stockAllocationPlan,
    optionAllocationPlan,
    optionsPortfolioPlan,
    optionsRiskDashboard,
    decisionBriefs: buildPortfolioBriefs(stockScreen, optionScreen, riskDashboardWarnings, stockAllocationPlan, optionAllocationPlan),
    stockScreen,
    optionScreen,
    warnings: Array.from(new Set(warnings)),
  };
}

async function screenPortfolioOptions(
  client: SaxoClient,
  options: {
    discoverOptionCandidates: boolean;
    includeNewsContext: boolean;
    input: PlanPortfolioStrategyInput;
    maxOptionIdeas: number;
    maxOptionsRiskPercent: number;
    maxSingleNamePercent: number;
    maxThetaDailyPercentOfRisk?: number;
    objective: PortfolioObjective;
    profitOptimizationMode: ProfitOptimizationMode;
    allowShortOptionLegs: boolean;
    requireGreeks: boolean;
    riskBudgetPercentPerIdea: number;
    riskProfile: RiskProfile;
    now: Date;
  },
): Promise<ScreenOptionStrategiesResult> {
  const explicitSymbols = resolveOptionSymbols(options.input.optionSymbols, options.input.optionTheses);
  const explicitScreen = explicitSymbols?.length
    ? await screenOptionStrategies(client, {
      ...baseOptionScreenInput(options),
      symbols: explicitSymbols,
      playbook: explicitOptionPlaybook(options.input, options.objective),
      strategies: options.input.optionTheses?.length
        ? ['long_call', 'debit_spread', 'put_credit_spread', 'call_credit_spread', 'cash_secured_put', 'iron_condor']
        : undefined,
      minDte: options.input.optionTheses?.length ? 7 : undefined,
      maxDte: options.input.optionTheses?.length ? 730 : undefined,
      minOpenInterest: options.input.optionTheses?.length ? 0 : undefined,
      maxSpreadPercent: options.input.optionTheses?.length ? 75 : undefined,
      maxPlans: options.input.optionTheses?.length
        ? Math.min(25, Math.max(options.maxOptionIdeas * 3, options.maxOptionIdeas))
        : options.maxOptionIdeas,
      maxSymbolsToPlan: Math.min(10, Math.max(5, options.maxOptionIdeas, explicitSymbols.length)),
    }, options.now)
    : undefined;

  const shouldRunDiscovery = options.discoverOptionCandidates || !explicitSymbols?.length;
  const discoveryScreen = shouldRunDiscovery
    ? await screenOptionStrategies(client, {
      ...baseOptionScreenInput(options),
      playbook: options.input.optionDiscoveryPlaybook ?? discoveryOptionPlaybook(options.objective, options.riskProfile, options.profitOptimizationMode),
      underlyingUniverse: options.input.optionDiscoveryUniverse ?? 'auto',
      underlyingPreset: options.input.optionDiscoveryPreset,
      maxUnderlyings: options.input.optionDiscoveryMaxUnderlyings ?? 50,
      maxSymbolsToPlan: options.input.optionDiscoveryMaxSymbolsToPlan ?? Math.min(10, Math.max(5, options.maxOptionIdeas)),
      maxPlans: Math.min(25, Math.max(options.maxOptionIdeas * 3, options.maxOptionIdeas)),
    }, options.now)
    : undefined;

  return mergeOptionScreens(explicitScreen, discoveryScreen);
}

function baseOptionScreenInput(options: {
  includeNewsContext: boolean;
  input: PlanPortfolioStrategyInput;
  maxOptionsRiskPercent: number;
  maxSingleNamePercent: number;
  maxThetaDailyPercentOfRisk?: number;
  allowShortOptionLegs: boolean;
  requireGreeks: boolean;
  riskBudgetPercentPerIdea: number;
  riskProfile: RiskProfile;
  profitOptimizationMode: ProfitOptimizationMode;
}): Parameters<typeof screenOptionStrategies>[1] {
  return {
    accountKey: options.input.accountKey,
    riskProfile: options.profitOptimizationMode === 'convex_momentum' && options.riskProfile !== 'conservative'
      ? 'aggressive'
      : options.riskProfile,
    includeAccountContext: true,
    riskBudgetPercent: options.riskBudgetPercentPerIdea,
    maxPortfolioRiskPercent: options.maxOptionsRiskPercent,
    maxSymbolExposurePercent: options.maxSingleNamePercent,
    allowShortOptionLegs: options.allowShortOptionLegs,
    requireGreeks: options.requireGreeks,
    maxThetaDailyPercentOfRisk: options.maxThetaDailyPercentOfRisk,
    includeNewsContext: options.includeNewsContext,
  };
}

function explicitOptionPlaybook(input: PlanPortfolioStrategyInput, objective: PortfolioObjective): StrategyPlaybook {
  if (input.profitOptimizationMode === 'convex_momentum') {
    return 'convex_momentum';
  }
  if (input.optionTheses?.length) {
    return 'leaps_replacement';
  }
  return objective === 'income_options' ? 'income_30_60d' : 'quality_put_write';
}

function discoveryOptionPlaybook(objective: PortfolioObjective, riskProfile: RiskProfile, profitOptimizationMode: ProfitOptimizationMode): StrategyPlaybook {
  if (profitOptimizationMode === 'convex_momentum') {
    return 'convex_momentum';
  }
  if (objective === 'income_options') {
    return 'income_30_60d';
  }
  if (objective === 'growth' || riskProfile === 'aggressive') {
    return 'long_term_directional';
  }
  return 'quality_put_write';
}

function mergeOptionScreens(
  explicitScreen: ScreenOptionStrategiesResult | undefined,
  discoveryScreen: ScreenOptionStrategiesResult | undefined,
): ScreenOptionStrategiesResult {
  if (explicitScreen && !discoveryScreen) return explicitScreen;
  if (!explicitScreen && discoveryScreen) return discoveryScreen;
  if (!explicitScreen || !discoveryScreen) {
    throw new Error('Option screening produced no explicit or discovery result.');
  }

  const data = dedupeOptionPlans([...explicitScreen.Data, ...discoveryScreen.Data]);
  return {
    ...explicitScreen,
    warnings: Array.from(new Set([...explicitScreen.warnings, ...discoveryScreen.warnings])),
    underlyings: dedupeUnderlyings([...explicitScreen.underlyings, ...discoveryScreen.underlyings]),
    accountContext: explicitScreen.accountContext ?? discoveryScreen.accountContext,
    decisionBriefs: dedupeDecisionBriefs([...explicitScreen.decisionBriefs, ...discoveryScreen.decisionBriefs]),
    Data: data,
    counters: {
      underlyingsConsidered: explicitScreen.counters.underlyingsConsidered + discoveryScreen.counters.underlyingsConsidered,
      symbolsPlanned: explicitScreen.counters.symbolsPlanned + discoveryScreen.counters.symbolsPlanned,
      symbolsSkipped: explicitScreen.counters.symbolsSkipped + discoveryScreen.counters.symbolsSkipped,
      rawPlans: explicitScreen.counters.rawPlans + discoveryScreen.counters.rawPlans,
      returnedPlans: data.length,
    },
  };
}

function dedupeOptionPlans(plans: ScreenOptionStrategiesResult['Data']): ScreenOptionStrategiesResult['Data'] {
  const seen = new Set<string>();
  const deduped: ScreenOptionStrategiesResult['Data'] = [];
  for (const plan of plans) {
    const key = `${plan.symbol}:${plan.strategy}:${plan.expiry}:${plan.legs.map(leg => leg.uic).join(',')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(plan);
  }
  return deduped;
}

function dedupeUnderlyings(items: ScreenOptionStrategiesResult['underlyings']): ScreenOptionStrategiesResult['underlyings'] {
  const seen = new Set<string>();
  const deduped: ScreenOptionStrategiesResult['underlyings'] = [];
  for (const item of items) {
    const key = `${item.source}:${item.symbol}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function dedupeDecisionBriefs(items: ScreenOptionStrategiesResult['decisionBriefs']): ScreenOptionStrategiesResult['decisionBriefs'] {
  const seen = new Set<string>();
  const deduped: ScreenOptionStrategiesResult['decisionBriefs'] = [];
  for (const item of items) {
    const key = `${item.symbol}:${item.rank}:${item.tradeSummary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function buildTargetAllocation(input: {
  cashReservePercent: number;
  includeOptions: boolean;
  includeStocks: boolean;
  maxOptionsRiskPercent: number;
  netValue?: number;
  objective: PortfolioObjective;
  targetInvestedPercent: number;
}): PortfolioStrategyResult['targetAllocation'] {
  const optionsPercent = input.includeOptions
    ? input.includeStocks
      ? Math.min(input.maxOptionsRiskPercent, input.objective === 'income_options' ? 8 : 5)
      : Math.min(input.maxOptionsRiskPercent, Math.max(0, input.targetInvestedPercent - input.cashReservePercent))
    : 0;
  const tacticalPercent = input.includeStocks ? (input.objective === 'growth' ? 20 : 10) : 0;
  const stockCorePercent = input.includeStocks
    ? Math.max(0, input.targetInvestedPercent - optionsPercent - tacticalPercent)
    : 0;
  return [
    {
      sleeve: 'cash_reserve',
      targetPercent: input.cashReservePercent,
      targetDollars: dollars(input.netValue, input.cashReservePercent),
      rationale: 'Keep dry powder and avoid forcing full deployment from cash in one pass.',
    },
    {
      sleeve: 'stock_core',
      targetPercent: stockCorePercent,
      targetDollars: dollars(input.netValue, stockCorePercent),
      rationale: 'Primary diversified equity exposure from the stock strategy screener.',
    },
    {
      sleeve: 'stock_tactical',
      targetPercent: tacticalPercent,
      targetDollars: dollars(input.netValue, tacticalPercent),
      rationale: 'Smaller tactical equity ideas where trend/news/context justify the risk.',
    },
    {
      sleeve: 'options_satellite',
      targetPercent: optionsPercent,
      targetDollars: dollars(input.netValue, optionsPercent),
      rationale: 'Defined-risk or cash-secured options sized as satellites, not the whole portfolio.',
    },
  ];
}

function buildDeploymentPlan(input: {
  cashAvailable?: number;
  cashReserveDollars?: number;
  cashReservePercent: number;
  deploymentStyle: DeploymentStyle;
  netValue?: number;
  objective: PortfolioObjective;
  targetInvestedPercent: number;
}): PortfolioStrategyResult['deploymentPlan'] {
  const deployable = input.cashAvailable !== undefined && input.netValue !== undefined
    ? Math.max(0, Math.min(input.cashAvailable - (input.cashReserveDollars ?? input.netValue * input.cashReservePercent / 100), input.netValue * input.targetInvestedPercent / 100))
    : undefined;
  if (input.deploymentStyle === 'immediate') {
    return [{
      stage: 1,
      label: 'Initial allocation',
      deployDollars: roundMoney(deployable),
      focus: 'Use only pass-rated candidates that fit sizing and concentration rules.',
      decisionRule: 'Skip any idea whose live quote, spread, or catalyst context has changed materially.',
    }];
  }
  if (input.deploymentStyle === 'watchlist') {
    return [{
      stage: 1,
      label: 'Watchlist only',
      deployDollars: 0,
      focus: 'Build the ranked candidate list without deploying capital.',
      decisionRule: 'Re-run the planner before converting watchlist candidates into orders.',
    }];
  }
  const tranche = deployable !== undefined ? deployable / 3 : undefined;
  return [
    {
      stage: 1,
      label: 'Starter tranche',
      deployDollars: roundMoney(tranche),
      focus: 'Highest-confidence stock core candidates; keep options risk light.',
      decisionRule: 'Only use pass/high or pass/medium briefs with account-fit sizing.',
    },
    {
      stage: 2,
      label: 'Confirmation tranche',
      deployDollars: roundMoney(tranche),
      focus: `Add diversified candidates after the first tranche settles; objective is ${input.objective}.`,
      decisionRule: 'Re-run the screen and avoid doubling down on symbols already near exposure caps.',
    },
    {
      stage: 3,
      label: 'Opportunistic tranche',
      deployDollars: roundMoney(tranche),
      focus: 'Use remaining deployable cash for improved setups, pullbacks, or defined-risk options.',
      decisionRule: 'Leave cash unused if candidates do not meet the same ranking and risk rules.',
    },
  ];
}

function buildPortfolioBriefs(
  stockScreen: ScreenStockStrategiesResult | undefined,
  optionScreen: ScreenOptionStrategiesResult | undefined,
  warnings: string[],
  stockAllocationPlan: PortfolioStrategyResult['stockAllocationPlan'],
  optionAllocationPlan: PortfolioStrategyResult['optionAllocationPlan'],
): PortfolioStrategyResult['decisionBriefs'] {
  const briefs: PortfolioStrategyResult['decisionBriefs'] = [];
  for (const brief of stockScreen?.decisionBriefs.slice(0, 5) ?? []) {
    const allocation = stockAllocationPlan.find(item => item.symbol === brief.symbol);
    briefs.push({
      rank: briefs.length + 1,
      type: 'stock',
      symbol: brief.symbol,
      verdict: brief.verdict,
      confidence: brief.confidence,
      oneLine: allocation?.notional
        ? `${brief.symbol}: proposed ${allocation.allocationRole} allocation ${formatMoney(allocation.notional)} (${allocation.shares} share(s)).`
        : brief.oneLine,
      allocationRole: allocation?.allocationRole === 'core' ? 'stock core allocation' : 'stock tactical candidate',
      keyRisks: brief.keyRisks,
    });
  }
  for (const brief of optionScreen?.decisionBriefs.filter(item => item.verdict !== 'reject').slice(0, 5) ?? []) {
    const allocation = optionAllocationPlan.find(item => item.symbol === brief.symbol && item.rank === brief.rank);
    briefs.push({
      rank: briefs.length + 1,
      type: 'option',
      symbol: brief.symbol,
      verdict: brief.verdict,
      confidence: brief.confidence,
      oneLine: allocation?.plannedRisk
        ? `${brief.symbol}: ${allocation.strategy} satellite, ${allocation.recommendedContracts} contract(s), planned risk ${formatMoney(allocation.plannedRisk)}.`
        : brief.oneLine,
      allocationRole: 'options satellite candidate',
      keyRisks: brief.keyRisks,
    });
  }
  if (warnings.length) {
    briefs.push({
      rank: briefs.length + 1,
      type: 'portfolio',
      verdict: 'watchlist',
      confidence: 'medium',
      oneLine: 'Portfolio-level warnings need review before deployment.',
      allocationRole: 'portfolio risk control',
      keyRisks: warnings,
    });
  }
  return briefs;
}

function profitOptimizationDashboard(
  plan: OptionsPortfolioPlan | undefined,
  mode: ProfitOptimizationMode,
): Pick<PortfolioStrategyResult['riskDashboard'], 'cappedUpsideRiskPercent' | 'uncappedConvexityRiskPercent' | 'runnerRiskPercent' | 'profitOptimizationWarnings'> {
  const total = plan?.usedRisk;
  const selected = plan?.selectedCandidates ?? [];
  const cappedRisk = sum(selected
    .filter(candidate => candidate.strategy !== 'long_call')
    .map(candidate => candidate.plannedRisk ?? 0));
  const uncappedRisk = sum(selected
    .filter(candidate => candidate.strategy === 'long_call')
    .map(candidate => candidate.plannedRisk ?? 0));
  const runnerRisk = sum(selected
    .filter(candidate => candidate.strategy === 'long_call' || (candidate.daysToExpiry ?? 0) >= 120)
    .map(candidate => candidate.plannedRisk ?? 0));
  const warnings: string[] = [];
  if (mode === 'convex_momentum' && selected.length > 0 && uncappedRisk === 0) {
    warnings.push('Convex momentum mode selected only capped option structures; review whether a runner leg or wider upside structure is needed.');
  }
  if (mode === 'convex_momentum' && selected.length > 0 && runnerRisk === 0) {
    warnings.push('Convex momentum mode has no long-DTE or uncapped runner exposure.');
  }
  return {
    cappedUpsideRiskPercent: percentOf(cappedRisk, total),
    uncappedConvexityRiskPercent: percentOf(uncappedRisk, total),
    runnerRiskPercent: percentOf(runnerRisk, total),
    profitOptimizationWarnings: warnings,
  };
}

function buildStockAllocationPlan(
  stockScreen: ScreenStockStrategiesResult | undefined,
  input: {
    maxPositions: number;
    maxSectorDollars?: number;
    maxSingleNameDollars?: number;
    stockTargetDollars: number;
  },
): PortfolioStrategyResult['stockAllocationPlan'] {
  const rawCandidates = stockScreen?.Data.filter(candidate => {
    const brief = stockScreen.decisionBriefs.find(item => item.symbol === candidate.symbol);
    return brief?.verdict !== 'reject' && (candidate.mid ?? candidate.lastTraded) !== undefined;
  }) ?? [];
  const candidates = dedupeIssuerCandidates(rawCandidates);
  if (!candidates.length || input.stockTargetDollars <= 0) {
    return [];
  }

  const selected = selectDiversifiedCandidates(candidates, {
    maxPositions: input.maxPositions,
    maxSectorDollars: input.maxSectorDollars,
    maxSingleNameDollars: input.maxSingleNameDollars,
    stockTargetDollars: input.stockTargetDollars,
  });
  if (!selected.length) {
    return [];
  }

  const totalScore = sum(selected.map(candidate => Math.max(1, candidate.rankingBreakdown.finalScore)));
  const sectorUsed: Record<string, number> = {};
  return selected.map((candidate, index) => {
    const brief = stockScreen?.decisionBriefs.find(item => item.symbol === candidate.symbol);
    const price = candidate.mid ?? candidate.lastTraded;
    const sector = sectorName(candidate);
    const scoreWeight = Math.max(1, candidate.rankingBreakdown.finalScore) / totalScore;
    const targetBeforeCaps = input.stockTargetDollars * scoreWeight;
    const sectorAvailable = sector && input.maxSectorDollars !== undefined
      ? Math.max(0, input.maxSectorDollars - (sectorUsed[sector] ?? 0))
      : undefined;
    const targetDollars = minDefined(targetBeforeCaps, input.maxSingleNameDollars, sectorAvailable) ?? targetBeforeCaps;
    const shares = price ? Math.floor(targetDollars / price) : undefined;
    const notional = shares !== undefined && price ? shares * price : undefined;
    if (sector && notional !== undefined) {
      sectorUsed[sector] = (sectorUsed[sector] ?? 0) + notional;
    }
    const allocationRole = index < Math.ceil(selected.length * 0.7) && brief?.verdict === 'pass' ? 'core' : 'tactical';
    const warnings = [
      ...candidate.keyRisks.slice(0, 3),
      notional !== undefined && notional < targetBeforeCaps * 0.75
        ? 'Allocation capped by single-name limit or share rounding; remaining target should be diversified elsewhere.'
        : undefined,
    ].filter(isDefined);
    return {
      rank: index + 1,
      symbol: candidate.symbol,
      allocationRole,
      verdict: brief?.verdict ?? 'watchlist',
      confidence: brief?.confidence ?? 'low',
      score: candidate.rankingBreakdown.finalScore,
      sector,
      targetDollars: roundMoney(targetDollars),
      shares,
      notional: roundMoney(notional),
      price: roundMoney(price),
      rationale: `${candidate.symbol} receives a score-weighted portfolio allocation, capped by single-name exposure rules.`,
      warnings,
    };
  });
}

function selectDiversifiedCandidates(
  candidates: ScreenStockStrategiesResult['Data'],
  input: {
    maxPositions: number;
    maxSectorDollars?: number;
    maxSingleNameDollars?: number;
    stockTargetDollars: number;
  },
): ScreenStockStrategiesResult['Data'] {
  const hasKnownSectors = candidates.some(candidate => Boolean(sectorName(candidate)));
  if (!hasKnownSectors || input.maxSectorDollars === undefined || input.maxSingleNameDollars === undefined) {
    return candidates.slice(0, input.maxPositions);
  }

  const estimatedNameDollars = Math.max(
    1,
    Math.min(input.maxSingleNameDollars, input.stockTargetDollars / Math.max(1, input.maxPositions)),
  );
  const selected: ScreenStockStrategiesResult['Data'] = [];
  const sectorUsed: Record<string, number> = {};
  const skipped: ScreenStockStrategiesResult['Data'] = [];

  for (const candidate of candidates) {
    if (selected.length >= input.maxPositions) {
      break;
    }
    const sector = sectorName(candidate);
    if (sector && (sectorUsed[sector] ?? 0) + estimatedNameDollars > input.maxSectorDollars) {
      skipped.push(candidate);
      continue;
    }
    selected.push(candidate);
    if (sector) {
      sectorUsed[sector] = (sectorUsed[sector] ?? 0) + estimatedNameDollars;
    }
  }

  for (const candidate of skipped) {
    if (selected.length >= input.maxPositions) {
      break;
    }
    if (!selected.some(item => item.symbol === candidate.symbol)) {
      selected.push(candidate);
    }
  }

  return selected;
}

function dedupeIssuerCandidates(
  candidates: ScreenStockStrategiesResult['Data'],
): ScreenStockStrategiesResult['Data'] {
  const byIssuer = new Map<string, ScreenStockStrategiesResult['Data'][number]>();
  for (const candidate of candidates) {
    const key = issuerKey(candidate);
    const existing = byIssuer.get(key);
    if (!existing || candidate.rankingBreakdown.finalScore > existing.rankingBreakdown.finalScore) {
      byIssuer.set(key, candidate);
    }
  }
  return Array.from(byIssuer.values());
}

function issuerKey(candidate: ScreenStockStrategiesResult['Data'][number]): string {
  const description = candidate.description
    ?.toLowerCase()
    .replace(/\b(class|cl)\s+[a-z]\b/g, '')
    .replace(/\b(common|ordinary|ord|shares?|stock|inc|corp|corporation|ltd|plc|adr|sponsored)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return description || candidate.symbol.replace(/\W/g, '');
}

function sectorName(candidate: ScreenStockStrategiesResult['Data'][number]): string | undefined {
  const sector = candidate.fundamentalsContext?.sector?.trim();
  return sector && sector !== 'None' ? sector : undefined;
}

function summarizeSectorExposure(
  plan: PortfolioStrategyResult['stockAllocationPlan'],
): Record<string, number> {
  const exposure: Record<string, number> = {};
  for (const item of plan) {
    const sector = item.sector ?? 'Unknown';
    exposure[sector] = roundMoney((exposure[sector] ?? 0) + (item.notional ?? 0)) ?? 0;
  }
  return exposure;
}

function buildOptionAllocationPlan(
  optionScreen: ScreenOptionStrategiesResult | undefined,
  optionsPortfolioPlan?: OptionsPortfolioPlan,
): PortfolioStrategyResult['optionAllocationPlan'] {
  if (optionsPortfolioPlan) {
    return optionsPortfolioPlan.selectedCandidates.map(candidate => ({
      rank: candidate.rank,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      verdict: candidate.verdict,
      confidence: candidate.confidence,
      recommendedContracts: candidate.recommendedContracts,
      plannedRisk: roundMoney(candidate.plannedRisk),
      rationale: candidate.rationale,
      warnings: candidate.warnings,
    }));
  }
  return (optionScreen?.Data ?? [])
    .map(plan => {
      const brief = optionScreen?.decisionBriefs.find(item => item.rank === plan.rank && item.symbol === plan.symbol);
      return { plan, brief };
    })
    .filter(item =>
      item.brief?.verdict !== 'reject' &&
      (item.plan.positionSizing?.sizingVerdict === 'pass' || item.plan.positionSizing?.sizingVerdict === 'watchlist'),
    )
    .slice(0, 5)
    .map((item, index) => {
      const maxContracts = item.plan.positionSizing?.maxContracts ?? 0;
      const recommendedContracts = Math.max(0, Math.min(1, maxContracts));
      const riskPerContract = item.plan.positionSizing?.riskPerContract ?? item.plan.maxLoss;
      const plannedRisk = riskPerContract !== undefined ? recommendedContracts * riskPerContract : undefined;
      return {
        rank: index + 1,
        symbol: item.plan.symbol,
        strategy: item.plan.strategy,
        verdict: item.brief?.verdict ?? 'watchlist',
        confidence: item.brief?.confidence ?? 'low',
        recommendedContracts,
        plannedRisk: roundMoney(plannedRisk),
        rationale: `${item.plan.symbol} ${item.plan.strategy} is included only if it remains account-fit and non-rejected.`,
        warnings: item.plan.keyRisks?.slice(0, 4) ?? [],
      };
    });
}

function resolveOptionSymbols(symbols: string[] | undefined, theses: OptionThesisInput[] | undefined): string[] | undefined {
  const all = [
    ...(symbols ?? []),
    ...(theses?.flatMap(thesis => thesis.symbols) ?? []),
  ].map(symbol => symbol.trim()).filter(Boolean);
  return all.length ? Array.from(new Set(all)) : undefined;
}

function riskDashboardNotes(input: {
  cashAfterPlan?: number;
  cashReserveDollars?: number;
  deployableCashDollars?: number;
  includeOptions: boolean;
  includeStocks: boolean;
  optionBudgetTarget?: number;
  optionScreen?: ScreenOptionStrategiesResult;
  plannedOptionRisk: number;
  plannedStockNotional: number;
  sectorExposure: Record<string, number>;
  stockScreen?: ScreenStockStrategiesResult;
  stockTargetDollars: number;
  unallocatedOptionBudget?: number;
  unallocatedStockTarget: number;
}): string[] {
  const warnings: string[] = [];
  if (!input.includeStocks && !input.includeOptions) {
    warnings.push('Both stock and option screening are disabled; no deployable plan can be built.');
  }
  if (input.cashAfterPlan !== undefined && input.cashReserveDollars !== undefined && input.cashAfterPlan < input.cashReserveDollars) {
    warnings.push('Top candidates would consume more cash than the configured reserve allows; use staged deployment or fewer ideas.');
  }
  if (input.includeStocks && !input.stockScreen?.Data.length) {
    warnings.push('No stock candidates passed the configured screen.');
  }
  if (input.includeOptions && !input.optionScreen?.Data.length) {
    warnings.push('No option candidates passed the configured screen.');
  }
  if (
    input.includeOptions &&
    !input.includeStocks &&
    input.cashAfterPlan !== undefined &&
    input.cashReserveDollars !== undefined &&
    input.cashAfterPlan > input.cashReserveDollars &&
    input.deployableCashDollars !== undefined &&
    input.deployableCashDollars > 0 &&
    input.plannedOptionRisk < input.deployableCashDollars * 0.75
  ) {
    warnings.push(
      'Options-only plan leaves material cash above the configured reserve; add more qualifying theses/candidates or relax risk, Greek, liquidity, or per-idea caps before deploying the remainder.',
    );
  }
  if (input.includeStocks && input.stockTargetDollars > 0 && input.unallocatedStockTarget > input.stockTargetDollars * 0.25) {
    warnings.push('Stock target is materially under-allocated; broaden the universe, add ETFs, or relax single-name caps before deploying the remainder.');
  }
  if (Object.keys(input.sectorExposure).length === 1 && input.sectorExposure.Unknown !== undefined && input.plannedStockNotional > 0) {
    warnings.push('Sector diversification could not be enforced because no stock candidates had sector/fundamentals context.');
  }
  if (input.plannedOptionRisk > input.plannedStockNotional && input.includeStocks) {
    warnings.push('Option risk is larger than planned stock notional; review whether the account is becoming options-led.');
  }
  return warnings;
}

function stockObjectiveForPortfolio(objective: PortfolioObjective): StockStrategyObjective {
  if (objective === 'capital_preservation') return 'defensive';
  if (objective === 'growth') return 'core_growth';
  if (objective === 'income_options') return 'quality_value';
  return 'balanced';
}

function defaultTargetInvested(objective: PortfolioObjective, riskProfile: RiskProfile): number {
  if (objective === 'capital_preservation') return riskProfile === 'aggressive' ? 55 : 40;
  if (objective === 'income_options') return riskProfile === 'conservative' ? 60 : 75;
  if (objective === 'growth') return riskProfile === 'conservative' ? 75 : 90;
  return riskProfile === 'conservative' ? 65 : riskProfile === 'aggressive' ? 90 : 80;
}

function defaultCashReserve(objective: PortfolioObjective, riskProfile: RiskProfile): number {
  if (objective === 'capital_preservation') return riskProfile === 'aggressive' ? 25 : 40;
  if (riskProfile === 'conservative') return 20;
  if (riskProfile === 'aggressive') return 5;
  return 10;
}

function resolveCashReserveDollars(
  netValue: number | undefined,
  cashReservePercent: number,
  maxCashDollars: number | undefined,
): number | undefined {
  const percentReserve = netValue !== undefined ? netValue * cashReservePercent / 100 : undefined;
  if (maxCashDollars === undefined) {
    return percentReserve;
  }
  return minDefined(percentReserve, maxCashDollars) ?? maxCashDollars;
}

function dollars(netValue: number | undefined, percent: number): number | undefined {
  return roundMoney(netValue !== undefined ? netValue * percent / 100 : undefined);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter(isDefined);
  return defined.length ? Math.min(...defined) : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function percentOf(value: number | undefined, base: number | undefined): number | undefined {
  if (value === undefined || base === undefined || base <= 0) {
    return undefined;
  }
  return round(value / base * 100);
}

function roundMoney(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown';
  return `$${roundMoney(value)?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
