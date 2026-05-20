import { SaxoHttpError } from '../errors.js';
import type { SaxoClient } from './client.js';
import {
  type ExternalStrategyContext,
  type OptionStrategyKind,
  type OptionStrategyPlan,
  type DirectionalBias,
  planOptionStrategy,
} from './options.js';
import {
  getMarketNewsContext,
  type MarketContextProvider,
  type MarketNewsContext,
} from './market-context.js';
import { getBalance, listAccounts, listPositions } from './portfolio.js';
import { type MarketScreenMarket, type MarketScreenPreset, screenMarket } from './screener.js';

export interface ScreenOptionStrategiesInput {
  accountKey: string;
  market?: Extract<MarketScreenMarket, 'us' | 'us_nasdaq' | 'us_nyse'>;
  symbols?: string[];
  underlyingUniverse?: UnderlyingUniverse;
  underlyingPreset?: MarketScreenPreset;
  playbook?: StrategyPlaybook;
  riskProfile?: RiskProfile;
  objective?: TradeObjective;
  strategies?: OptionStrategyKind[];
  minDte?: number;
  maxDte?: number;
  maxUnderlyings?: number;
  maxUnderlyingScan?: number;
  maxSymbolsToPlan?: number;
  maxPlans?: number;
  riskBudget?: number;
  includeAccountContext?: boolean;
  riskBudgetPercent?: number;
  maxPortfolioRiskPercent?: number;
  maxSymbolExposurePercent?: number;
  allowExistingExposureIncrease?: boolean;
  minOpenInterest?: number;
  maxSpreadPercent?: number;
  includeTechnicalContext?: boolean;
  includeVolatilityContext?: boolean;
  includeNewsContext?: boolean;
  newsProvider?: MarketContextProvider;
  newsLookbackDays?: number;
  newsLimit?: number;
  earningsHorizon?: '3month' | '6month' | '12month';
  technicalHorizon?: number;
  technicalBars?: number;
  externalContextBySymbol?: Record<string, ExternalStrategyContext>;
}

export interface TechnicalScreeningContext extends ExternalStrategyContext {
  source: 'saxo_chart';
  horizon: number;
  bars: number;
  metrics: {
    lastClose?: number;
    return5dPercent?: number;
    return20dPercent?: number;
    sma20?: number;
    sma50?: number;
    distanceToSma20Percent?: number;
    distanceToSma50Percent?: number;
    annualizedVolatilityPercent?: number;
    averageRange14dPercent?: number;
  };
}

export interface ScreenedUnderlying {
  rank: number;
  symbol: string;
  keyword: string;
  source: 'symbols' | 'market_screener';
  uic?: number;
  assetType?: string;
  description?: string;
  exchangeId?: string;
  percentChange?: number;
  underlyingPrice?: number;
  optionRootId?: number;
  screeningContext?: TechnicalScreeningContext;
  newsContext?: MarketNewsContext;
  externalContext?: ExternalStrategyContext;
  effectiveContext?: ExternalStrategyContext;
  planned: boolean;
  skipReason?: string;
}

export type SizingVerdict = 'pass' | 'watchlist' | 'too_large' | 'blocked' | 'unknown';
export type DecisionVerdict = 'pass' | 'watchlist' | 'reject';
export type DecisionConfidence = 'low' | 'medium' | 'high';

export interface AccountScreeningContext {
  source: 'saxo_portfolio';
  available: boolean;
  netValue?: number;
  cashAvailable?: number;
  marginAvailable?: number;
  positionsCount: number;
  symbolExposure: Record<string, number>;
  warnings: string[];
}

export interface PositionSizing {
  maxRiskBudget?: number;
  maxContracts?: number;
  riskPerContract?: number;
  riskBudgetUsedPercent?: number;
  collateralRequired?: number;
  collateralUsedPercent?: number;
  symbolExposureBefore?: number;
  symbolExposureAfterTrade?: number;
  symbolExposureAfterTradePercent?: number;
  sizingVerdict: SizingVerdict;
  sizingNotes: string[];
}

export interface RankingBreakdown {
  baseScore: number;
  liquidityScore: number;
  structureScore: number;
  contextScore: number;
  playbookFitScore: number;
  accountFitScore: number;
  finalScore: number;
}

export interface DecisionBrief {
  rank: number;
  symbol: string;
  verdict: DecisionVerdict;
  confidence: DecisionConfidence;
  oneLine: string;
  tradeSummary: string;
  whyItRanked: string[];
  keyRisks: string[];
  decisionRules: string[];
  questionsBeforeTrade: string[];
  accountFit?: PositionSizing;
}

type MarketUnderlyingRow = {
  uic: number;
  assetType: string;
  symbol?: string;
  description?: string;
  exchangeId?: string;
  currencyCode?: string;
  percentChange: number;
};

export interface ScreenOptionStrategiesResult {
  generatedAt: string;
  filters: {
    market: string;
    underlyingUniverse: UnderlyingUniverse;
    underlyingPreset: MarketScreenPreset;
    underlyingPresets: MarketScreenPreset[];
    playbook: StrategyPlaybook;
    riskProfile: RiskProfile;
    objective: TradeObjective;
    playbookNotes: string[];
    strategies: OptionStrategyKind[];
    minDte: number;
    maxDte: number;
    maxUnderlyings: number;
    maxUnderlyingScan: number;
    maxSymbolsToPlan: number;
    maxPlans: number;
    minOpenInterest: number;
    maxSpreadPercent: number;
    includeTechnicalContext: boolean;
    includeVolatilityContext: boolean;
    includeNewsContext: boolean;
    newsProvider: MarketContextProvider;
    newsLookbackDays: number;
    newsLimit: number;
    earningsHorizon: '3month' | '6month' | '12month';
    technicalHorizon: number;
    technicalBars: number;
    riskBudget?: number;
    includeAccountContext: boolean;
    riskBudgetPercent: number;
    maxPortfolioRiskPercent: number;
    maxSymbolExposurePercent: number;
    allowExistingExposureIncrease: boolean;
  };
  counters: {
    underlyingsConsidered: number;
    symbolsPlanned: number;
    symbolsSkipped: number;
    rawPlans: number;
    returnedPlans: number;
  };
  warnings: string[];
  underlyings: ScreenedUnderlying[];
  accountContext?: AccountScreeningContext;
  decisionBriefs: DecisionBrief[];
  Data: Array<
    OptionStrategyPlan & {
      symbol: string;
      keyword: string;
      optionRootId?: number;
      underlyingPrice?: number;
      underlyingPercentChange?: number;
      underlyingExchangeId?: string;
      rootDescription?: string;
      screeningContext?: TechnicalScreeningContext;
      newsContext?: MarketNewsContext;
      effectiveContext?: ExternalStrategyContext;
      positionSizing?: PositionSizing;
      rankingBreakdown?: RankingBreakdown;
      whyItRanked?: string[];
      keyRisks?: string[];
    }
  >;
}

export type StrategyPlaybook =
  | 'income_30_60d'
  | 'aggressive_short_term'
  | 'earnings_defined_risk'
  | 'long_term_directional'
  | 'leaps_replacement'
  | 'quality_put_write';

export type RiskProfile = 'conservative' | 'balanced' | 'aggressive';
export type TradeObjective =
  | 'income'
  | 'directional'
  | 'volatility'
  | 'stock_replacement'
  | 'capital_preservation';
export type UnderlyingUniverse =
  | 'auto'
  | 'single_preset'
  | 'bullish_movers'
  | 'bearish_movers'
  | 'two_sided_movers';

const DEFAULT_STRATEGIES: OptionStrategyKind[] = [
  'cash_secured_put',
  'put_credit_spread',
  'call_credit_spread',
  'iron_condor',
];

const PER_SYMBOL_RETURN_CAP = 3;

interface PlaybookDefaults {
  objective: TradeObjective;
  strategies: OptionStrategyKind[];
  minDte: number;
  maxDte: number;
  minOpenInterest: number;
  maxSpreadPercent: number;
  notes: string[];
}

const PLAYBOOK_DEFAULTS: Record<StrategyPlaybook, PlaybookDefaults> = {
  income_30_60d: {
    objective: 'income',
    strategies: ['put_credit_spread', 'call_credit_spread', 'iron_condor', 'cash_secured_put'],
    minDte: 21,
    maxDte: 60,
    minOpenInterest: 150,
    maxSpreadPercent: 25,
    notes: ['Balanced income playbook: prefers 21-60 DTE defined-risk premium structures.'],
  },
  aggressive_short_term: {
    objective: 'directional',
    strategies: ['debit_spread', 'put_credit_spread', 'call_credit_spread'],
    minDte: 1,
    maxDte: 14,
    minOpenInterest: 300,
    maxSpreadPercent: 18,
    notes: ['Aggressive short-term playbook: tighter liquidity filters because theta, gamma, and slippage dominate.'],
  },
  earnings_defined_risk: {
    objective: 'volatility',
    strategies: ['iron_condor', 'put_credit_spread', 'call_credit_spread', 'debit_spread'],
    minDte: 7,
    maxDte: 45,
    minOpenInterest: 200,
    maxSpreadPercent: 22,
    notes: ['Earnings playbook: only defined-risk structures are considered by default.'],
  },
  long_term_directional: {
    objective: 'directional',
    strategies: ['debit_spread'],
    minDte: 60,
    maxDte: 365,
    minOpenInterest: 50,
    maxSpreadPercent: 35,
    notes: ['Long-term directional playbook: favors lower-theta debit spreads over short-premium income.'],
  },
  leaps_replacement: {
    objective: 'stock_replacement',
    strategies: ['debit_spread'],
    minDte: 180,
    maxDte: 730,
    minOpenInterest: 10,
    maxSpreadPercent: 45,
    notes: ['LEAPS replacement playbook: accepts wider spreads but treats liquidity as a major risk note.'],
  },
  quality_put_write: {
    objective: 'income',
    strategies: ['cash_secured_put', 'put_credit_spread'],
    minDte: 21,
    maxDte: 90,
    minOpenInterest: 100,
    maxSpreadPercent: 25,
    notes: ['Put-write playbook: premium collection with willingness to own or define downside risk.'],
  },
};

export async function screenOptionStrategies(
  client: SaxoClient,
  input: ScreenOptionStrategiesInput,
  now: Date = new Date(),
): Promise<ScreenOptionStrategiesResult> {
  const market = input.market ?? 'us';
  const playbook = input.playbook ?? 'income_30_60d';
  const playbookDefaults = PLAYBOOK_DEFAULTS[playbook];
  const underlyingUniverse = input.underlyingUniverse ?? (input.underlyingPreset ? 'single_preset' : 'auto');
  const underlyingPresets = resolveUnderlyingPresets(underlyingUniverse, playbook, input.underlyingPreset);
  const underlyingPreset = input.underlyingPreset ?? underlyingPresets[0] ?? 'top_gainers';
  const riskProfile = input.riskProfile ?? 'balanced';
  const objective = input.objective ?? playbookDefaults.objective;
  const strategies = input.strategies?.length ? input.strategies : playbookDefaults.strategies;
  const minDte = input.minDte ?? playbookDefaults.minDte;
  const maxDte = input.maxDte ?? playbookDefaults.maxDte;
  const maxUnderlyings = clampInt(input.maxUnderlyings ?? 50, 1, 50);
  const maxUnderlyingScan = clampInt(input.maxUnderlyingScan ?? 500, maxUnderlyings, 500);
  const maxSymbolsToPlan = clampInt(input.maxSymbolsToPlan ?? 5, 1, 10);
  const maxPlans = clampInt(input.maxPlans ?? 10, 1, 25);
  const includeAccountContext = input.includeAccountContext ?? true;
  const riskBudgetPercent = clampNumber(input.riskBudgetPercent ?? 1, 0.01, 100);
  const maxPortfolioRiskPercent = clampNumber(input.maxPortfolioRiskPercent ?? 5, 0.01, 100);
  const maxSymbolExposurePercent = clampNumber(input.maxSymbolExposurePercent ?? 10, 0.01, 100);
  const allowExistingExposureIncrease = input.allowExistingExposureIncrease ?? false;
  const minOpenInterest = input.minOpenInterest ?? riskAdjustedOpenInterest(playbookDefaults.minOpenInterest, riskProfile);
  const maxSpreadPercent = input.maxSpreadPercent ?? riskAdjustedSpread(playbookDefaults.maxSpreadPercent, riskProfile);
  const includeTechnicalContext = input.includeTechnicalContext ?? true;
  const includeVolatilityContext = input.includeVolatilityContext ?? true;
  const includeNewsContext = input.includeNewsContext ?? false;
  const newsProvider = input.newsProvider ?? 'auto';
  const newsLookbackDays = clampInt(input.newsLookbackDays ?? 7, 1, 30);
  const newsLimit = clampInt(input.newsLimit ?? 20, 1, 50);
  const earningsHorizon = input.earningsHorizon ?? '3month';
  const technicalHorizon = clampInt(input.technicalHorizon ?? 1440, 1, 10080);
  const technicalBars = clampInt(input.technicalBars ?? 90, 20, 1200);
  const warnings: string[] = [];
  const accountContext = includeAccountContext
    ? await buildAccountContext(client, {
      accountKey: input.accountKey,
      warnings,
    })
    : undefined;
  const underlyings = await resolveCandidateUnderlyings(client, input, {
    market,
    maxUnderlyings,
    maxUnderlyingScan,
    now,
    underlyingPreset,
    underlyingPresets,
    underlyingUniverse,
    warnings,
  });
  const allPlans: ScreenOptionStrategiesResult['Data'] = [];
  let symbolsPlanned = 0;
  let stoppedEarly = false;

  for (const underlying of underlyings) {
    if (symbolsPlanned >= maxSymbolsToPlan || stoppedEarly) {
      if (!underlying.skipReason) {
        underlying.skipReason = stoppedEarly
          ? 'Not planned because screening stopped after a rate-limit or timeout response.'
          : 'Not planned because maxSymbolsToPlan was reached.';
      }
      continue;
    }

    try {
      underlying.externalContext = contextForSymbol(input.externalContextBySymbol, underlying);
      if (includeTechnicalContext) {
        underlying.screeningContext = await buildTechnicalContext(client, underlying, {
          accountKey: input.accountKey,
          horizon: technicalHorizon,
          bars: technicalBars,
          now,
          warnings,
        });
      }
      if (includeNewsContext) {
        underlying.newsContext = await buildNewsContext(underlying, {
          earningsHorizon,
          lookbackDays: newsLookbackDays,
          newsLimit,
          now,
          provider: newsProvider,
          warnings,
        });
      }
      underlying.effectiveContext = mergeContexts(
        underlying.screeningContext,
        underlying.newsContext,
        underlying.externalContext,
      );

      const plan = await planOptionStrategy(client, {
        accountKey: input.accountKey,
        keywords: underlying.keyword,
        strategies,
        minDte,
        maxDte,
        maxCandidates: Math.min(8, maxPlans),
        riskBudget: input.riskBudget,
        minOpenInterest,
        maxSpreadPercent,
        includeVolatilityContext,
        externalContext: underlying.effectiveContext,
      }, now);

      underlying.optionRootId = plan.optionRoot.optionRootId;
      underlying.underlyingPrice = plan.optionRoot.underlyingPrice;
      underlying.effectiveContext = plan.externalContext ?? underlying.effectiveContext;
      underlying.planned = plan.Data.length > 0;
      if (!underlying.planned) {
        underlying.skipReason = plan.warnings.join(' ') || 'No strategy plans passed filters.';
      } else {
        symbolsPlanned += 1;
      }
      warnings.push(...plan.warnings.map(warning => `${underlying.symbol}: ${warning}`));
      allPlans.push(...plan.Data.map(item => ({
        ...item,
        symbol: underlying.symbol,
        keyword: underlying.keyword,
        optionRootId: plan.optionRoot.optionRootId,
        underlyingPrice: plan.optionRoot.underlyingPrice,
        underlyingPercentChange: underlying.percentChange,
        underlyingExchangeId: underlying.exchangeId,
        rootDescription: plan.optionRoot.description,
        screeningContext: underlying.screeningContext,
        newsContext: underlying.newsContext,
        effectiveContext: underlying.effectiveContext,
      })));
    } catch (error) {
      const message = formatScreenError(error);
      underlying.planned = false;
      underlying.skipReason = message;
      warnings.push(`${underlying.symbol}: ${message}`);
      if (isStopScanningError(error)) {
        warnings.push('Stopped option strategy screening early after a rate-limit or timeout response.');
        stoppedEarly = true;
      }
    }
  }

  const enrichedPlans = allPlans.map(plan => enrichPlanDecisionSupport(plan, {
    accountContext,
    allowExistingExposureIncrease,
    maxPortfolioRiskPercent,
    maxSymbolExposurePercent,
    objective,
    playbook,
    riskBudget: input.riskBudget,
    riskBudgetPercent,
    riskProfile,
  }));
  const ranked = applyDiversifiedRanking(
    enrichedPlans,
    { objective, playbook, riskProfile },
    maxPlans,
  ).map((plan, index) => ({
    ...plan,
    rank: index + 1,
  }));
  const decisionBriefs = ranked.map(plan => buildDecisionBrief(plan));

  if (ranked.length === 0) {
    warnings.push('No option strategy plans passed the screening filters.');
  }

  return {
    generatedAt: now.toISOString(),
    filters: {
      market,
      underlyingUniverse,
      underlyingPreset,
      underlyingPresets,
      playbook,
      riskProfile,
      objective,
      playbookNotes: playbookDefaults.notes,
      strategies,
      minDte,
      maxDte,
      maxUnderlyings,
      maxUnderlyingScan,
      maxSymbolsToPlan,
      maxPlans,
      minOpenInterest,
      maxSpreadPercent,
      includeTechnicalContext,
      includeVolatilityContext,
      includeNewsContext,
      newsProvider,
      newsLookbackDays,
      newsLimit,
      earningsHorizon,
      technicalHorizon,
      technicalBars,
      riskBudget: input.riskBudget,
      includeAccountContext,
      riskBudgetPercent,
      maxPortfolioRiskPercent,
      maxSymbolExposurePercent,
      allowExistingExposureIncrease,
    },
    counters: {
      underlyingsConsidered: underlyings.length,
      symbolsPlanned,
      symbolsSkipped: underlyings.filter(underlying => !underlying.planned).length,
      rawPlans: allPlans.length,
      returnedPlans: ranked.length,
    },
    warnings,
    underlyings,
    accountContext,
    decisionBriefs,
    Data: ranked,
  };
}

async function resolveCandidateUnderlyings(
  client: SaxoClient,
  input: ScreenOptionStrategiesInput,
  options: {
    market: Extract<MarketScreenMarket, 'us' | 'us_nasdaq' | 'us_nyse'>;
    maxUnderlyings: number;
    maxUnderlyingScan: number;
    now: Date;
    underlyingPreset: MarketScreenPreset;
    underlyingPresets: MarketScreenPreset[];
    underlyingUniverse: UnderlyingUniverse;
    warnings: string[];
  },
): Promise<ScreenedUnderlying[]> {
  if (input.symbols?.length) {
    const underlyings: ScreenedUnderlying[] = [];
    const symbols = Array.from(new Set(input.symbols.map(symbol => symbol.trim()).filter(Boolean)))
      .slice(0, options.maxUnderlyings);
    for (const symbol of symbols) {
      underlyings.push(await resolveExplicitUnderlying(client, symbol, input.accountKey, underlyings.length + 1));
    }
    return underlyings;
  }

  const screens: Array<Awaited<ReturnType<typeof screenMarket>>> = [];
  for (const preset of options.underlyingPresets) {
    screens.push(await screenMarket(client, {
      assetType: 'Stock',
      limit: options.maxUnderlyings,
      market: options.market,
      maxInstruments: options.maxUnderlyingScan,
      preset,
    }, options.now));
  }
  for (const screen of screens) {
    options.warnings.push(...screen.warnings.map(warning => `Underlying screener (${screen.preset}): ${warning}`));
  }

  const rows = rankUnderlyingRows(
    dedupeUnderlyingRows(screens.flatMap(screen => screen.Data)),
    options.underlyingUniverse,
    options.underlyingPreset,
  ).slice(0, options.maxUnderlyings);

  return rows.map((row, index) => ({
    rank: index + 1,
    symbol: displaySymbol(row.symbol ?? row.description ?? String(row.uic)),
    keyword: symbolKeyword(row.symbol ?? row.description ?? String(row.uic)),
    source: 'market_screener',
    uic: row.uic,
    assetType: row.assetType,
    description: row.description,
    exchangeId: row.exchangeId,
    percentChange: row.percentChange,
    planned: false,
  }));
}

function resolveUnderlyingPresets(
  universe: UnderlyingUniverse,
  playbook: StrategyPlaybook,
  explicitPreset: MarketScreenPreset | undefined,
): MarketScreenPreset[] {
  if (explicitPreset && universe === 'single_preset') {
    return [explicitPreset];
  }
  if (universe === 'bullish_movers') {
    return ['top_gainers'];
  }
  if (universe === 'bearish_movers') {
    return ['top_losers'];
  }
  if (universe === 'two_sided_movers') {
    return ['top_gainers', 'top_losers'];
  }
  if (universe === 'single_preset') {
    return [explicitPreset ?? 'top_gainers'];
  }
  return defaultUniverseForPlaybook(playbook) === 'bearish_movers'
    ? ['top_losers']
    : defaultUniverseForPlaybook(playbook) === 'bullish_movers'
      ? ['top_gainers']
      : ['top_gainers', 'top_losers'];
}

function defaultUniverseForPlaybook(playbook: StrategyPlaybook): Exclude<UnderlyingUniverse, 'auto' | 'single_preset'> {
  if (playbook === 'long_term_directional' || playbook === 'leaps_replacement') {
    return 'bullish_movers';
  }
  if (playbook === 'quality_put_write') {
    return 'bearish_movers';
  }
  return 'two_sided_movers';
}

function dedupeUnderlyingRows<T extends MarketUnderlyingRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const key = `${row.assetType}:${row.uic}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function rankUnderlyingRows<T extends { percentChange: number }>(
  rows: T[],
  universe: UnderlyingUniverse,
  fallbackPreset: MarketScreenPreset,
): T[] {
  const mode = universe === 'auto' ? 'two_sided_movers' : universe;
  if (mode === 'two_sided_movers') {
    return [...rows].sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
  }
  if (mode === 'bearish_movers' || fallbackPreset === 'top_losers' || fallbackPreset === 'premarket_losers') {
    return [...rows].sort((a, b) => a.percentChange - b.percentChange);
  }
  return [...rows].sort((a, b) => b.percentChange - a.percentChange);
}

async function resolveExplicitUnderlying(
  client: SaxoClient,
  symbol: string,
  accountKey: string,
  rank: number,
): Promise<ScreenedUnderlying> {
  const keyword = symbolKeyword(symbol);
  try {
    const response = await client.get<Feed<StockSearchResult>>('/ref/v1/instruments', {
      AccountKey: accountKey,
      AssetTypes: 'Stock',
      Keywords: keyword,
      $top: 20,
    });
    const stock = chooseStockInstrument(response.Data ?? [], keyword);
    if (stock) {
      return {
        rank,
        symbol: displaySymbol(stock.Symbol ?? keyword),
        keyword,
        source: 'symbols',
        uic: stock.Identifier,
        assetType: stock.AssetType,
        description: stock.Description,
        exchangeId: stock.ExchangeId,
        planned: false,
      };
    }
  } catch {
    // Keep explicit symbol screening usable even if the stock lookup fails.
  }
  return {
    rank,
    symbol: displaySymbol(symbol),
    keyword,
    source: 'symbols',
    planned: false,
  };
}

function chooseStockInstrument(stocks: StockSearchResult[], keyword: string): StockSearchResult | undefined {
  return stocks
    .filter(item =>
      typeof item.Identifier === 'number' &&
      item.AssetType === 'Stock' &&
      stockSymbolMatches(displaySymbol(item.Symbol ?? ''), keyword),
    )
    .sort((a, b) => stockScore(b, keyword) - stockScore(a, keyword))
    .at(0);
}

function stockSymbolMatches(symbol: string, keyword: string): boolean {
  return symbol === keyword || symbol.replace(/\W/g, '') === keyword.replace(/\W/g, '');
}

function stockScore(stock: StockSearchResult, keyword: string): number {
  const symbol = displaySymbol(stock.Symbol ?? '');
  return (
    (stock.SummaryType === 'Instrument' ? 100 : 0) +
    (symbol === keyword ? 60 : 0) +
    (symbol.startsWith(keyword) ? 10 : 0) +
    (stock.ExchangeId === 'NASDAQ' || stock.ExchangeId === 'NYSE' ? 35 : 0) +
    (stock.CurrencyCode === 'USD' ? 20 : 0)
  );
}

async function buildTechnicalContext(
  client: SaxoClient,
  underlying: ScreenedUnderlying,
  options: {
    accountKey: string;
    horizon: number;
    bars: number;
    now: Date;
    warnings: string[];
  },
): Promise<TechnicalScreeningContext | undefined> {
  if (typeof underlying.uic !== 'number') {
    options.warnings.push(`${underlying.symbol}: Technical context skipped because the stock Uic is unknown.`);
    return undefined;
  }

  try {
    const response = await client.get<ChartResponse>('/chart/v3/charts', {
      AccountKey: options.accountKey,
      Uic: underlying.uic,
      AssetType: underlying.assetType ?? 'Stock',
      Horizon: options.horizon,
      Count: options.bars,
      Mode: 'UpTo',
      Time: options.now.toISOString(),
    });
    const bars = (response.Data ?? [])
      .map(toOhlcBar)
      .filter((bar): bar is OhlcBar => bar !== undefined);
    return analyzeTechnicalContext(bars, {
      symbol: underlying.symbol,
      horizon: options.horizon,
      requestedBars: options.bars,
    });
  } catch (error) {
    options.warnings.push(`${underlying.symbol}: Technical context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

async function buildNewsContext(
  underlying: ScreenedUnderlying,
  options: {
    earningsHorizon: '3month' | '6month' | '12month';
    lookbackDays: number;
    newsLimit: number;
    now: Date;
    provider: MarketContextProvider;
    warnings: string[];
  },
): Promise<MarketNewsContext | undefined> {
  try {
    const context = await getMarketNewsContext({
      earningsHorizon: options.earningsHorizon,
      lookbackDays: options.lookbackDays,
      newsLimit: options.newsLimit,
      now: options.now,
      provider: options.provider,
      symbol: underlying.symbol,
    });
    if (!context && options.provider !== 'none') {
      options.warnings.push(
        `${underlying.symbol}: News context skipped because no enabled provider/key was configured.`,
      );
    }
    return context;
  } catch (error) {
    options.warnings.push(`${underlying.symbol}: News context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

interface ChartResponse {
  Data?: ChartBar[];
}

interface Feed<T> {
  Data?: T[];
}

interface StockSearchResult {
  AssetType?: string;
  CurrencyCode?: string;
  Description?: string;
  ExchangeId?: string;
  Identifier?: number;
  SummaryType?: string;
  Symbol?: string;
}

interface ChartBar {
  Close?: number;
  CloseAsk?: number;
  CloseBid?: number;
  CloseMid?: number;
  High?: number;
  HighAsk?: number;
  HighBid?: number;
  HighMid?: number;
  Low?: number;
  LowAsk?: number;
  LowBid?: number;
  LowMid?: number;
  Open?: number;
  OpenAsk?: number;
  OpenBid?: number;
  OpenMid?: number;
  Time?: string;
}

interface OhlcBar {
  close: number;
  high?: number;
  low?: number;
}

function toOhlcBar(bar: ChartBar): OhlcBar | undefined {
  const close = priceFromFields(bar.CloseMid, bar.Close, bar.CloseBid, bar.CloseAsk);
  if (close === undefined || close <= 0) {
    return undefined;
  }
  return {
    close,
    high: priceFromFields(bar.HighMid, bar.High, bar.HighBid, bar.HighAsk),
    low: priceFromFields(bar.LowMid, bar.Low, bar.LowBid, bar.LowAsk),
  };
}

function analyzeTechnicalContext(
  bars: OhlcBar[],
  options: { symbol: string; horizon: number; requestedBars: number },
): TechnicalScreeningContext | undefined {
  if (bars.length < 20) {
    return undefined;
  }

  const closes = bars.map(bar => bar.close);
  const lastClose = closes.at(-1);
  const sma20 = average(closes.slice(-20));
  const sma50 = closes.length >= 50 ? average(closes.slice(-50)) : undefined;
  const return5dPercent = percentReturn(closes, 5);
  const return20dPercent = percentReturn(closes, 20);
  const distanceToSma20Percent = lastClose && sma20 ? (lastClose - sma20) / sma20 * 100 : undefined;
  const distanceToSma50Percent = lastClose && sma50 ? (lastClose - sma50) / sma50 * 100 : undefined;
  const annualizedVolatilityPercent = realizedVolatility(closes);
  const averageRange14dPercent = averageRangePercent(bars.slice(-14));
  const technicalBias = inferTechnicalBias({
    distanceToSma20Percent,
    distanceToSma50Percent,
    return20dPercent,
    sma20,
    sma50,
  });
  const riskNotes = technicalRiskNotes({
    annualizedVolatilityPercent,
    averageRange14dPercent,
    return5dPercent,
    return20dPercent,
    technicalBias,
  });

  return {
    source: 'saxo_chart',
    horizon: options.horizon,
    bars: bars.length,
    technicalBias,
    summary: technicalSummary(options.symbol, technicalBias, {
      return20dPercent,
      distanceToSma20Percent,
      distanceToSma50Percent,
      annualizedVolatilityPercent,
    }),
    riskNotes,
    metrics: {
      lastClose: round(lastClose),
      return5dPercent: round(return5dPercent),
      return20dPercent: round(return20dPercent),
      sma20: round(sma20),
      sma50: round(sma50),
      distanceToSma20Percent: round(distanceToSma20Percent),
      distanceToSma50Percent: round(distanceToSma50Percent),
      annualizedVolatilityPercent: round(annualizedVolatilityPercent),
      averageRange14dPercent: round(averageRange14dPercent),
    },
  };
}

function mergeContexts(
  technicalContext: TechnicalScreeningContext | undefined,
  newsContext: MarketNewsContext | undefined,
  externalContext: ExternalStrategyContext | undefined,
): ExternalStrategyContext | undefined {
  if (!technicalContext && !newsContext) {
    return externalContext;
  }
  if (!externalContext && !newsContext) {
    return technicalContext;
  }
  return {
    summary: [technicalContext?.summary, newsContext?.summary, externalContext?.summary]
      .filter(Boolean)
      .join(' External context: '),
    sentiment: externalContext?.sentiment ?? sentimentFromNews(newsContext),
    technicalBias: externalContext?.technicalBias ?? technicalContext?.technicalBias,
    news: newsContext,
    riskNotes: [
      ...(technicalContext?.riskNotes ?? []),
      ...(newsContext?.riskNotes ?? []),
      ...(externalContext?.riskNotes ?? []),
    ],
  };
}

function sentimentFromNews(newsContext: MarketNewsContext | undefined): DirectionalBias | undefined {
  if (newsContext?.sentiment === 'bullish' || newsContext?.sentiment === 'bearish') {
    return newsContext.sentiment;
  }
  if (newsContext?.sentiment === 'neutral' || newsContext?.sentiment === 'mixed') {
    return 'neutral';
  }
  return undefined;
}

function inferTechnicalBias(input: {
  distanceToSma20Percent?: number;
  distanceToSma50Percent?: number;
  return20dPercent?: number;
  sma20?: number;
  sma50?: number;
}): DirectionalBias {
  const aboveTrend =
    (input.distanceToSma20Percent ?? 0) > 1 &&
    (input.distanceToSma50Percent ?? 0) > 1 &&
    (input.return20dPercent ?? 0) > 2 &&
    (!input.sma20 || !input.sma50 || input.sma20 >= input.sma50 * 0.995);
  if (aboveTrend) {
    return 'bullish';
  }
  const belowTrend =
    (input.distanceToSma20Percent ?? 0) < -1 &&
    (input.distanceToSma50Percent ?? 0) < -1 &&
    (input.return20dPercent ?? 0) < -2 &&
    (!input.sma20 || !input.sma50 || input.sma20 <= input.sma50 * 1.005);
  if (belowTrend) {
    return 'bearish';
  }
  return 'neutral';
}

function technicalRiskNotes(input: {
  annualizedVolatilityPercent?: number;
  averageRange14dPercent?: number;
  return5dPercent?: number;
  return20dPercent?: number;
  technicalBias: DirectionalBias;
}): string[] {
  const notes: string[] = [];
  if ((input.annualizedVolatilityPercent ?? 0) >= 80) {
    notes.push('High realized volatility; prefer defined-risk structures and smaller sizing.');
  }
  if ((input.averageRange14dPercent ?? 0) >= 5) {
    notes.push('Wide recent daily ranges; short-premium trades need wider breakevens.');
  }
  if (Math.abs(input.return5dPercent ?? 0) >= 10) {
    notes.push('Large 5-day move; watch reversal and gap risk.');
  }
  if (input.technicalBias !== 'neutral' && Math.abs(input.return20dPercent ?? 0) >= 20) {
    notes.push('Extended 20-day move; directional entries may be late.');
  }
  return notes;
}

function technicalSummary(
  symbol: string,
  bias: DirectionalBias,
  metrics: {
    return20dPercent?: number;
    distanceToSma20Percent?: number;
    distanceToSma50Percent?: number;
    annualizedVolatilityPercent?: number;
  },
): string {
  return [
    `${symbol} Saxo chart bias is ${bias}.`,
    formatMetric('20d return', metrics.return20dPercent, '%'),
    formatMetric('distance to SMA20', metrics.distanceToSma20Percent, '%'),
    formatMetric('distance to SMA50', metrics.distanceToSma50Percent, '%'),
    formatMetric('realized volatility', metrics.annualizedVolatilityPercent, '% annualized'),
  ].filter(Boolean).join(' ');
}

function formatMetric(label: string, value: number | undefined, suffix: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return `${label} ${round(value)}${suffix}.`;
}

function priceFromFields(
  midValue: number | undefined,
  directValue: number | undefined,
  bidValue: number | undefined,
  askValue: number | undefined,
): number | undefined {
  return midValue ?? directValue ?? midpoint(bidValue, askValue);
}

function midpoint(bid: number | undefined, ask: number | undefined): number | undefined {
  if (typeof bid === 'number' && typeof ask === 'number') {
    return (bid + ask) / 2;
  }
  return bid ?? ask;
}

function percentReturn(values: number[], lookback: number): number | undefined {
  const last = values.at(-1);
  const previous = values.at(-(lookback + 1));
  if (!last || !previous) {
    return undefined;
  }
  return (last - previous) / previous * 100;
}

function realizedVolatility(values: number[]): number | undefined {
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous && current) {
      returns.push(Math.log(current / previous));
    }
  }
  if (returns.length < 2) {
    return undefined;
  }
  const mean = average(returns);
  if (mean === undefined) {
    return undefined;
  }
  const variance = average(returns.map(value => (value - mean) ** 2));
  if (variance === undefined) {
    return undefined;
  }
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function averageRangePercent(bars: OhlcBar[]): number | undefined {
  const ranges = bars
    .map(bar => bar.high && bar.low ? (bar.high - bar.low) / bar.close * 100 : undefined)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return ranges.length ? average(ranges) : undefined;
}

function average(values: number[]): number | undefined {
  if (!values.length) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function applyDiversifiedRanking(
  plans: ScreenOptionStrategiesResult['Data'],
  ranking: {
    objective: TradeObjective;
    playbook: StrategyPlaybook;
    riskProfile: RiskProfile;
  },
  maxPlans: number,
): ScreenOptionStrategiesResult['Data'] {
  const sorted = [...plans].sort((a, b) => comparePlans(a, b, ranking));
  const selected: ScreenOptionStrategiesResult['Data'] = [];
  const perSymbol = new Map<string, number>();
  for (const plan of sorted) {
    if ((perSymbol.get(plan.symbol) ?? 0) >= PER_SYMBOL_RETURN_CAP) {
      continue;
    }
    selected.push(plan);
    perSymbol.set(plan.symbol, (perSymbol.get(plan.symbol) ?? 0) + 1);
    if (selected.length >= maxPlans) {
      return selected;
    }
  }

  for (const plan of sorted) {
    if (selected.includes(plan)) {
      continue;
    }
    selected.push(plan);
    if (selected.length >= maxPlans) {
      break;
    }
  }
  return selected;
}

function comparePlans(
  a: ScreenOptionStrategiesResult['Data'][number],
  b: ScreenOptionStrategiesResult['Data'][number],
  ranking: {
    objective: TradeObjective;
    playbook: StrategyPlaybook;
    riskProfile: RiskProfile;
  },
): number {
  return (
    (b.rankingBreakdown?.finalScore ?? rankedScore(b, ranking)) -
      (a.rankingBreakdown?.finalScore ?? rankedScore(a, ranking)) ||
    Number(Boolean(b.pricing)) - Number(Boolean(a.pricing)) ||
    (b.score.liquidity - a.score.liquidity) ||
    a.symbol.localeCompare(b.symbol)
  );
}

function rankedScore(
  plan: ScreenOptionStrategiesResult['Data'][number],
  ranking: {
    objective: TradeObjective;
    playbook: StrategyPlaybook;
    riskProfile: RiskProfile;
  },
): number {
  const fit = playbookFitScore(plan, ranking);
  return plan.score.total * 0.7 + fit * 0.3;
}

function playbookFitScore(
  plan: ScreenOptionStrategiesResult['Data'][number],
  ranking: {
    objective: TradeObjective;
    playbook: StrategyPlaybook;
    riskProfile: RiskProfile;
  },
): number {
  const defaults = PLAYBOOK_DEFAULTS[ranking.playbook];
  const strategyFit = defaults.strategies.includes(plan.strategy) ? 100 : 35;
  const dteFit = scaleDownLocal(Math.abs(plan.daysToExpiry - midpointLocal(defaults.minDte, defaults.maxDte)), 0, Math.max(7, (defaults.maxDte - defaults.minDte) / 2));
  const objectiveFit = objectiveScore(plan, ranking.objective);
  const riskFit = riskProfileScore(plan, ranking.riskProfile);
  return clampScore(strategyFit * 0.25 + dteFit * 0.25 + objectiveFit * 0.3 + riskFit * 0.2);
}

function objectiveScore(plan: ScreenOptionStrategiesResult['Data'][number], objective: TradeObjective): number {
  if (objective === 'income') {
    return plan.estimatedCredit !== undefined
      ? (plan.strategy === 'iron_condor' || plan.strategy === 'put_credit_spread' ? 95 : 75)
      : 35;
  }
  if (objective === 'directional') {
    return plan.strategy === 'debit_spread' ? 95 : 55;
  }
  if (objective === 'volatility') {
    return plan.strategy === 'iron_condor' || plan.strategy.endsWith('credit_spread') ? 90 : 55;
  }
  if (objective === 'stock_replacement') {
    return plan.strategy === 'debit_spread' && plan.daysToExpiry >= 120 ? 95 : plan.strategy === 'debit_spread' ? 70 : 30;
  }
  return plan.maxLoss !== undefined && plan.maxLoss <= 1_000 ? 90 : 55;
}

function riskProfileScore(plan: ScreenOptionStrategiesResult['Data'][number], riskProfile: RiskProfile): number {
  const maxLoss = plan.maxLoss ?? 10_000;
  const rewardToRisk = plan.maxProfit && plan.maxLoss && plan.maxLoss > 0 ? plan.maxProfit / plan.maxLoss : 0;
  if (riskProfile === 'conservative') {
    const lossScore = scaleDownLocal(maxLoss, 250, 2_500);
    const definedRiskScore = plan.legs.length > 1 || plan.strategy === 'cash_secured_put' ? 85 : 40;
    return clampScore(lossScore * 0.65 + definedRiskScore * 0.35);
  }
  if (riskProfile === 'aggressive') {
    return clampScore(scaleUpLocal(rewardToRisk, 0.2, 2) * 0.6 + scaleUpLocal(maxLoss, 250, 3_000) * 0.4);
  }
  return clampScore(scaleUpLocal(rewardToRisk, 0.15, 0.8) * 0.5 + scaleDownLocal(maxLoss, 500, 4_000) * 0.5);
}

function contextForSymbol(
  contexts: Record<string, ExternalStrategyContext> | undefined,
  underlying: ScreenedUnderlying,
): ExternalStrategyContext | undefined {
  if (!contexts) {
    return undefined;
  }
  return contexts[underlying.symbol] ?? contexts[underlying.keyword] ?? contexts[underlying.symbol.toUpperCase()];
}

function isStopScanningError(error: unknown): boolean {
  if (error instanceof SaxoHttpError) {
    return error.status === 429 || error.status === 408 || error.status === 504;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
}

function formatScreenError(error: unknown): string {
  if (error instanceof SaxoHttpError) {
    return `Saxo HTTP ${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function displaySymbol(symbol: string): string {
  return symbol.trim().split(':')[0]?.toUpperCase() ?? symbol.trim().toUpperCase();
}

function symbolKeyword(symbol: string): string {
  return displaySymbol(symbol).split('/')[0] ?? displaySymbol(symbol);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

async function buildAccountContext(
  client: SaxoClient,
  input: { accountKey: string; warnings: string[] },
): Promise<AccountScreeningContext> {
  const context: AccountScreeningContext = {
    source: 'saxo_portfolio',
    available: false,
    positionsCount: 0,
    symbolExposure: {},
    warnings: [],
  };
  let clientKey: string | undefined;

  try {
    const accounts = await listAccounts(client, {});
    const account = feedRows(accounts).find(row => row.AccountKey === input.accountKey) ?? feedRows(accounts)[0];
    if (typeof account?.ClientKey === 'string') {
      clientKey = account.ClientKey;
    }
  } catch (error) {
    const note = `Account metadata context unavailable: ${(error as Error).message}`;
    context.warnings.push(note);
    input.warnings.push(note);
  }

  try {
    const balance = await getBalance(client, clientKey ? { clientKey } : { accountKey: input.accountKey });
    context.netValue = firstNumericPath(balance, [
      'NetEquityForMargin',
      'NetEquity',
      'AccountValue',
      'TotalValue',
      'TotalAccountValue',
      'Equity',
      'Balance',
    ]);
    context.cashAvailable = firstNumericPath(balance, [
      'CashAvailableForTrading',
      'CashBalance',
      'Cash',
      'AvailableCash',
      'CashAvailable',
    ]);
    context.marginAvailable = firstNumericPath(balance, [
      'MarginAvailableForTrading',
      'MarginAvailable',
      'AvailableMargin',
      'MarginCollateralNotAvailable',
    ]);
  } catch (error) {
    const note = `Account balance context unavailable: ${(error as Error).message}`;
    context.warnings.push(note);
    input.warnings.push(note);
  }

  try {
    const positions = await listPositions(client, {
      fieldGroups: ['DisplayAndFormat', 'PositionBase', 'PositionView'],
      top: 500,
    });
    const rows = feedRows(positions);
    context.positionsCount = rows.length;
    context.symbolExposure = summarizeSymbolExposure(rows);
  } catch (error) {
    const note = `Account position context unavailable: ${(error as Error).message}`;
    context.warnings.push(note);
    input.warnings.push(note);
  }

  context.available = Boolean(context.netValue || context.cashAvailable || context.marginAvailable || context.positionsCount);
  if (!context.available && context.warnings.length === 0) {
    const note = 'Account context was fetched, but no usable balance or position fields were found.';
    context.warnings.push(note);
    input.warnings.push(note);
  }
  return context;
}

function enrichPlanDecisionSupport(
  plan: ScreenOptionStrategiesResult['Data'][number],
  options: {
    accountContext?: AccountScreeningContext;
    allowExistingExposureIncrease: boolean;
    maxPortfolioRiskPercent: number;
    maxSymbolExposurePercent: number;
    objective: TradeObjective;
    playbook: StrategyPlaybook;
    riskBudget?: number;
    riskBudgetPercent: number;
    riskProfile: RiskProfile;
  },
): ScreenOptionStrategiesResult['Data'][number] {
  const positionSizing = buildPositionSizing(plan, options);
  const playbookFitScore = playbookFitScoreForPlan(plan, {
    objective: options.objective,
    playbook: options.playbook,
    riskProfile: options.riskProfile,
  });
  const accountFitScore = scoreAccountFit(positionSizing);
  const rankingBreakdown: RankingBreakdown = {
    baseScore: plan.score.total,
    liquidityScore: plan.score.liquidity,
    structureScore: plan.score.structure,
    contextScore: plan.score.context,
    playbookFitScore,
    accountFitScore,
    finalScore: clampScore(plan.score.total * 0.6 + playbookFitScore * 0.25 + accountFitScore * 0.15),
  };
  const whyItRanked = explainPlanRanking(plan, rankingBreakdown, positionSizing, options.playbook, options.objective);
  const keyRisks = collectDecisionRisks(plan, positionSizing);

  return {
    ...plan,
    positionSizing,
    rankingBreakdown,
    whyItRanked,
    keyRisks,
  };
}

function buildPositionSizing(
  plan: ScreenOptionStrategiesResult['Data'][number],
  options: {
    accountContext?: AccountScreeningContext;
    allowExistingExposureIncrease: boolean;
    maxPortfolioRiskPercent: number;
    maxSymbolExposurePercent: number;
    riskBudget?: number;
    riskBudgetPercent: number;
  },
): PositionSizing {
  const notes: string[] = [];
  const riskPerContract =
    plan.maxLoss ?? (plan.estimatedDebit !== undefined ? plan.estimatedDebit * plan.contractSize : plan.collateralRequired);
  const netValue = options.accountContext?.netValue;
  const maxRiskBudget = options.riskBudget ?? (netValue ? netValue * options.riskBudgetPercent / 100 : undefined);
  const maxPortfolioRisk = netValue ? netValue * options.maxPortfolioRiskPercent / 100 : undefined;
  const maxContracts = riskPerContract && maxRiskBudget
    ? Math.floor(maxRiskBudget / riskPerContract)
    : undefined;
  const symbolExposureBefore = options.accountContext?.symbolExposure[plan.symbol] ?? 0;
  const exposureAdd = estimateSymbolExposure(plan);
  const symbolExposureAfterTrade = symbolExposureBefore + exposureAdd;
  const symbolExposureAfterTradePercent = netValue && symbolExposureAfterTrade
    ? Math.abs(symbolExposureAfterTrade) / netValue * 100
    : undefined;
  const collateralRequired = plan.collateralRequired;
  const collateralBase = options.accountContext?.cashAvailable ?? options.accountContext?.marginAvailable;
  const collateralUsedPercent = collateralRequired && collateralBase
    ? collateralRequired / collateralBase * 100
    : undefined;

  let sizingVerdict: SizingVerdict = 'unknown';
  if (maxRiskBudget === undefined || riskPerContract === undefined || maxContracts === undefined) {
    notes.push('Account sizing is limited because account value or per-contract risk could not be derived.');
  } else if (maxContracts < 1) {
    sizingVerdict = 'too_large';
    notes.push(`Risk per contract ${formatMoney(riskPerContract)} exceeds max risk budget ${formatMoney(maxRiskBudget)}.`);
  } else {
    sizingVerdict = 'pass';
    notes.push(`Up to ${maxContracts} contract(s) fit the configured risk budget.`);
  }

  if (maxPortfolioRisk !== undefined && riskPerContract !== undefined && riskPerContract > maxPortfolioRisk) {
    if (sizingVerdict !== 'too_large') {
      sizingVerdict = 'watchlist';
    }
    notes.push(`Single-contract risk exceeds max portfolio risk setting ${formatMoney(maxPortfolioRisk)}.`);
  }

  if (
    symbolExposureAfterTradePercent !== undefined &&
    symbolExposureAfterTradePercent > options.maxSymbolExposurePercent
  ) {
    sizingVerdict = options.allowExistingExposureIncrease ? 'watchlist' : 'blocked';
    notes.push(`Estimated symbol exposure would be ${round(symbolExposureAfterTradePercent)}%, above ${options.maxSymbolExposurePercent}%.`);
  }

  if (
    plan.strategy === 'cash_secured_put' &&
    collateralRequired !== undefined &&
    collateralBase !== undefined &&
    collateralRequired > collateralBase
  ) {
    sizingVerdict = 'blocked';
    notes.push(`Cash-secured collateral ${formatMoney(collateralRequired)} exceeds available cash/margin ${formatMoney(collateralBase)}.`);
  }

  return {
    maxRiskBudget: roundMoneyLocal(maxRiskBudget),
    maxContracts,
    riskPerContract: roundMoneyLocal(riskPerContract),
    riskBudgetUsedPercent: riskPerContract && maxRiskBudget ? round(riskPerContract / maxRiskBudget * 100) : undefined,
    collateralRequired: roundMoneyLocal(collateralRequired),
    collateralUsedPercent: round(collateralUsedPercent),
    symbolExposureBefore: roundMoneyLocal(symbolExposureBefore),
    symbolExposureAfterTrade: roundMoneyLocal(symbolExposureAfterTrade),
    symbolExposureAfterTradePercent: round(symbolExposureAfterTradePercent),
    sizingVerdict,
    sizingNotes: notes,
  };
}

function buildDecisionBrief(plan: ScreenOptionStrategiesResult['Data'][number]): DecisionBrief {
  const verdict = decisionVerdict(plan);
  const confidence = decisionConfidence(plan);
  return {
    rank: plan.rank,
    symbol: plan.symbol,
    verdict,
    confidence,
    oneLine: oneLineDecision(plan, verdict),
    tradeSummary: tradeSummary(plan),
    whyItRanked: plan.whyItRanked ?? [],
    keyRisks: plan.keyRisks ?? [],
    decisionRules: decisionRules(plan),
    questionsBeforeTrade: questionsBeforeTrade(plan),
    accountFit: plan.positionSizing,
  };
}

function decisionVerdict(plan: ScreenOptionStrategiesResult['Data'][number]): DecisionVerdict {
  if (plan.positionSizing?.sizingVerdict === 'blocked' || plan.positionSizing?.sizingVerdict === 'too_large') {
    return 'reject';
  }
  if ((plan.rankingBreakdown?.finalScore ?? plan.score.total) >= 80 && plan.warnings.length === 0) {
    return 'pass';
  }
  return 'watchlist';
}

function decisionConfidence(plan: ScreenOptionStrategiesResult['Data'][number]): DecisionConfidence {
  const score = plan.rankingBreakdown?.finalScore ?? plan.score.total;
  if (score >= 80 && plan.pricing && plan.positionSizing?.sizingVerdict === 'pass') {
    return 'high';
  }
  if (score >= 60 && plan.positionSizing?.sizingVerdict !== 'unknown') {
    return 'medium';
  }
  return 'low';
}

function oneLineDecision(plan: ScreenOptionStrategiesResult['Data'][number], verdict: DecisionVerdict): string {
  if (verdict === 'reject') {
    return `${plan.symbol} ${labelStrategy(plan.strategy)} is not account-fit under the current sizing constraints.`;
  }
  return `${plan.symbol} ${labelStrategy(plan.strategy)} fits the ${plan.daysToExpiry} DTE window with ${plan.positionSizing?.sizingVerdict ?? 'unknown'} account sizing.`;
}

function tradeSummary(plan: ScreenOptionStrategiesResult['Data'][number]): string {
  const price = plan.estimatedCredit !== undefined
    ? `credit ${formatMoney(plan.estimatedCredit * plan.contractSize)}`
    : plan.estimatedDebit !== undefined
      ? `debit ${formatMoney(plan.estimatedDebit * plan.contractSize)}`
      : 'price unavailable';
  return `${labelStrategy(plan.strategy)} expiring ${plan.expiry} (${plan.daysToExpiry} DTE), ${price}, max loss ${formatMoney(plan.maxLoss)}.`;
}

function explainPlanRanking(
  plan: ScreenOptionStrategiesResult['Data'][number],
  ranking: RankingBreakdown,
  sizing: PositionSizing,
  playbook: StrategyPlaybook,
  objective: TradeObjective,
): string[] {
  const reasons = [
    `Final score ${ranking.finalScore}: base ${ranking.baseScore}, playbook fit ${ranking.playbookFitScore}, account fit ${ranking.accountFitScore}.`,
    `${labelStrategy(plan.strategy)} matches ${playbook} / ${objective} with ${plan.daysToExpiry} DTE.`,
    `Liquidity ${ranking.liquidityScore}, structure ${ranking.structureScore}, context ${ranking.contextScore}.`,
  ];
  if (plan.effectiveContext?.volatility?.summary) {
    reasons.push(plan.effectiveContext.volatility.summary);
  }
  if (plan.screeningContext?.summary) {
    reasons.push(plan.screeningContext.summary);
  }
  if (sizing.sizingVerdict !== 'unknown') {
    reasons.push(`Account sizing verdict: ${sizing.sizingVerdict}.`);
  }
  return reasons;
}

function collectDecisionRisks(
  plan: ScreenOptionStrategiesResult['Data'][number],
  sizing: PositionSizing,
): string[] {
  return Array.from(new Set([
    ...plan.warnings,
    ...(plan.effectiveContext?.riskNotes ?? []),
    ...sizing.sizingNotes.filter(note => sizing.sizingVerdict !== 'pass' || /exceeds|above|limited/i.test(note)),
    plan.maxLoss && plan.maxProfit && plan.maxLoss > plan.maxProfit * 4
      ? 'Max loss is more than 4x max profit; size conservatively.'
      : undefined,
    plan.pricing ? undefined : 'Saxo multi-leg pricing was not available; verify live quotes before acting.',
  ].filter((item): item is string => Boolean(item))));
}

function decisionRules(plan: ScreenOptionStrategiesResult['Data'][number]): string[] {
  const rules = [
    plan.estimatedCredit !== undefined
      ? `Only consider if fill is at ${formatMoney(plan.estimatedCredit * plan.contractSize)} credit or better per contract.`
      : plan.estimatedDebit !== undefined
        ? `Only consider if fill is at ${formatMoney(plan.estimatedDebit * plan.contractSize)} debit or better per contract.`
        : 'Do not consider without a live executable quote.',
    plan.positionSizing?.maxContracts !== undefined
      ? `Do not exceed ${plan.positionSizing.maxContracts} contract(s) under the configured risk budget.`
      : 'Set an explicit risk budget before sizing.',
  ];
  if (plan.estimatedCredit !== undefined) {
    rules.push('For short-premium structures, consider taking profit around 40-60% of max credit.');
  }
  if (plan.breakevens.length) {
    rules.push(`Reassess if underlying moves through breakeven ${plan.breakevens.map(value => String(value)).join(' / ')}.`);
  }
  return rules;
}

function questionsBeforeTrade(plan: ScreenOptionStrategiesResult['Data'][number]): string[] {
  const questions = [
    'Is there an earnings, dividend, or news catalyst before expiry?',
    'Is the live bid/ask still inside the screened spread threshold?',
  ];
  if (plan.strategy === 'cash_secured_put') {
    questions.push('Are you willing to own the underlying at the breakeven price?');
  }
  if (plan.daysToExpiry <= 14) {
    questions.push('Is the short-dated gamma risk acceptable for this account?');
  }
  return questions;
}

function playbookFitScoreForPlan(
  plan: ScreenOptionStrategiesResult['Data'][number],
  ranking: {
    objective: TradeObjective;
    playbook: StrategyPlaybook;
    riskProfile: RiskProfile;
  },
): number {
  return playbookFitScore(plan, ranking);
}

function scoreAccountFit(sizing: PositionSizing): number {
  if (sizing.sizingVerdict === 'pass') return 90;
  if (sizing.sizingVerdict === 'watchlist') return 60;
  if (sizing.sizingVerdict === 'too_large') return 20;
  if (sizing.sizingVerdict === 'blocked') return 0;
  return 45;
}

function estimateSymbolExposure(plan: ScreenOptionStrategiesResult['Data'][number]): number {
  if (plan.collateralRequired !== undefined) {
    return plan.collateralRequired;
  }
  if (plan.maxLoss !== undefined) {
    return plan.maxLoss;
  }
  if (plan.estimatedDebit !== undefined) {
    return plan.estimatedDebit * plan.contractSize;
  }
  return 0;
}

function feedRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value) && Array.isArray(value.Data)) {
    return value.Data.filter(isRecord);
  }
  return [];
}

function summarizeSymbolExposure(rows: Record<string, unknown>[]): Record<string, number> {
  const exposures: Record<string, number> = {};
  for (const row of rows) {
    const symbol = displaySymbol(String(firstStringPath(row, ['Symbol', 'DisplayAndFormat.Symbol', 'PositionBase.Symbol']) ?? ''));
    if (!symbol) {
      continue;
    }
    const exposure = firstNumericPath(row, [
      'PositionView.MarketValue',
      'PositionView.Exposure',
      'PositionBase.MarketValue',
      'MarketValue',
      'Exposure',
      'PositionBase.Amount',
      'Amount',
    ]) ?? 0;
    exposures[symbol] = (exposures[symbol] ?? 0) + Math.abs(exposure);
  }
  return exposures;
}

function firstNumericPath(value: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const found = readPath(value, path);
    if (typeof found === 'number' && Number.isFinite(found)) {
      return Math.abs(found);
    }
    if (typeof found === 'string' && found.trim()) {
      const parsed = Number(found);
      if (Number.isFinite(parsed)) {
        return Math.abs(parsed);
      }
    }
  }
  if (isRecord(value)) {
    for (const path of paths) {
      const key = path.split('.').at(-1)?.toLowerCase();
      const found = findNumberByKey(value, key ?? '');
      if (found !== undefined) {
        return Math.abs(found);
      }
    }
  }
  return undefined;
}

function firstStringPath(value: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const found = readPath(value, path);
    if (typeof found === 'string' && found.trim()) {
      return found;
    }
  }
  return undefined;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[segment];
  }, value);
}

function findNumberByKey(value: Record<string, unknown>, targetKey: string): number | undefined {
  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase() === targetKey) {
      if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
      if (typeof nested === 'string') {
        const parsed = Number(nested);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    if (isRecord(nested)) {
      const found = findNumberByKey(nested, targetKey);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function labelStrategy(strategy: OptionStrategyKind): string {
  return strategy.replace(/_/g, ' ');
}

function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'unknown';
  }
  return `$${roundMoneyLocal(value)?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function roundMoneyLocal(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function riskAdjustedOpenInterest(base: number, riskProfile: RiskProfile): number {
  if (riskProfile === 'conservative') {
    return Math.ceil(base * 1.75);
  }
  if (riskProfile === 'aggressive') {
    return Math.max(1, Math.floor(base * 0.5));
  }
  return base;
}

function riskAdjustedSpread(base: number, riskProfile: RiskProfile): number {
  if (riskProfile === 'conservative') {
    return Math.max(5, Math.round(base * 0.75));
  }
  if (riskProfile === 'aggressive') {
    return Math.min(75, Math.round(base * 1.35));
  }
  return base;
}

function scaleUpLocal(value: number, low: number, high: number): number {
  if (value <= low) {
    return 0;
  }
  if (value >= high) {
    return 100;
  }
  return (value - low) / (high - low) * 100;
}

function scaleDownLocal(value: number, low: number, high: number): number {
  if (value <= low) {
    return 100;
  }
  if (value >= high) {
    return 0;
  }
  return 100 - (value - low) / (high - low) * 100;
}

function midpointLocal(low: number, high: number): number {
  return low + (high - low) / 2;
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}
