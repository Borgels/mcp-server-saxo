import { SaxoHttpError } from '../errors.js';
import type { SaxoClient } from './client.js';
import {
  getMarketFundamentalsContext,
  getMarketNewsContext,
  type MarketFundamentalsContext,
  type MarketContextProvider,
  type MarketNewsContext,
} from './market-context.js';
import { getBalance, listAccounts, listPositions } from './portfolio.js';
import { MARKET_PRESET_EXCHANGES, type MarketScreenMarket } from './screener.js';
import type {
  AccountScreeningContext,
  PositionSizing,
  RiskProfile,
  SizingStatus,
} from './option-strategy-screener.js';

export type StockStrategyObjective =
  | 'core_growth'
  | 'tactical_momentum'
  | 'quality_value'
  | 'defensive'
  | 'balanced';

export type StockUniverse = 'auto' | 'large_cap' | 'movers' | 'watchlist' | 'symbols';

export interface ScreenStockStrategiesInput {
  accountKey?: string;
  market?: Extract<MarketScreenMarket, 'us' | 'us_nasdaq' | 'us_nyse'>;
  symbols?: string[];
  excludeSymbols?: string[];
  universe?: StockUniverse;
  objective?: StockStrategyObjective;
  riskProfile?: RiskProfile;
  maxResults?: number;
  maxCandidates?: number;
  maxTechnicalCandidates?: number;
  includeAccountContext?: boolean;
  riskBudgetPercentPerIdea?: number;
  maxSingleNamePercent?: number;
  allowExistingExposureIncrease?: boolean;
  includeTechnicalContext?: boolean;
  includeFundamentalContext?: boolean;
  fundamentalProvider?: MarketContextProvider;
  fundamentalsLimit?: number;
  includeNewsContext?: boolean;
  newsProvider?: MarketContextProvider;
  newsLookbackDays?: number;
  newsLimit?: number;
  technicalHorizon?: number;
  technicalBars?: number;
  externalContextBySymbol?: Record<string, StockExternalContext>;
}

export interface StockExternalContext {
  summary?: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
  riskNotes?: string[];
  news?: MarketNewsContext;
  fundamentals?: MarketFundamentalsContext;
}

export interface StockTechnicalContext {
  source: 'saxo_chart';
  horizon: number;
  bars: number;
  bias: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  riskNotes: string[];
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

export interface StockFactorScores {
  liquidityScore: number;
  trendScore: number;
  volatilityScore: number;
  contextScore: number;
  objectiveFitScore: number;
  accountFitScore: number;
}

export interface StockStrategyCandidate {
  rank: number;
  symbol: string;
  uic: number;
  assetType: string;
  description?: string;
  exchangeId?: string;
  currencyCode?: string;
  bid?: number;
  ask?: number;
  mid?: number;
  lastTraded?: number;
  lastClose?: number;
  volume?: number;
  percentChange?: number;
  delayedByMinutes?: number;
  technicalContext?: StockTechnicalContext;
  newsContext?: MarketNewsContext;
  fundamentalsContext?: MarketFundamentalsContext;
  externalContext?: StockExternalContext;
  positionSizing?: PositionSizing;
  factorScores: StockFactorScores;
  factorSummary: string[];
  keyRisks: string[];
}

export interface ScreenStockStrategiesResult {
  generatedAt: string;
  filters: {
    market: string;
    universe: StockUniverse;
    objective: StockStrategyObjective;
    riskProfile: RiskProfile;
    maxResults: number;
    maxCandidates: number;
    maxTechnicalCandidates: number;
    includeAccountContext: boolean;
    riskBudgetPercentPerIdea: number;
    maxSingleNamePercent: number;
    allowExistingExposureIncrease: boolean;
    includeTechnicalContext: boolean;
    includeFundamentalContext: boolean;
    fundamentalProvider: MarketContextProvider;
    fundamentalsLimit: number;
    includeNewsContext: boolean;
    newsProvider: MarketContextProvider;
    newsLookbackDays: number;
    newsLimit: number;
    technicalHorizon: number;
    technicalBars: number;
  };
  counters: {
    candidatesConsidered: number;
    candidatesScored: number;
    returnedCandidates: number;
  };
  warnings: string[];
  accountContext?: AccountScreeningContext;
  constraintLimitedCandidates: StockStrategyCandidate[];
  Data: StockStrategyCandidate[];
}

interface CandidateInstrument {
  assetType: string;
  currencyCode?: string;
  description?: string;
  exchangeId?: string;
  symbol: string;
  uic: number;
}

interface InfoPriceResponse {
  AssetType?: string;
  DisplayAndFormat?: {
    Description?: string;
    Symbol?: string;
  };
  ErrorCode?: string;
  HistoricalChanges?: {
    PercentChangeDaily?: number;
  };
  InstrumentPriceDetails?: {
    IsMarketOpen?: boolean;
  };
  PriceInfo?: {
    NetChange?: number;
    PercentChange?: number;
  };
  PriceInfoDetails?: {
    LastClose?: number;
    LastTraded?: number;
    Volume?: number;
  };
  Quote?: {
    Ask?: number;
    Bid?: number;
    DelayedByMinutes?: number;
    ErrorCode?: string;
    Mid?: number;
  };
  Uic?: number;
}

interface InstrumentSummary {
  AssetType?: string;
  CurrencyCode?: string;
  Description?: string;
  ExchangeId?: string;
  Identifier?: number;
  SummaryType?: string;
  Symbol?: string;
}

interface Feed<T> {
  Data?: T[];
}

interface ChartResponse {
  Data?: ChartBar[];
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
}

interface OhlcBar {
  close: number;
  high?: number;
  low?: number;
}

const INFO_PRICE_FIELD_GROUPS = [
  'DisplayAndFormat',
  'PriceInfo',
  'PriceInfoDetails',
  'HistoricalChanges',
  'Quote',
  'InstrumentPriceDetails',
].join(',');

export async function screenStockStrategies(
  client: SaxoClient,
  input: ScreenStockStrategiesInput,
  now: Date = new Date(),
): Promise<ScreenStockStrategiesResult> {
  const warnings: string[] = [];
  const market = input.market ?? 'us';
  const universe = input.universe ?? (input.symbols?.length ? 'symbols' : 'auto');
  const objective = input.objective ?? 'balanced';
  const riskProfile = input.riskProfile ?? 'balanced';
  const maxResults = clampInt(input.maxResults ?? 10, 1, 25);
  const maxCandidates = clampInt(input.maxCandidates ?? 120, 1, 500);
  const maxTechnicalCandidates = clampInt(
    input.maxTechnicalCandidates ?? Math.min(maxCandidates, Math.max(maxResults * 3, 25)),
    0,
    100,
  );
  const includeAccountContext = input.includeAccountContext ?? true;
  const riskBudgetPercentPerIdea = clampNumber(input.riskBudgetPercentPerIdea ?? 1, 0.01, 100);
  const maxSingleNamePercent = clampNumber(input.maxSingleNamePercent ?? 10, 0.1, 100);
  const allowExistingExposureIncrease = input.allowExistingExposureIncrease ?? false;
  const includeTechnicalContext = input.includeTechnicalContext ?? true;
  const includeFundamentalContext = input.includeFundamentalContext ?? true;
  const fundamentalProvider = input.fundamentalProvider ?? 'auto';
  const fundamentalsLimit = clampInt(input.fundamentalsLimit ?? Math.min(maxResults * 2, 12), 0, 50);
  const includeNewsContext = input.includeNewsContext ?? false;
  const newsProvider = input.newsProvider ?? 'auto';
  const newsLookbackDays = clampInt(input.newsLookbackDays ?? 7, 1, 30);
  const newsLimit = clampInt(input.newsLimit ?? 10, 1, 50);
  const technicalHorizon = clampInt(input.technicalHorizon ?? 1440, 1, 10080);
  const technicalBars = clampInt(input.technicalBars ?? 90, 20, 1200);
  const excludeSymbols = new Set((input.excludeSymbols ?? []).map(symbolKeyword));

  let accountContext: AccountScreeningContext | undefined;
  if (includeAccountContext && !input.accountKey) {
    warnings.push('Account context skipped because accountKey was not supplied.');
  }
  if (includeAccountContext && input.accountKey) {
    accountContext = await buildAccountContext(client, { accountKey: input.accountKey, warnings });
  }

  const candidates = await resolveCandidates(client, {
    accountKey: input.accountKey,
    market,
    maxCandidates,
    symbols: input.symbols,
    universe,
    warnings,
  });

  const candidatePool = candidates.filter(candidate => !excludeSymbols.has(symbolKeyword(candidate.symbol)));
  const pricesByUic = await fetchStockPrices(client, candidatePool, input.accountKey, warnings);
  const preliminary: StockStrategyCandidate[] = [];

  for (const candidate of candidatePool) {
    const price = pricesByUic.get(candidate.uic);
    const row = price ? toCandidateRow(candidate, price) : undefined;
    if (!row) {
      warnings.push(`${candidate.symbol}: skipped because Saxo did not return usable quote data.`);
      continue;
    }

    const externalContext = input.externalContextBySymbol?.[symbolKeyword(row.symbol)];
    const enriched = enrichStockDecisionSupport(row, {
      accountContext,
      allowExistingExposureIncrease,
      externalContext,
      fundamentalsContext: externalContext?.fundamentals,
      maxSingleNamePercent,
      newsContext: externalContext?.news,
      objective,
      riskBudgetPercentPerIdea,
      riskProfile,
      technicalContext: undefined,
    });
    preliminary.push(enriched);
  }

  const prelimRanked = preliminary
    .sort((a, b) => stockFactorSortScore(b.factorScores) - stockFactorSortScore(a.factorScores))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const enrichedBySymbol = new Map<string, StockStrategyCandidate>();
  const enrichmentLimit = Math.max(maxResults, fundamentalsLimit, maxTechnicalCandidates);
  for (const candidate of prelimRanked.slice(0, enrichmentLimit)) {
    const technicalContext = includeTechnicalContext && enrichedBySymbol.size < maxTechnicalCandidates
      ? await buildTechnicalContext(client, candidate, {
        accountKey: input.accountKey,
        bars: technicalBars,
        horizon: technicalHorizon,
        now,
        warnings,
      })
      : candidate.technicalContext;
    const newsContext = includeNewsContext
      ? await buildNewsContext(candidate.symbol, {
        lookbackDays: newsLookbackDays,
        newsLimit,
        now,
        provider: newsProvider,
        warnings,
      })
      : candidate.newsContext;
    const fundamentalsContext = includeFundamentalContext && enrichedBySymbol.size < fundamentalsLimit
      ? await buildFundamentalsContext(candidate.symbol, {
        now,
        provider: fundamentalProvider,
        warnings,
      })
      : candidate.fundamentalsContext;
    const externalContext = input.externalContextBySymbol?.[symbolKeyword(candidate.symbol)];
    enrichedBySymbol.set(symbolKeyword(candidate.symbol), enrichStockDecisionSupport(candidate, {
      accountContext,
      allowExistingExposureIncrease,
      externalContext,
      fundamentalsContext: fundamentalsContext ?? externalContext?.fundamentals,
      maxSingleNamePercent,
      newsContext: newsContext ?? externalContext?.news,
      objective,
      riskBudgetPercentPerIdea,
      riskProfile,
      technicalContext,
    }));
  }
  const finalCandidates = preliminary.map(candidate => enrichedBySymbol.get(symbolKeyword(candidate.symbol)) ?? candidate);
  const screened = finalCandidates.filter(candidate =>
    candidate.positionSizing?.sizingStatus !== 'blocked_by_constraint' && candidate.positionSizing?.sizingStatus !== 'over_budget',
  );
  const deferred = finalCandidates.filter(candidate =>
    candidate.positionSizing?.sizingStatus === 'blocked_by_constraint' || candidate.positionSizing?.sizingStatus === 'over_budget',
  );
  const ranked = screened
    .sort((a, b) => stockFactorSortScore(b.factorScores) - stockFactorSortScore(a.factorScores))
    .slice(0, maxResults)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const constraintLimitedCandidates = deferred
    .sort((a, b) => stockFactorSortScore(b.factorScores) - stockFactorSortScore(a.factorScores))
    .slice(0, maxResults)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return {
    generatedAt: now.toISOString(),
    filters: {
      market,
      universe,
      objective,
      riskProfile,
      maxResults,
      maxCandidates,
      maxTechnicalCandidates,
      includeAccountContext,
      riskBudgetPercentPerIdea,
      maxSingleNamePercent,
      allowExistingExposureIncrease,
      includeTechnicalContext,
      includeFundamentalContext,
      fundamentalProvider,
      fundamentalsLimit,
      includeNewsContext,
      newsProvider,
      newsLookbackDays,
      newsLimit,
      technicalHorizon,
      technicalBars,
    },
    counters: {
      candidatesConsidered: candidates.length,
      candidatesScored: finalCandidates.length,
      returnedCandidates: ranked.length,
    },
    warnings,
    accountContext,
    constraintLimitedCandidates,
    Data: ranked,
  };
}

async function resolveCandidates(
  client: SaxoClient,
  input: {
    accountKey?: string;
    market: Extract<MarketScreenMarket, 'us' | 'us_nasdaq' | 'us_nyse'>;
    maxCandidates: number;
    symbols?: string[];
    universe: StockUniverse;
    warnings: string[];
  },
): Promise<CandidateInstrument[]> {
  if (input.symbols?.length) {
    const resolved: CandidateInstrument[] = [];
    for (const symbol of input.symbols) {
      const instrument = await resolveStockSymbol(client, symbol, input.accountKey);
      if (instrument) {
        resolved.push(instrument);
      } else {
        input.warnings.push(`${symbol}: no tradable Stock instrument found.`);
      }
    }
    return dedupeCandidates(resolved).slice(0, input.maxCandidates);
  }

  if (input.universe === 'watchlist') {
    input.warnings.push('universe=watchlist requires symbols in v1; falling back to Saxo market scan.');
  }
  if (input.universe === 'large_cap') {
    input.warnings.push('Saxo market-cap fields are not available in this MCP flow; large_cap is proxied by liquid USD stock candidates.');
  }

  const exchangeIds = MARKET_PRESET_EXCHANGES[input.market];
  const candidates: CandidateInstrument[] = [];
  const perExchangeLimit = Math.max(1, Math.ceil(input.maxCandidates / exchangeIds.length));
  for (const exchangeId of exchangeIds) {
    let skip = 0;
    while (candidates.length < input.maxCandidates && skip < perExchangeLimit) {
      const top = Math.min(100, perExchangeLimit - skip, input.maxCandidates - candidates.length);
      const response = await client.get<Feed<InstrumentSummary>>('/ref/v1/instruments', {
        AccountKey: input.accountKey,
        AssetTypes: 'Stock',
        ExchangeId: exchangeId,
        IncludeNonTradable: false,
        $skip: skip,
        $top: top,
      });
      const page = response.Data ?? [];
      candidates.push(...page.map(toCandidateInstrument).filter(isDefined));
      if (page.length < top) {
        break;
      }
      skip += page.length;
    }
  }
  return dedupeCandidates(candidates).slice(0, input.maxCandidates);
}

async function resolveStockSymbol(
  client: SaxoClient,
  symbol: string,
  accountKey: string | undefined,
): Promise<CandidateInstrument | undefined> {
  const keyword = symbolKeyword(symbol);
  const response = await client.get<Feed<InstrumentSummary>>('/ref/v1/instruments', {
    AccountKey: accountKey,
    AssetTypes: 'Stock',
    Keywords: keyword,
    IncludeNonTradable: false,
    $top: 25,
  });
  return (response.Data ?? [])
    .map(toCandidateInstrument)
    .filter(isDefined)
    .filter(candidate => symbolKeyword(candidate.symbol) === keyword)
    .sort((a, b) => stockInstrumentScore(b, keyword) - stockInstrumentScore(a, keyword))[0];
}

async function fetchStockPrices(
  client: SaxoClient,
  candidates: CandidateInstrument[],
  accountKey: string | undefined,
  warnings: string[],
): Promise<Map<number, InfoPriceResponse>> {
  const prices = new Map<number, InfoPriceResponse>();
  for (const batch of chunk(candidates, 100)) {
    try {
      const response = await client.get<Feed<InfoPriceResponse>>('/trade/v1/infoprices/list', {
        AccountKey: accountKey,
        AssetType: 'Stock',
        FieldGroups: INFO_PRICE_FIELD_GROUPS,
        Uics: batch.map(candidate => candidate.uic).join(','),
      });
      for (const price of response.Data ?? []) {
        if (typeof price.Uic === 'number') {
          prices.set(price.Uic, price);
        }
      }
    } catch (error) {
      warnings.push(`Stock price batch unavailable: ${formatScreenError(error)}`);
      if (error instanceof SaxoHttpError && error.status === 429) {
        warnings.push('Stopped stock screening early after Saxo rate limit; retry with lower maxCandidates/maxTechnicalCandidates or after the rate window resets.');
        break;
      }
    }
  }
  return prices;
}

function toCandidateInstrument(summary: InstrumentSummary): CandidateInstrument | undefined {
  if (typeof summary.Identifier !== 'number' || summary.AssetType !== 'Stock' || !summary.Symbol) {
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

function toCandidateRow(
  candidate: CandidateInstrument,
  price: InfoPriceResponse,
): Omit<StockStrategyCandidate, 'rank' | 'factorScores' | 'factorSummary' | 'keyRisks'> | undefined {
  if (price.ErrorCode || price.Quote?.ErrorCode && price.Quote.ErrorCode !== 'None') {
    return undefined;
  }
  const bid = price.Quote?.Bid;
  const ask = price.Quote?.Ask;
  const mid = price.Quote?.Mid ?? midpoint(bid, ask) ?? price.PriceInfoDetails?.LastTraded;
  const lastTraded = price.PriceInfoDetails?.LastTraded ?? mid;
  if (!mid && !lastTraded) {
    return undefined;
  }
  return {
    symbol: displaySymbol(price.DisplayAndFormat?.Symbol ?? candidate.symbol),
    uic: candidate.uic,
    assetType: candidate.assetType,
    description: price.DisplayAndFormat?.Description ?? candidate.description,
    exchangeId: candidate.exchangeId,
    currencyCode: candidate.currencyCode,
    bid,
    ask,
    mid,
    lastTraded,
    lastClose: price.PriceInfoDetails?.LastClose,
    volume: price.PriceInfoDetails?.Volume,
    percentChange: price.PriceInfo?.PercentChange ?? price.HistoricalChanges?.PercentChangeDaily,
    delayedByMinutes: price.Quote?.DelayedByMinutes,
  };
}

async function buildTechnicalContext(
  client: SaxoClient,
  candidate: Pick<StockStrategyCandidate, 'assetType' | 'symbol' | 'uic'>,
  options: {
    accountKey?: string;
    horizon: number;
    bars: number;
    now: Date;
    warnings: string[];
  },
): Promise<StockTechnicalContext | undefined> {
  try {
    const response = await client.get<ChartResponse>('/chart/v3/charts', {
      AccountKey: options.accountKey,
      Uic: candidate.uic,
      AssetType: candidate.assetType,
      Horizon: options.horizon,
      Count: options.bars,
      Mode: 'UpTo',
      Time: options.now.toISOString(),
    });
    const bars = (response.Data ?? []).map(toOhlcBar).filter(isDefined);
    return analyzeTechnicalContext(bars, {
      horizon: options.horizon,
      requestedBars: options.bars,
      symbol: candidate.symbol,
    });
  } catch (error) {
    options.warnings.push(`${candidate.symbol}: technical context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

async function buildNewsContext(
  symbol: string,
  options: {
    lookbackDays: number;
    newsLimit: number;
    now: Date;
    provider: MarketContextProvider;
    warnings: string[];
  },
): Promise<MarketNewsContext | undefined> {
  try {
    const context = await getMarketNewsContext({
      lookbackDays: options.lookbackDays,
      newsLimit: options.newsLimit,
      now: options.now,
      provider: options.provider,
      symbol,
    });
    if (!context && options.provider !== 'none') {
      options.warnings.push(`${symbol}: news context skipped because no enabled provider/key was configured.`);
    }
    return context;
  } catch (error) {
    options.warnings.push(`${symbol}: news context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

async function buildFundamentalsContext(
  symbol: string,
  options: {
    now: Date;
    provider: MarketContextProvider;
    warnings: string[];
  },
): Promise<MarketFundamentalsContext | undefined> {
  try {
    const context = await getMarketFundamentalsContext({
      now: options.now,
      provider: options.provider,
      symbol,
    });
    if (!context && options.provider !== 'none') {
      options.warnings.push(`${symbol}: fundamentals context skipped because no enabled provider/key was configured.`);
    }
    return context;
  } catch (error) {
    options.warnings.push(`${symbol}: fundamentals context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

function enrichStockDecisionSupport(
  base: Omit<StockStrategyCandidate, 'rank' | 'factorScores' | 'factorSummary' | 'keyRisks'>,
  options: {
    accountContext?: AccountScreeningContext;
    allowExistingExposureIncrease: boolean;
    externalContext?: StockExternalContext;
    fundamentalsContext?: MarketFundamentalsContext;
    maxSingleNamePercent: number;
    newsContext?: MarketNewsContext;
    objective: StockStrategyObjective;
    riskBudgetPercentPerIdea: number;
    riskProfile: RiskProfile;
    technicalContext?: StockTechnicalContext;
  },
): StockStrategyCandidate {
  const positionSizing = buildStockPositionSizing(base, options);
  const factorScores = buildFactorScores(base, {
    accountFitScore: scoreAccountFit(positionSizing),
    externalContext: options.externalContext,
    fundamentalsContext: options.fundamentalsContext,
    newsContext: options.newsContext,
    objective: options.objective,
    riskProfile: options.riskProfile,
    technicalContext: options.technicalContext,
  });
  const keyRisks = collectKeyRisks(
    base,
    options.technicalContext,
    options.newsContext,
    options.fundamentalsContext,
    options.externalContext,
    positionSizing,
  );
  const factorSummary = explainFactors(
    base,
    factorScores,
    options.objective,
    options.technicalContext,
    options.newsContext,
    options.fundamentalsContext,
    positionSizing,
  );
  return {
    ...base,
    externalContext: options.externalContext,
    fundamentalsContext: options.fundamentalsContext,
    keyRisks,
    newsContext: options.newsContext,
    positionSizing,
    factorScores,
    technicalContext: options.technicalContext,
    factorSummary,
    rank: 0,
  };
}

function buildStockPositionSizing(
  candidate: Pick<StockStrategyCandidate, 'lastTraded' | 'mid' | 'symbol'>,
  options: {
    accountContext?: AccountScreeningContext;
    allowExistingExposureIncrease: boolean;
    maxSingleNamePercent: number;
    riskBudgetPercentPerIdea: number;
  },
): PositionSizing {
  const notes: string[] = [];
  const price = candidate.mid ?? candidate.lastTraded;
  const netValue = options.accountContext?.netValue;
  const maxRiskBudget = netValue ? netValue * options.riskBudgetPercentPerIdea / 100 : undefined;
  const maxSingleNameDollars = netValue ? netValue * options.maxSingleNamePercent / 100 : undefined;
  const symbolExposureBefore = options.accountContext?.symbolExposure[symbolKeyword(candidate.symbol)] ?? 0;
  const availableForSymbol = maxSingleNameDollars !== undefined
    ? Math.max(0, maxSingleNameDollars - symbolExposureBefore)
    : undefined;
  const effectiveBudget = minDefined(maxRiskBudget, availableForSymbol);
  const maxShares = price && effectiveBudget !== undefined ? Math.floor(effectiveBudget / price) : undefined;
  const notional = maxShares !== undefined && price ? maxShares * price : undefined;
  const symbolExposureAfterTrade = notional !== undefined ? symbolExposureBefore + notional : symbolExposureBefore;
  const symbolExposureAfterTradePercent = netValue && symbolExposureAfterTrade
    ? Math.abs(symbolExposureAfterTrade) / netValue * 100
    : undefined;
  let sizingStatus: SizingStatus = 'unknown';

  if (!netValue || !price || effectiveBudget === undefined || maxShares === undefined) {
    notes.push('Account sizing is limited because account value or live stock price could not be derived.');
  } else if (maxShares < 1) {
    sizingStatus = 'over_budget';
    notes.push(`Configured risk budget cannot buy one share at ${formatMoney(price)}.`);
  } else {
    sizingStatus = 'fits';
    notes.push(`Up to ${maxShares} share(s) fit the configured per-idea budget and concentration cap.`);
  }

  if (
    symbolExposureAfterTradePercent !== undefined &&
    symbolExposureAfterTradePercent > options.maxSingleNamePercent
  ) {
    sizingStatus = options.allowExistingExposureIncrease ? 'limited' : 'blocked_by_constraint';
    notes.push(`Estimated symbol exposure would be ${round(symbolExposureAfterTradePercent)}%, above ${options.maxSingleNamePercent}%.`);
  }

  return {
    maxRiskBudget: roundMoney(maxRiskBudget),
    maxContracts: maxShares,
    riskPerContract: roundMoney(price),
    riskBudgetUsedPercent: notional && maxRiskBudget ? round(notional / maxRiskBudget * 100) : undefined,
    collateralRequired: roundMoney(notional),
    collateralUsedPercent: undefined,
    symbolExposureBefore: roundMoney(symbolExposureBefore),
    symbolExposureAfterTrade: roundMoney(symbolExposureAfterTrade),
    symbolExposureAfterTradePercent: round(symbolExposureAfterTradePercent),
    sizingStatus,
    sizingNotes: notes,
  };
}

function buildFactorScores(
  candidate: Pick<StockStrategyCandidate, 'bid' | 'ask' | 'lastTraded' | 'mid' | 'percentChange' | 'volume'>,
  options: {
    accountFitScore: number;
    externalContext?: StockExternalContext;
    fundamentalsContext?: MarketFundamentalsContext;
    newsContext?: MarketNewsContext;
    objective: StockStrategyObjective;
    riskProfile: RiskProfile;
    technicalContext?: StockTechnicalContext;
  },
): StockFactorScores {
  const liquidityScore = scoreLiquidity(candidate);
  const trendScore = scoreTrend(options.technicalContext, candidate.percentChange, options.objective);
  const volatilityScore = scoreVolatility(options.technicalContext, options.riskProfile);
  const contextScore = scoreContext(options.newsContext, options.fundamentalsContext, options.externalContext);
  const objectiveFitScore = scoreObjectiveFit({
    fundamentalsContext: options.fundamentalsContext,
    objective: options.objective,
    riskProfile: options.riskProfile,
    technicalContext: options.technicalContext,
    percentChange: candidate.percentChange,
  });
  return {
    liquidityScore,
    trendScore,
    volatilityScore,
    contextScore,
    objectiveFitScore,
    accountFitScore: options.accountFitScore,
  };
}

function stockFactorSortScore(factors: StockFactorScores): number {
  return clampScore(
    factors.liquidityScore * 0.25 +
    factors.trendScore * 0.2 +
    factors.volatilityScore * 0.15 +
    factors.contextScore * 0.1 +
    factors.objectiveFitScore * 0.2 +
    factors.accountFitScore * 0.1,
  );
}

function scoreLiquidity(candidate: Pick<StockStrategyCandidate, 'ask' | 'bid' | 'mid' | 'volume'>): number {
  const spreadPercent = candidate.ask && candidate.bid && candidate.mid
    ? (candidate.ask - candidate.bid) / candidate.mid * 100
    : undefined;
  const spreadScore = spreadPercent === undefined ? 45 : 100 - scaleUp(spreadPercent, 0.05, 2) * 100;
  const volumeScore = scaleUp(candidate.volume ?? 0, 50_000, 2_000_000) * 100;
  return clampScore(spreadScore * 0.55 + volumeScore * 0.45);
}

function scoreTrend(
  technicalContext: StockTechnicalContext | undefined,
  percentChange: number | undefined,
  objective: StockStrategyObjective,
): number {
  const return20 = technicalContext?.metrics.return20dPercent;
  const distance20 = technicalContext?.metrics.distanceToSma20Percent;
  if (objective === 'tactical_momentum') {
    return clampScore(50 + (return20 ?? percentChange ?? 0) * 2 + (distance20 ?? 0));
  }
  if (objective === 'defensive') {
    return clampScore(80 - Math.abs(return20 ?? percentChange ?? 0) * 1.5);
  }
  return clampScore(55 + (return20 ?? 0) * 1.2 + (distance20 ?? 0) * 0.8);
}

function scoreVolatility(
  technicalContext: StockTechnicalContext | undefined,
  riskProfile: RiskProfile,
): number {
  const vol = technicalContext?.metrics.annualizedVolatilityPercent;
  if (vol === undefined) {
    return 50;
  }
  const target = riskProfile === 'aggressive' ? 70 : riskProfile === 'conservative' ? 25 : 45;
  const distance = Math.abs(vol - target);
  return clampScore(100 - distance * (riskProfile === 'conservative' ? 1.6 : 1.1));
}

function scoreContext(
  newsContext: MarketNewsContext | undefined,
  fundamentalsContext: MarketFundamentalsContext | undefined,
  externalContext: StockExternalContext | undefined,
): number {
  const sentiment = externalContext?.sentiment ?? sentimentFromNews(newsContext);
  const capScore = scoreMarketCap(fundamentalsContext);
  if (sentiment === 'bullish') return 80;
  if (sentiment === 'neutral') return Math.round((60 + capScore) / 2);
  if (sentiment === 'bearish') return Math.round((35 + capScore) / 2);
  return newsContext?.headlineCount ? Math.round((55 + capScore) / 2) : capScore;
}

function scoreObjectiveFit(input: {
  fundamentalsContext?: MarketFundamentalsContext;
  objective: StockStrategyObjective;
  percentChange?: number;
  riskProfile: RiskProfile;
  technicalContext?: StockTechnicalContext;
}): number {
  const bias = input.technicalContext?.bias;
  const volatility = input.technicalContext?.metrics.annualizedVolatilityPercent;
  const bucket = input.fundamentalsContext?.marketCapBucket;
  const move = Math.abs(input.percentChange ?? 0);
  const marketCapBonus = bucket === 'mega' ? 12 : bucket === 'large' ? 10 : bucket === 'mid' ? 4 : bucket === 'small' || bucket === 'micro' ? -18 : 0;
  if (input.objective === 'defensive') {
    return clampScore(80 + marketCapBonus - move * 3 - Math.max(0, (volatility ?? 35) - 35));
  }
  if (input.objective === 'tactical_momentum') {
    return clampScore((bias === 'bullish' ? 75 : 45) + move * 2);
  }
  if (input.objective === 'quality_value') {
    return clampScore((bias === 'bearish' ? 45 : 65) + marketCapBonus + (volatility && volatility < 45 ? 15 : 0));
  }
  if (input.objective === 'core_growth') {
    return clampScore((bias === 'bullish' ? 80 : 55) + marketCapBonus - Math.max(0, (volatility ?? 40) - 55) * 0.8);
  }
  return clampScore((bias === 'bearish' ? 45 : 65) + marketCapBonus * 0.5 + (input.riskProfile === 'aggressive' ? move : -move) * 0.8);
}

function scoreMarketCap(fundamentalsContext: MarketFundamentalsContext | undefined): number {
  if (!fundamentalsContext) return 50;
  if (fundamentalsContext.marketCapBucket === 'mega') return 90;
  if (fundamentalsContext.marketCapBucket === 'large') return 82;
  if (fundamentalsContext.marketCapBucket === 'mid') return 62;
  if (fundamentalsContext.marketCapBucket === 'small') return 38;
  if (fundamentalsContext.marketCapBucket === 'micro') return 20;
  return 50;
}

function scoreAccountFit(sizing: PositionSizing | undefined): number {
  if (!sizing) return 45;
  if (sizing.sizingStatus === 'fits') return 90;
  if (sizing.sizingStatus === 'limited') return 60;
  if (sizing.sizingStatus === 'over_budget') return 20;
  if (sizing.sizingStatus === 'blocked_by_constraint') return 0;
  return 45;
}

function explainFactors(
  candidate: Pick<StockStrategyCandidate, 'symbol'>,
  ranking: StockFactorScores,
  objective: StockStrategyObjective,
  technicalContext: StockTechnicalContext | undefined,
  newsContext: MarketNewsContext | undefined,
  fundamentalsContext: MarketFundamentalsContext | undefined,
  sizing: PositionSizing | undefined,
): string[] {
  return [
    `Factor scores: liquidity ${ranking.liquidityScore}, trend ${ranking.trendScore}, volatility ${ranking.volatilityScore}, objective fit ${ranking.objectiveFitScore}, account fit ${ranking.accountFitScore}.`,
    `${candidate.symbol} factor context for ${objective}.`,
    fundamentalsContext?.summary,
    technicalContext?.summary,
    newsContext?.summary,
    sizing?.sizingStatus !== 'unknown' ? `Account sizing status: ${sizing?.sizingStatus}.` : undefined,
  ].filter(isDefined);
}

function collectKeyRisks(
  candidate: Pick<StockStrategyCandidate, 'ask' | 'bid' | 'mid' | 'percentChange' | 'symbol'>,
  technicalContext: StockTechnicalContext | undefined,
  newsContext: MarketNewsContext | undefined,
  fundamentalsContext: MarketFundamentalsContext | undefined,
  externalContext: StockExternalContext | undefined,
  sizing: PositionSizing | undefined,
): string[] {
  const risks = new Set<string>();
  for (const note of technicalContext?.riskNotes ?? []) risks.add(note);
  for (const note of newsContext?.riskNotes ?? []) risks.add(note);
  for (const note of fundamentalsContext?.riskNotes ?? []) risks.add(note);
  for (const note of externalContext?.riskNotes ?? []) risks.add(note);
  for (const note of sizing?.sizingNotes ?? []) {
    if (sizing?.sizingStatus !== 'fits' || /limited|above|cannot|exceeds/i.test(note)) {
      risks.add(note);
    }
  }
  const spreadPercent = candidate.ask && candidate.bid && candidate.mid
    ? (candidate.ask - candidate.bid) / candidate.mid * 100
    : undefined;
  if ((spreadPercent ?? 0) > 1) {
    risks.add(`Wide stock quote spread around ${round(spreadPercent)}%; use limit orders and verify live liquidity.`);
  }
  if (Math.abs(candidate.percentChange ?? 0) > 8) {
    risks.add('Large daily move; avoid chasing without a clear catalyst and invalidation level.');
  }
  if (!risks.size) {
    risks.add('No single data point is sufficient; verify current quote, catalyst calendar, and portfolio fit before trading.');
  }
  return Array.from(risks);
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
): StockTechnicalContext | undefined {
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
  const bias = inferTechnicalBias({ distanceToSma20Percent, distanceToSma50Percent, return20dPercent, sma20, sma50 });

  return {
    source: 'saxo_chart',
    horizon: options.horizon,
    bars: bars.length,
    bias,
    summary: [
      `${options.symbol} Saxo chart bias is ${bias}.`,
      formatMetric('20d return', return20dPercent, '%'),
      formatMetric('distance to SMA20', distanceToSma20Percent, '%'),
      formatMetric('realized volatility', annualizedVolatilityPercent, '% annualized'),
    ].filter(isDefined).join(' '),
    riskNotes: technicalRiskNotes({ annualizedVolatilityPercent, averageRange14dPercent, return5dPercent, return20dPercent, bias }),
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

function inferTechnicalBias(input: {
  distanceToSma20Percent?: number;
  distanceToSma50Percent?: number;
  return20dPercent?: number;
  sma20?: number;
  sma50?: number;
}): 'bullish' | 'bearish' | 'neutral' {
  const aboveTrend =
    (input.distanceToSma20Percent ?? 0) > 1 &&
    (input.distanceToSma50Percent ?? 0) > 1 &&
    (input.return20dPercent ?? 0) > 2 &&
    (!input.sma20 || !input.sma50 || input.sma20 >= input.sma50 * 0.995);
  if (aboveTrend) return 'bullish';
  const belowTrend =
    (input.distanceToSma20Percent ?? 0) < -1 &&
    (input.distanceToSma50Percent ?? 0) < -1 &&
    (input.return20dPercent ?? 0) < -2 &&
    (!input.sma20 || !input.sma50 || input.sma20 <= input.sma50 * 1.005);
  if (belowTrend) return 'bearish';
  return 'neutral';
}

function technicalRiskNotes(input: {
  annualizedVolatilityPercent?: number;
  averageRange14dPercent?: number;
  bias: 'bullish' | 'bearish' | 'neutral';
  return5dPercent?: number;
  return20dPercent?: number;
}): string[] {
  const notes: string[] = [];
  if ((input.annualizedVolatilityPercent ?? 0) >= 75) {
    notes.push('High realized volatility; size smaller and avoid treating it as a core holding without review.');
  }
  if ((input.averageRange14dPercent ?? 0) >= 5) {
    notes.push('Wide recent daily ranges; use staged entries instead of a single full allocation.');
  }
  if (Math.abs(input.return5dPercent ?? 0) >= 10) {
    notes.push('Large 5-day move; watch reversal and gap risk.');
  }
  if (input.bias !== 'neutral' && Math.abs(input.return20dPercent ?? 0) >= 20) {
    notes.push('Extended 20-day move; entry may be late for a fresh directional position.');
  }
  return notes;
}

function sentimentFromNews(newsContext: MarketNewsContext | undefined): 'bullish' | 'bearish' | 'neutral' | undefined {
  if (newsContext?.sentiment === 'bullish' || newsContext?.sentiment === 'bearish') {
    return newsContext.sentiment;
  }
  if (newsContext?.sentiment === 'neutral' || newsContext?.sentiment === 'mixed') {
    return 'neutral';
  }
  return undefined;
}

function stockInstrumentScore(stock: CandidateInstrument, keyword: string): number {
  const symbol = symbolKeyword(stock.symbol);
  return (
    (symbol === keyword ? 100 : 0) +
    (symbol.startsWith(keyword) ? 10 : 0) +
    (stock.exchangeId === 'NASDAQ' || stock.exchangeId === 'NYSE' ? 30 : 0) +
    (stock.currencyCode === 'USD' ? 20 : 0)
  );
}

function dedupeCandidates(candidates: CandidateInstrument[]): CandidateInstrument[] {
  const seen = new Set<string>();
  const deduped: CandidateInstrument[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.assetType}:${candidate.uic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function formatScreenError(error: unknown): string {
  if (error instanceof SaxoHttpError) {
    return `Saxo HTTP ${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function summarizeSymbolExposure(rows: Record<string, unknown>[]): Record<string, number> {
  const exposures: Record<string, number> = {};
  for (const row of rows) {
    const symbol = symbolKeyword(String(firstStringPath(row, ['Symbol', 'DisplayAndFormat.Symbol', 'PositionBase.Symbol']) ?? ''));
    if (!symbol) continue;
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

function feedRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.Data)) return value.Data.filter(isRecord);
  return [];
}

function firstNumericPath(value: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const found = readPath(value, path);
    if (typeof found === 'number' && Number.isFinite(found)) return Math.abs(found);
    if (typeof found === 'string' && found.trim()) {
      const parsed = Number(found);
      if (Number.isFinite(parsed)) return Math.abs(parsed);
    }
  }
  if (isRecord(value)) {
    for (const path of paths) {
      const key = path.split('.').at(-1)?.toLowerCase();
      const found = findNumberByKey(value, key ?? '');
      if (found !== undefined) return Math.abs(found);
    }
  }
  return undefined;
}

function firstStringPath(value: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const found = readPath(value, path);
    if (typeof found === 'string' && found.trim()) return found;
  }
  return undefined;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function displaySymbol(symbol: string): string {
  return symbol.trim().split(':')[0]?.toUpperCase() ?? symbol.trim().toUpperCase();
}

function symbolKeyword(symbol: string): string {
  return displaySymbol(symbol).split('/')[0] ?? displaySymbol(symbol);
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
  if (typeof bid === 'number' && typeof ask === 'number') return (bid + ask) / 2;
  return bid ?? ask;
}

function percentReturn(values: number[], lookback: number): number | undefined {
  const last = values.at(-1);
  const previous = values.at(-(lookback + 1));
  if (!last || !previous) return undefined;
  return (last - previous) / previous * 100;
}

function realizedVolatility(values: number[]): number | undefined {
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous && current) returns.push(Math.log(current / previous));
  }
  if (returns.length < 2) return undefined;
  const mean = average(returns);
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function averageRangePercent(bars: OhlcBar[]): number | undefined {
  const ranges = bars
    .map(bar => (bar.high !== undefined && bar.low !== undefined ? (bar.high - bar.low) / bar.close * 100 : undefined))
    .filter(isDefined);
  return ranges.length ? average(ranges) : undefined;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMetric(label: string, value: number | undefined, suffix: string): string | undefined {
  if (value === undefined) return undefined;
  return `${label} ${round(value)}${suffix}.`;
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter(isDefined);
  return defined.length ? Math.min(...defined) : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

function scaleUp(value: number, low: number, high: number): number {
  if (value <= low) return 0;
  if (value >= high) return 1;
  return (value - low) / (high - low);
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function roundMoney(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown';
  return `$${roundMoney(value)?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
