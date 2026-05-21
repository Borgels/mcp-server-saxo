import { readFileSync } from 'node:fs';
import type { SaxoClient } from './client.js';
import {
  getMarketFundamentalsContext,
  getMarketNewsContext,
  type MarketContextProvider,
  type MarketFundamentalsContext,
  type MarketNewsContext,
} from './market-context.js';
import { contractMultiplier } from './policy.js';
import { getInfoPricesList } from './prices.js';
import { getBalance, listOrders, listPositions } from './portfolio.js';
import { readEnv } from './env.js';

export type FollowUpVerdict = 'hold' | 'review' | 'consider_trim' | 'consider_close' | 'roll_watch' | 'unknown';
export type StrategyInstrumentType = 'stock' | 'option' | 'mixed';
export type StrategyReviewDepth = 'status' | 'standard' | 'deep';
type StrategyPositionInput = NonNullable<StrategyFollowUpInput['strategyPositions']>[number];

export interface StrategyLegSnapshotInput {
  uic: number;
  assetType?: string;
  buySell: 'Buy' | 'Sell';
  amount: number;
  expiry?: string;
  putCall?: 'Put' | 'Call';
  strike?: number;
}

export interface StrategyFollowUpInput {
  accountKey?: string;
  clientKey?: string;
  strategySnapshotPath?: string;
  strategyPositions?: Array<{
    name?: string;
    thesisName?: string;
    symbol?: string;
    strategy?: string;
    openedAt?: string;
    underlyingUic?: number;
    underlyingAssetType?: string;
    entryPrice?: number;
    entryCost?: number;
    entryProceeds?: number;
    entryNotional?: number;
    entryNetDebit?: number;
    entryNetCredit?: number;
    entryMaxRisk?: number;
    entryMaxProfit?: number;
    entryUnderlyingPrice?: number;
    probabilityOfProfit?: number;
    expectedProfit?: number;
    expectedLoss?: number;
    legs: StrategyLegSnapshotInput[];
    rules?: {
      profitTakePercentOfCost?: number;
      profitTakePercentOfMaxProfit?: number;
      lossExitPercentOfCost?: number;
      lossExitPercentOfMaxRisk?: number;
      rollWhenDaysToExpiryBelow?: number;
      closeWhenDaysToExpiryBelow?: number;
      thesisInvalidBelow?: number;
      thesisInvalidAbove?: number;
      maxThetaDailyPercentOfRisk?: number;
    };
  }>;
  defaultRules?: {
    profitTakePercentOfCost?: number;
    profitTakePercentOfMaxProfit?: number;
    lossExitPercentOfCost?: number;
    lossExitPercentOfMaxRisk?: number;
    rollWhenDaysToExpiryBelow?: number;
    closeWhenDaysToExpiryBelow?: number;
    thesisInvalidBelow?: number;
    thesisInvalidAbove?: number;
    maxThetaDailyPercentOfRisk?: number;
  };
  reviewDepth?: StrategyReviewDepth;
  includeTechnicalContext?: boolean;
  includeNewsContext?: boolean;
  includeFundamentalsContext?: boolean;
  includeLiquidityContext?: boolean;
  newsProvider?: MarketContextProvider;
  newsLookbackDays?: number;
  newsLimit?: number;
  earningsHorizon?: '3month' | '6month' | '12month';
  technicalHorizon?: number;
  technicalBars?: number;
}

export interface StrategyFollowUpResult {
  generatedAt: string;
  filters: {
    accountKey?: string;
    strategiesProvided: number;
  };
  portfolioStatus: {
    cashAvailableForTrading?: number;
    cashBalance?: number;
    totalValue?: number;
    netPositionsValue?: number;
    marginUtilizationPct?: number;
    workingOrdersCount?: number;
    strategiesReviewed: number;
    holdCount: number;
    reviewCount: number;
    considerTrimCount: number;
    considerCloseCount: number;
    rollWatchCount: number;
    totalEntryValue?: number;
    totalMaxRisk?: number;
    totalMaxProfit?: number;
    totalCurrentValue?: number;
    totalUnrealizedPnL?: number;
    totalUnrealizedPnLPercentOfMaxRisk?: number;
    totalDelta?: number;
    totalGamma?: number;
    totalTheta?: number;
    totalVega?: number;
    totalThetaDailyPercentOfRisk?: number;
  };
  accountPositions: {
    positionsFetched: number;
    matchedLegs: number;
    unmatchedLegs: number;
  };
  reviews: Array<{
    name: string;
    thesisName?: string;
    symbol?: string;
    strategy?: string;
    instrumentType: StrategyInstrumentType;
    verdict: FollowUpVerdict;
    daysToEarliestExpiry?: number;
    openLegsMatched: number;
    expectedLegs: number;
    entryValue?: number;
    entryMaxRisk?: number;
    entryMaxProfit?: number;
    currentValue?: number;
    currentUnderlyingPrice?: number;
    unrealizedPnL?: number;
    unrealizedPnLPercentOfMaxRisk?: number;
    unrealizedPnLPercentOfMaxProfit?: number;
    netGreeks?: {
      delta?: number;
      gamma?: number;
      theta?: number;
      vega?: number;
      thetaDailyPercentOfRisk?: number;
    };
    technicalContext?: TechnicalReviewContext;
    newsContext?: MarketNewsContext;
    fundamentalsContext?: MarketFundamentalsContext;
    liquidityContext?: LiquidityReviewContext;
    expectedValue?: {
      probabilityOfProfit?: number;
      expectedProfit?: number;
      expectedLoss?: number;
      estimatedExpectedValue?: number;
      estimatedExpectedValuePercentOfMaxRisk?: number;
      notes: string[];
    };
    triggeredRules: string[];
    warnings: string[];
    legs: Array<{
      uic: number;
      assetType: string;
      expectedAmount: number;
      openAmount?: number;
      closeMid?: number;
      closeValue?: number;
      greeks?: Record<string, number>;
      matched: boolean;
      warnings: string[];
    }>;
  }>;
  warnings: string[];
}

interface InfoPrice {
  Uic?: number;
  AssetType?: string;
  InstrumentPriceDetails?: {
    OpenInterest?: number;
  };
  PriceInfoDetails?: {
    Volume?: number;
  };
  Greeks?: Record<string, number>;
  Quote?: {
    Ask?: number;
    Bid?: number;
    Mid?: number;
  };
}

interface TechnicalReviewContext {
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

interface LiquidityReviewContext {
  source: 'saxo_prices';
  quoteSpreadPercent?: number;
  maxLegQuoteSpreadPercent?: number;
  volume?: number;
  openInterest?: number;
  notes: string[];
}

interface ReviewContextOptions {
  includeTechnicalContext: boolean;
  includeNewsContext: boolean;
  includeFundamentalsContext: boolean;
  includeLiquidityContext: boolean;
  newsProvider: MarketContextProvider;
  newsLookbackDays: number;
  newsLimit: number;
  earningsHorizon: '3month' | '6month' | '12month';
  technicalHorizon: number;
  technicalBars: number;
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

interface StrategySnapshotFile {
  accountKey?: string;
  defaultRules?: StrategyFollowUpInput['defaultRules'];
  sourcePath: string;
  strategyPositions?: NonNullable<StrategyFollowUpInput['strategyPositions']>;
}

export async function reviewStrategyPositions(
  client: SaxoClient,
  input: StrategyFollowUpInput,
  now: Date = new Date(),
): Promise<StrategyFollowUpResult> {
  const warnings: string[] = [];
  const snapshot = loadStrategySnapshot(input.strategySnapshotPath, {
    explicit: input.strategySnapshotPath !== undefined,
    warnings,
  });
  let strategies = input.strategyPositions?.length
    ? input.strategyPositions
    : snapshot?.strategyPositions ?? [];
  if (!input.strategyPositions?.length && snapshot) {
    warnings.push(`Loaded strategy snapshot from ${snapshot.sourcePath}.`);
  }
  const accountKey = input.accountKey ?? snapshot?.accountKey;
  const defaultRules = { ...snapshot?.defaultRules, ...input.defaultRules };
  const contextOptions = resolveReviewContextOptions(input);
  const positions = await listPositions(client, {
    accountKey,
    clientKey: input.clientKey,
    fieldGroups: ['DisplayAndFormat', 'PositionBase', 'PositionView'],
    top: 500,
  });
  const [balance, workingOrders] = await Promise.all([
    accountKey ? getBalance(client, { accountKey, clientKey: input.clientKey }) : Promise.resolve(undefined),
    listOrders(client, {
      accountKey,
      clientKey: input.clientKey,
      fieldGroups: ['DisplayAndFormat'],
      status: 'Working',
      top: 500,
    }),
  ]);
  const positionRows = feedRows(positions);
  if (!strategies.length && positionRows.length) {
    strategies = inferStandaloneStrategiesFromPositions(positionRows);
    warnings.push(
      `Inferred ${strategies.length} standalone strategy review entries from Saxo open positions. ` +
      'No saved strategy thesis, leg grouping, entry rules, max risk, or max profit were available, so multi-leg option spreads may appear as separate unmanaged positions.',
    );
  }
  if (!strategies.length) {
    warnings.push('No strategyPositions, readable strategy snapshot, or inferable open positions were provided; returning account status without named strategy verdicts.');
  }
  const openAmountByUic = summarizeOpenAmounts(positionRows);
  const underlyingPriceByUic = summarizeUnderlyingPrices(positionRows);
  const priceByUic = await fetchStrategyPrices(client, strategies, accountKey, warnings);
  const contextByIndex = await fetchReviewContexts(client, strategies, {
    accountKey,
    now,
    options: contextOptions,
    priceByUic,
    warnings,
  });

  const reviews = strategies.map((strategy, index) =>
    reviewOneStrategy(strategy, {
      context: contextByIndex.get(index),
      defaultRules,
      now,
      openAmountByUic,
      underlyingPriceByUic,
      priceByUic,
      fallbackName: `Strategy ${index + 1}`,
    }),
  );

  const matchedLegs = reviews.reduce((total, review) => total + review.openLegsMatched, 0);
  const expectedLegs = reviews.reduce((total, review) => total + review.expectedLegs, 0);

  return {
    generatedAt: now.toISOString(),
    filters: {
      accountKey,
      strategiesProvided: strategies.length,
    },
    portfolioStatus: buildPortfolioStatus(reviews, balance, workingOrders),
    accountPositions: {
      positionsFetched: positionRows.length,
      matchedLegs,
      unmatchedLegs: expectedLegs - matchedLegs,
    },
    reviews,
    warnings,
  };
}

function resolveReviewContextOptions(input: StrategyFollowUpInput): ReviewContextOptions {
  const depth = input.reviewDepth ?? 'status';
  const standardOrDeep = depth === 'standard' || depth === 'deep';
  const deep = depth === 'deep';
  return {
    includeTechnicalContext: input.includeTechnicalContext ?? standardOrDeep,
    includeNewsContext: input.includeNewsContext ?? deep,
    includeFundamentalsContext: input.includeFundamentalsContext ?? deep,
    includeLiquidityContext: input.includeLiquidityContext ?? standardOrDeep,
    newsProvider: input.newsProvider ?? 'auto',
    newsLookbackDays: clampInt(input.newsLookbackDays ?? 7, 1, 30),
    newsLimit: clampInt(input.newsLimit ?? 10, 1, 50),
    earningsHorizon: input.earningsHorizon ?? '3month',
    technicalHorizon: clampInt(input.technicalHorizon ?? 1440, 1, 10080),
    technicalBars: clampInt(input.technicalBars ?? 90, 20, 1200),
  };
}

function loadStrategySnapshot(
  path = readEnv('SAXO_STRATEGY_SNAPSHOT_PATH'),
  options: { explicit: boolean; warnings: string[] } = { explicit: false, warnings: [] },
): StrategySnapshotFile | undefined {
  if (!path) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    const message = `Failed to read strategy snapshot ${path}: ${(error as Error).message}`;
    if (options.explicit) {
      throw new Error(message);
    }
    options.warnings.push(`${message}. Ignoring configured SAXO_STRATEGY_SNAPSHOT_PATH; pass strategyPositions or a valid strategySnapshotPath to review named strategies.`);
    return undefined;
  }
  if (!isRecord(parsed)) {
    const message = `Strategy snapshot ${path} must contain a JSON object.`;
    if (options.explicit) {
      throw new Error(message);
    }
    options.warnings.push(`${message} Ignoring configured SAXO_STRATEGY_SNAPSHOT_PATH; pass strategyPositions or a valid strategySnapshotPath to review named strategies.`);
    return undefined;
  }
  const strategyPositions = Array.isArray(parsed.strategyPositions)
    ? parsed.strategyPositions as NonNullable<StrategyFollowUpInput['strategyPositions']>
    : undefined;
  return {
    accountKey: firstStringPath(parsed, ['accountKey']),
    defaultRules: isRecord(parsed.defaultRules) ? parsed.defaultRules as StrategyFollowUpInput['defaultRules'] : undefined,
    sourcePath: path,
    strategyPositions,
  };
}

function inferStandaloneStrategiesFromPositions(rows: Record<string, unknown>[]): StrategyPositionInput[] {
  const strategies: StrategyPositionInput[] = [];
  for (const row of rows) {
      const uic = firstNumberPath(row, ['Uic', 'PositionBase.Uic']);
      const amount = firstNumberPath(row, ['PositionBase.Amount', 'Amount']);
      if (uic === undefined || amount === undefined || amount === 0) {
        continue;
      }
      const assetType = firstStringPath(row, [
        'AssetType',
        'PositionBase.AssetType',
        'DisplayAndFormat.AssetType',
      ]) ?? 'Stock';
      const buySell = inferPositionBuySell(row, amount);
      const symbol = reviewDisplaySymbol(firstStringPath(row, [
        'DisplayAndFormat.Symbol',
        'PositionBase.Symbol',
        'Symbol',
      ]) ?? `Uic ${uic}`);
      const entryPrice = firstNumberPath(row, [
        'PositionBase.OpenPrice',
        'PositionBase.Price',
        'PositionBase.AverageOpenPrice',
        'PositionView.AverageOpenPrice',
        'AverageOpenPrice',
        'OpenPrice',
        'Price',
      ]);
      strategies.push({
        name: `${symbol} unmanaged ${assetType}`,
        symbol,
        strategy: 'inferred_unmanaged_position',
        entryPrice: entryPrice && entryPrice > 0 ? entryPrice : undefined,
        legs: [
          {
            uic,
            assetType,
            buySell,
            amount: Math.abs(amount),
            expiry: firstStringPath(row, ['DisplayAndFormat.ExpiryDate', 'PositionBase.ExpiryDate', 'ExpiryDate', 'Expiry']),
            putCall: inferPutCall(row),
            strike: firstNumberPath(row, ['DisplayAndFormat.Strike', 'PositionBase.Strike', 'Strike']),
          },
        ],
      });
  }
  return strategies;
}

function inferPositionBuySell(row: Record<string, unknown>, amount: number): 'Buy' | 'Sell' {
  const buySell = firstStringPath(row, ['PositionBase.BuySell', 'BuySell']);
  if (buySell === 'Sell') {
    return 'Sell';
  }
  if (buySell === 'Buy') {
    return 'Buy';
  }
  return amount < 0 ? 'Sell' : 'Buy';
}

function inferPutCall(row: Record<string, unknown>): 'Put' | 'Call' | undefined {
  const value = firstStringPath(row, ['DisplayAndFormat.PutCall', 'PositionBase.PutCall', 'PutCall', 'OptionType']);
  if (value === 'Put' || value === 'Call') {
    return value;
  }
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'p' || normalized === 'put') {
    return 'Put';
  }
  if (normalized === 'c' || normalized === 'call') {
    return 'Call';
  }
  return undefined;
}

function buildPortfolioStatus(
  reviews: StrategyFollowUpResult['reviews'],
  balance: unknown,
  workingOrders: unknown,
): StrategyFollowUpResult['portfolioStatus'] {
  const totalEntryValue = sumDefined(reviews.map(review => review.entryValue));
  const totalMaxRisk = sumDefined(reviews.map(review => review.entryMaxRisk));
  const totalMaxProfit = sumDefined(reviews.map(review => review.entryMaxProfit));
  const totalCurrentValue = sumDefined(reviews.map(review => review.currentValue));
  const totalUnrealizedPnL = sumDefined(reviews.map(review => review.unrealizedPnL));
  const totalDelta = sumDefined(reviews.map(review => review.netGreeks?.delta));
  const totalGamma = sumDefined(reviews.map(review => review.netGreeks?.gamma));
  const totalTheta = sumDefined(reviews.map(review => review.netGreeks?.theta));
  const totalVega = sumDefined(reviews.map(review => review.netGreeks?.vega));
  return {
    cashAvailableForTrading: roundMoney(firstNumberPath(balance, ['CashAvailableForTrading'])),
    cashBalance: roundMoney(firstNumberPath(balance, ['CashBalance'])),
    totalValue: roundMoney(firstNumberPath(balance, ['TotalValue'])),
    netPositionsValue: roundMoney(firstNumberPath(balance, ['NetPositionsValue'])),
    marginUtilizationPct: roundMoney(firstNumberPath(balance, ['MarginUtilizationPct'])),
    workingOrdersCount: feedRows(workingOrders).length,
    strategiesReviewed: reviews.length,
    holdCount: countVerdicts(reviews, 'hold'),
    reviewCount: countVerdicts(reviews, 'review'),
    considerTrimCount: countVerdicts(reviews, 'consider_trim'),
    considerCloseCount: countVerdicts(reviews, 'consider_close'),
    rollWatchCount: countVerdicts(reviews, 'roll_watch'),
    totalEntryValue: roundMoney(totalEntryValue),
    totalMaxRisk: roundMoney(totalMaxRisk),
    totalMaxProfit: roundMoney(totalMaxProfit),
    totalCurrentValue: roundMoney(totalCurrentValue),
    totalUnrealizedPnL: roundMoney(totalUnrealizedPnL),
    totalUnrealizedPnLPercentOfMaxRisk: percent(totalUnrealizedPnL, totalMaxRisk),
    totalDelta: roundGreek(totalDelta),
    totalGamma: roundGreek(totalGamma),
    totalTheta: roundGreek(totalTheta),
    totalVega: roundGreek(totalVega),
    totalThetaDailyPercentOfRisk: percent(totalTheta, totalMaxRisk),
  };
}

function countVerdicts(reviews: StrategyFollowUpResult['reviews'], verdict: FollowUpVerdict): number {
  return reviews.filter(review => review.verdict === verdict).length;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  let found = false;
  let total = 0;
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    found = true;
    total += value;
  }
  return found ? total : undefined;
}

function reviewOneStrategy(
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  context: {
    context?: {
      fundamentalsContext?: MarketFundamentalsContext;
      liquidityContext?: LiquidityReviewContext;
      newsContext?: MarketNewsContext;
      technicalContext?: TechnicalReviewContext;
    };
    defaultRules?: StrategyFollowUpInput['defaultRules'];
    fallbackName: string;
    now: Date;
    openAmountByUic: Map<number, number>;
    underlyingPriceByUic: Map<number, number>;
    priceByUic: Map<number, InfoPrice>;
  },
): StrategyFollowUpResult['reviews'][number] {
  const rules = { ...context.defaultRules, ...strategy.rules };
  const entryValue = buildEntryValue(strategy);
  const entryMaxRisk = strategy.entryMaxRisk ?? (entryValue !== undefined && entryValue > 0 ? entryValue : undefined);
  const entryMaxProfit = strategy.entryMaxProfit;
  const legs = strategy.legs.map(leg => reviewLeg(leg, context));
  const openLegsMatched = legs.filter(leg => leg.matched).length;
  const instrumentType = inferStrategyInstrumentType(strategy.legs);
  const currentValue = aggregateCurrentValue(legs);
  const currentUnderlyingPrice = strategyCurrentUnderlyingPrice(strategy.legs, context.underlyingPriceByUic);
  const unrealizedPnL = currentValue !== undefined && entryValue !== undefined
    ? currentValue - entryValue
    : undefined;
  const netGreeks = aggregateGreeks(strategy.legs, context.priceByUic, entryMaxRisk);
  const expectedValue = expectedValueEstimate(strategy, entryMaxRisk);
  const daysToEarliestExpiry = earliestDte(strategy.legs, context.now);
  const triggeredRules = [
    ...triggeredFollowUpRules({
    currentValue,
    currentUnderlyingPrice,
    daysToEarliestExpiry,
    entryValue,
    entryMaxProfit,
    entryMaxRisk,
    instrumentType,
    netGreeks,
    rules,
    strategy,
    unrealizedPnL,
    }),
    ...triggeredContextRules(strategy, context.context),
  ];
  const warnings = [
    openLegsMatched < strategy.legs.length ? 'One or more expected legs were not found in open positions.' : undefined,
    currentValue === undefined ? 'Current close value could not be estimated for all legs.' : undefined,
    instrumentType !== 'stock' && netGreeks === undefined ? 'Greeks were unavailable for one or more reviewed option legs.' : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    name: strategy.name ?? context.fallbackName,
    thesisName: strategy.thesisName,
    symbol: strategy.symbol,
    strategy: strategy.strategy,
    instrumentType,
    verdict: verdictFromRules(triggeredRules, warnings, daysToEarliestExpiry),
    daysToEarliestExpiry,
    openLegsMatched,
    expectedLegs: strategy.legs.length,
    entryValue: roundMoney(entryValue),
    entryMaxRisk,
    entryMaxProfit,
    currentValue: roundMoney(currentValue),
    currentUnderlyingPrice: roundMoney(currentUnderlyingPrice),
    unrealizedPnL: roundMoney(unrealizedPnL),
    unrealizedPnLPercentOfMaxRisk: percent(unrealizedPnL, entryMaxRisk),
    unrealizedPnLPercentOfMaxProfit: percent(unrealizedPnL, entryMaxProfit),
    netGreeks,
    technicalContext: context.context?.technicalContext,
    newsContext: context.context?.newsContext,
    fundamentalsContext: context.context?.fundamentalsContext,
    liquidityContext: context.context?.liquidityContext,
    expectedValue,
    triggeredRules,
    warnings,
    legs,
  };
}

function reviewLeg(
  leg: StrategyLegSnapshotInput,
  context: { openAmountByUic: Map<number, number>; priceByUic: Map<number, InfoPrice> },
): StrategyFollowUpResult['reviews'][number]['legs'][number] {
  const assetType = inferLegAssetType(leg);
  const price = context.priceByUic.get(leg.uic);
  const quote = price?.Quote;
  const closeMid = quote?.Mid ?? mid(quote?.Bid, quote?.Ask);
  const openAmount = context.openAmountByUic.get(leg.uic);
  const expectedSigned = leg.buySell === 'Buy' ? Math.abs(leg.amount) : -Math.abs(leg.amount);
  const matched = openAmount !== undefined && Math.sign(openAmount) === Math.sign(expectedSigned) && Math.abs(openAmount) >= Math.abs(expectedSigned);
  const multiplier = contractMultiplier(assetType);
  const closeValue = closeMid === undefined ? undefined : closeMid * Math.abs(leg.amount) * multiplier * (leg.buySell === 'Buy' ? 1 : -1);
  return {
    uic: leg.uic,
    assetType,
    expectedAmount: expectedSigned,
    openAmount,
    closeMid: roundMoney(closeMid),
    closeValue: roundMoney(closeValue),
    greeks: price?.Greeks,
    matched,
    warnings: [
      !matched ? 'Expected leg was not matched to an open position with the same direction.' : undefined,
      closeMid === undefined ? 'Bid/ask midpoint was unavailable.' : undefined,
      isOptionAssetType(assetType) && !price?.Greeks ? 'Greeks unavailable for option leg.' : undefined,
    ].filter((item): item is string => Boolean(item)),
  };
}

function triggeredFollowUpRules(input: {
  currentValue?: number;
  currentUnderlyingPrice?: number;
  daysToEarliestExpiry?: number;
  entryValue?: number;
  entryMaxProfit?: number;
  entryMaxRisk?: number;
  instrumentType: StrategyInstrumentType;
  netGreeks?: NonNullable<StrategyFollowUpResult['reviews'][number]['netGreeks']>;
  rules: NonNullable<StrategyFollowUpInput['defaultRules']>;
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number];
  unrealizedPnL?: number;
}): string[] {
  const triggered: string[] = [];
  if (
    input.rules.profitTakePercentOfCost !== undefined &&
    input.unrealizedPnL !== undefined &&
    input.entryValue !== undefined &&
    Math.abs(input.entryValue) > 0 &&
    input.unrealizedPnL >= Math.abs(input.entryValue) * input.rules.profitTakePercentOfCost / 100
  ) {
    triggered.push(`Profit target reached: P/L is at least ${input.rules.profitTakePercentOfCost}% of entry cost.`);
  }
  if (
    input.rules.profitTakePercentOfMaxProfit !== undefined &&
    input.unrealizedPnL !== undefined &&
    input.entryMaxProfit !== undefined &&
    input.unrealizedPnL >= input.entryMaxProfit * input.rules.profitTakePercentOfMaxProfit / 100
  ) {
    triggered.push(`Profit target reached: P/L is at least ${input.rules.profitTakePercentOfMaxProfit}% of max profit.`);
  }
  if (
    input.rules.lossExitPercentOfCost !== undefined &&
    input.unrealizedPnL !== undefined &&
    input.entryValue !== undefined &&
    Math.abs(input.entryValue) > 0 &&
    input.unrealizedPnL <= -Math.abs(input.entryValue) * input.rules.lossExitPercentOfCost / 100
  ) {
    triggered.push(`Loss rule reached: P/L is below -${input.rules.lossExitPercentOfCost}% of entry cost.`);
  }
  if (
    input.rules.lossExitPercentOfMaxRisk !== undefined &&
    input.unrealizedPnL !== undefined &&
    input.entryMaxRisk !== undefined &&
    input.unrealizedPnL <= -input.entryMaxRisk * input.rules.lossExitPercentOfMaxRisk / 100
  ) {
    triggered.push(`Loss rule reached: P/L is below -${input.rules.lossExitPercentOfMaxRisk}% of max risk.`);
  }
  if (
    input.rules.thesisInvalidBelow !== undefined &&
    thesisReferencePrice(input.strategy, input.currentValue, input.currentUnderlyingPrice) !== undefined &&
    (thesisReferencePrice(input.strategy, input.currentValue, input.currentUnderlyingPrice) as number) <= input.rules.thesisInvalidBelow
  ) {
    triggered.push(`Thesis invalidation reached: current price is at or below ${input.rules.thesisInvalidBelow}.`);
  }
  if (
    input.rules.thesisInvalidAbove !== undefined &&
    thesisReferencePrice(input.strategy, input.currentValue, input.currentUnderlyingPrice) !== undefined &&
    (thesisReferencePrice(input.strategy, input.currentValue, input.currentUnderlyingPrice) as number) >= input.rules.thesisInvalidAbove
  ) {
    triggered.push(`Thesis invalidation reached: current price is at or above ${input.rules.thesisInvalidAbove}.`);
  }
  if (
    input.rules.rollWhenDaysToExpiryBelow !== undefined &&
    input.instrumentType !== 'stock' &&
    input.daysToEarliestExpiry !== undefined &&
    input.daysToEarliestExpiry <= input.rules.rollWhenDaysToExpiryBelow
  ) {
    triggered.push(`Roll watch: ${input.daysToEarliestExpiry} DTE is at or below ${input.rules.rollWhenDaysToExpiryBelow}.`);
  }
  if (
    input.rules.closeWhenDaysToExpiryBelow !== undefined &&
    input.instrumentType !== 'stock' &&
    input.daysToEarliestExpiry !== undefined &&
    input.daysToEarliestExpiry <= input.rules.closeWhenDaysToExpiryBelow
  ) {
    triggered.push(`Close watch: ${input.daysToEarliestExpiry} DTE is at or below ${input.rules.closeWhenDaysToExpiryBelow}.`);
  }
  if (
    input.rules.maxThetaDailyPercentOfRisk !== undefined &&
    input.instrumentType !== 'stock' &&
    input.netGreeks?.theta !== undefined &&
    input.netGreeks.theta < 0 &&
    (input.netGreeks.thetaDailyPercentOfRisk ?? 0) > input.rules.maxThetaDailyPercentOfRisk
  ) {
    triggered.push(`Theta rule reached: daily theta exceeds ${input.rules.maxThetaDailyPercentOfRisk}% of max risk.`);
  }
  return triggered;
}

function triggeredContextRules(
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  context: {
    fundamentalsContext?: MarketFundamentalsContext;
    liquidityContext?: LiquidityReviewContext;
    newsContext?: MarketNewsContext;
    technicalContext?: TechnicalReviewContext;
  } | undefined,
): string[] {
  const triggered: string[] = [];
  if (!context) {
    return triggered;
  }
  if (isBullishStrategy(strategy) && context.technicalContext?.bias === 'bearish') {
    triggered.push('Technical review: bearish chart bias conflicts with bullish/long exposure.');
  }
  if (isBearishStrategy(strategy) && context.technicalContext?.bias === 'bullish') {
    triggered.push('Technical review: bullish chart bias conflicts with bearish exposure.');
  }
  if (context.newsContext?.sentiment === 'bearish' && isBullishStrategy(strategy)) {
    triggered.push('News review: bearish recent sentiment conflicts with bullish/long exposure.');
  }
  const earningsDays = context.newsContext?.earnings?.daysUntil;
  if (earningsDays !== undefined && earningsDays >= 0 && earningsDays <= 10) {
    triggered.push(`Event review: earnings are within ${earningsDays} day(s).`);
  }
  if ((context.liquidityContext?.maxLegQuoteSpreadPercent ?? 0) >= 12) {
    triggered.push('Liquidity review: one or more legs have a wide bid/ask spread.');
  }
  if ((context.liquidityContext?.volume ?? 1) === 0) {
    triggered.push('Liquidity review: latest stock volume was zero or unavailable as zero.');
  }
  if (context.fundamentalsContext?.riskNotes.some(note => /high beta|small-cap|negative profit|valuation/i.test(note))) {
    triggered.push('Fundamentals review: one or more fundamental risk notes require review.');
  }
  return triggered;
}

function isBullishStrategy(strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number]): boolean {
  const name = `${strategy.strategy ?? ''} ${strategy.name ?? ''} ${strategy.thesisName ?? ''}`.toLowerCase();
  if (name.includes('put') && name.includes('bear')) {
    return false;
  }
  if (name.includes('short') && !name.includes('short call')) {
    return false;
  }
  return strategy.legs.some(leg => leg.buySell === 'Buy');
}

function isBearishStrategy(strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number]): boolean {
  const name = `${strategy.strategy ?? ''} ${strategy.name ?? ''} ${strategy.thesisName ?? ''}`.toLowerCase();
  return name.includes('bear') || name.includes('put debit') || name.includes('short stock');
}

function verdictFromRules(triggeredRules: string[], warnings: string[], dte: number | undefined): FollowUpVerdict {
  if (warnings.length) return 'review';
  if (triggeredRules.some(rule => rule.startsWith('Close watch') || rule.startsWith('Loss rule'))) return 'consider_close';
  if (triggeredRules.some(rule => rule.startsWith('Profit target'))) return 'consider_trim';
  if (triggeredRules.some(rule => rule.startsWith('Roll watch')) || (dte !== undefined && dte <= 14)) return 'roll_watch';
  if (triggeredRules.length) return 'review';
  return 'hold';
}

function aggregateCurrentValue(legs: StrategyFollowUpResult['reviews'][number]['legs']): number | undefined {
  let total = 0;
  for (const leg of legs) {
    if (leg.closeValue === undefined) {
      return undefined;
    }
    total += leg.closeValue;
  }
  return total;
}

function aggregateGreeks(
  legs: StrategyLegSnapshotInput[],
  priceByUic: Map<number, InfoPrice>,
  entryMaxRisk?: number,
): StrategyFollowUpResult['reviews'][number]['netGreeks'] | undefined {
  const delta = aggregateGreek(legs, priceByUic, 'delta');
  const gamma = aggregateGreek(legs, priceByUic, 'gamma');
  const theta = aggregateGreek(legs, priceByUic, 'theta');
  const vega = aggregateGreek(legs, priceByUic, 'vega');
  if ([delta, gamma, theta, vega].every(value => value === undefined)) {
    return undefined;
  }
  return {
    delta: roundGreek(delta),
    gamma: roundGreek(gamma),
    theta: roundGreek(theta),
    vega: roundGreek(vega),
    thetaDailyPercentOfRisk: percent(theta, entryMaxRisk),
  };
}

function aggregateGreek(
  legs: StrategyLegSnapshotInput[],
  priceByUic: Map<number, InfoPrice>,
  name: 'delta' | 'gamma' | 'theta' | 'vega',
): number | undefined {
  let found = false;
  let total = 0;
  for (const leg of legs) {
    if (!isOptionAssetType(inferLegAssetType(leg))) {
      continue;
    }
    const value = readGreek(priceByUic.get(leg.uic)?.Greeks, name);
    if (value === undefined) {
      continue;
    }
    found = true;
    total += (leg.buySell === 'Buy' ? 1 : -1) * value * Math.abs(leg.amount) * contractMultiplier(inferLegAssetType(leg));
  }
  return found ? total : undefined;
}

async function fetchStrategyPrices(
  client: SaxoClient,
  strategies: NonNullable<StrategyFollowUpInput['strategyPositions']>,
  accountKey: string | undefined,
  warnings: string[],
): Promise<Map<number, InfoPrice>> {
  const priceByUic = new Map<number, InfoPrice>();
  await fetchStockPricesByAssetType(client, strategies, accountKey, warnings, priceByUic);
  for (const strategy of strategies) {
    if (!strategy.legs.some(leg => isOptionAssetType(inferLegAssetType(leg)))) {
      continue;
    }
    await fetchMultiLegStrategyPrices(client, strategy, accountKey, warnings, priceByUic);
  }
  return priceByUic;
}

async function fetchStockPricesByAssetType(
  client: SaxoClient,
  strategies: NonNullable<StrategyFollowUpInput['strategyPositions']>,
  accountKey: string | undefined,
  warnings: string[],
  priceByUic: Map<number, InfoPrice>,
): Promise<void> {
  const byAssetType = new Map<string, number[]>();
  for (const leg of strategies.flatMap(strategy => strategy.legs)) {
    const assetType = inferLegAssetType(leg);
    if (isOptionAssetType(assetType)) {
      continue;
    }
    byAssetType.set(assetType, unique([...(byAssetType.get(assetType) ?? []), leg.uic]));
  }

  for (const [assetType, uics] of byAssetType.entries()) {
    const prices = await getInfoPricesList(client, {
      accountKey,
      assetType,
      fieldGroups: priceFieldGroups(assetType),
      uics,
    }) as { Data?: InfoPrice[]; _warning?: string };
    if (prices._warning) {
      warnings.push(`${assetType}: ${prices._warning}`);
    }
    for (const row of prices.Data ?? []) {
      if (typeof row.Uic === 'number') {
        priceByUic.set(row.Uic, { ...row, AssetType: row.AssetType ?? assetType });
      }
    }
  }
}

async function fetchMultiLegStrategyPrices(
  client: SaxoClient,
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  accountKey: string | undefined,
  warnings: string[],
  priceByUic: Map<number, InfoPrice>,
): Promise<void> {
  try {
    const pricing = await client.post<{
      Legs?: Array<{
        AssetType?: string;
        Greeks?: Record<string, number>;
        Quote?: InfoPrice['Quote'];
        Uic?: number;
      }>;
    }>('/trade/v1/prices/multileg', {
      AccountKey: accountKey,
      FieldGroups: ['Quote', 'Greeks', 'InstrumentPriceDetails'],
      Legs: strategy.legs.map(leg => ({
        Amount: Math.abs(leg.amount),
        AssetType: inferLegAssetType(leg),
        BuySell: leg.buySell,
        ToOpenClose: 'ToClose',
        Uic: leg.uic,
      })),
    });
    for (const leg of pricing.Legs ?? []) {
      if (typeof leg.Uic === 'number') {
        priceByUic.set(leg.Uic, {
          Uic: leg.Uic,
          AssetType: leg.AssetType,
          Greeks: leg.Greeks,
          Quote: leg.Quote,
        });
      }
    }
  } catch (error) {
    warnings.push(`${strategy.name ?? strategy.symbol ?? 'strategy'}: Saxo multi-leg price snapshot unavailable: ${(error as Error).message}`);
  }
}

async function fetchReviewContexts(
  client: SaxoClient,
  strategies: NonNullable<StrategyFollowUpInput['strategyPositions']>,
  input: {
    accountKey?: string;
    now: Date;
    options: ReviewContextOptions;
    priceByUic: Map<number, InfoPrice>;
    warnings: string[];
  },
): Promise<Map<number, {
  fundamentalsContext?: MarketFundamentalsContext;
  liquidityContext?: LiquidityReviewContext;
  newsContext?: MarketNewsContext;
  technicalContext?: TechnicalReviewContext;
}>> {
  const output = new Map<number, {
    fundamentalsContext?: MarketFundamentalsContext;
    liquidityContext?: LiquidityReviewContext;
    newsContext?: MarketNewsContext;
    technicalContext?: TechnicalReviewContext;
  }>();

  await Promise.all(strategies.map(async (strategy, index) => {
    const context: {
      fundamentalsContext?: MarketFundamentalsContext;
      liquidityContext?: LiquidityReviewContext;
      newsContext?: MarketNewsContext;
      technicalContext?: TechnicalReviewContext;
    } = {};
    if (input.options.includeLiquidityContext) {
      context.liquidityContext = buildLiquidityContext(strategy, input.priceByUic);
    }
    const symbol = reviewSymbol(strategy);
    const instrument = input.options.includeTechnicalContext
      ? await resolveUnderlyingInstrument(client, strategy, input.accountKey, input.warnings)
      : undefined;
    if (instrument && input.options.includeTechnicalContext) {
      context.technicalContext = await buildReviewTechnicalContext(client, {
        accountKey: input.accountKey,
        assetType: instrument.assetType,
        bars: input.options.technicalBars,
        horizon: input.options.technicalHorizon,
        now: input.now,
        symbol: symbol ?? instrument.symbol ?? String(instrument.uic),
        uic: instrument.uic,
        warnings: input.warnings,
      });
    }
    if (symbol && input.options.includeNewsContext) {
      context.newsContext = await buildReviewNewsContext(symbol, {
        earningsHorizon: input.options.earningsHorizon,
        lookbackDays: input.options.newsLookbackDays,
        newsLimit: input.options.newsLimit,
        now: input.now,
        provider: input.options.newsProvider,
        warnings: input.warnings,
      });
    }
    if (symbol && input.options.includeFundamentalsContext) {
      context.fundamentalsContext = await buildReviewFundamentalsContext(symbol, {
        now: input.now,
        provider: input.options.newsProvider,
        warnings: input.warnings,
      });
    }
    output.set(index, context);
  }));
  return output;
}

function buildLiquidityContext(
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  priceByUic: Map<number, InfoPrice>,
): LiquidityReviewContext | undefined {
  let maxLegQuoteSpreadPercent: number | undefined;
  let quoteSpreadSum = 0;
  let quoteSpreadCount = 0;
  let volume: number | undefined;
  let openInterest: number | undefined;
  const notes: string[] = [];
  for (const leg of strategy.legs) {
    const price = priceByUic.get(leg.uic);
    const bid = price?.Quote?.Bid;
    const ask = price?.Quote?.Ask;
    const midValue = price?.Quote?.Mid ?? mid(bid, ask);
    if (bid !== undefined && ask !== undefined && midValue !== undefined && midValue > 0) {
      const spreadPercent = Math.abs(ask - bid) / midValue * 100;
      maxLegQuoteSpreadPercent = maxDefined(maxLegQuoteSpreadPercent, spreadPercent);
      quoteSpreadSum += spreadPercent;
      quoteSpreadCount += 1;
    } else {
      notes.push(`Leg ${leg.uic}: bid/ask spread unavailable.`);
    }
    volume = maxDefined(volume, price?.PriceInfoDetails?.Volume);
    openInterest = maxDefined(openInterest, price?.InstrumentPriceDetails?.OpenInterest);
  }
  const quoteSpreadPercent = quoteSpreadCount ? quoteSpreadSum / quoteSpreadCount : undefined;
  if ((maxLegQuoteSpreadPercent ?? 0) >= 12) {
    notes.push('Wide bid/ask spread; use limit orders and smaller size.');
  }
  if (volume === 0) {
    notes.push('Zero reported volume in latest price snapshot.');
  }
  if (quoteSpreadPercent === undefined && volume === undefined && openInterest === undefined && notes.length === 0) {
    return undefined;
  }
  return {
    source: 'saxo_prices',
    quoteSpreadPercent: roundMoney(quoteSpreadPercent),
    maxLegQuoteSpreadPercent: roundMoney(maxLegQuoteSpreadPercent),
    volume,
    openInterest,
    notes,
  };
}

async function resolveUnderlyingInstrument(
  client: SaxoClient,
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  accountKey: string | undefined,
  warnings: string[],
): Promise<{ assetType: string; symbol?: string; uic: number } | undefined> {
  if (strategy.underlyingUic !== undefined) {
    return {
      assetType: strategy.underlyingAssetType ?? 'Stock',
      symbol: strategy.symbol,
      uic: strategy.underlyingUic,
    };
  }
  const stockLeg = strategy.legs.find(leg => inferLegAssetType(leg) === 'Stock');
  if (stockLeg) {
    return {
      assetType: 'Stock',
      symbol: strategy.symbol,
      uic: stockLeg.uic,
    };
  }
  const symbol = reviewSymbol(strategy);
  if (!symbol) {
    return undefined;
  }
  try {
    const response = await client.get<{ Data?: Array<{
      AssetType?: string;
      Identifier?: number;
      Symbol?: string;
      SummaryType?: string;
    }> }>('/ref/v1/instruments', {
      AccountKey: accountKey,
      AssetTypes: 'Stock',
      Keywords: symbol,
      $top: 10,
    });
    const picked = (response.Data ?? [])
      .filter(item => item.AssetType === 'Stock' && typeof item.Identifier === 'number')
      .sort((a, b) => stockInstrumentScore(b, symbol) - stockInstrumentScore(a, symbol))
      .at(0);
    return picked?.Identifier ? { assetType: 'Stock', symbol: picked.Symbol, uic: picked.Identifier } : undefined;
  } catch (error) {
    warnings.push(`${symbol}: underlying stock lookup unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

async function buildReviewTechnicalContext(
  client: SaxoClient,
  input: {
    accountKey?: string;
    assetType: string;
    bars: number;
    horizon: number;
    now: Date;
    symbol: string;
    uic: number;
    warnings: string[];
  },
): Promise<TechnicalReviewContext | undefined> {
  try {
    const response = await client.get<{ Data?: ChartBar[] }>('/chart/v3/charts', {
      AccountKey: input.accountKey,
      AssetType: input.assetType,
      Count: input.bars,
      Horizon: input.horizon,
      Mode: 'UpTo',
      Time: input.now.toISOString(),
      Uic: input.uic,
    });
    const bars = (response.Data ?? []).map(toOhlcBar).filter((bar): bar is OhlcBar => bar !== undefined);
    return analyzeTechnicalContext(bars, {
      horizon: input.horizon,
      requestedBars: input.bars,
      symbol: input.symbol,
    });
  } catch (error) {
    input.warnings.push(`${input.symbol}: technical context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

async function buildReviewNewsContext(
  symbol: string,
  input: {
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
      earningsHorizon: input.earningsHorizon,
      lookbackDays: input.lookbackDays,
      newsLimit: input.newsLimit,
      now: input.now,
      provider: input.provider,
      symbol,
    });
    if (!context && input.provider !== 'none') {
      input.warnings.push(`${symbol}: news context skipped because no enabled provider/key was configured.`);
    }
    return context;
  } catch (error) {
    input.warnings.push(`${symbol}: news context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

async function buildReviewFundamentalsContext(
  symbol: string,
  input: {
    now: Date;
    provider: MarketContextProvider;
    warnings: string[];
  },
): Promise<MarketFundamentalsContext | undefined> {
  try {
    const context = await getMarketFundamentalsContext({
      now: input.now,
      provider: input.provider,
      symbol,
    });
    if (!context && input.provider !== 'none') {
      input.warnings.push(`${symbol}: fundamentals context skipped because no enabled provider/key was configured.`);
    }
    return context;
  } catch (error) {
    input.warnings.push(`${symbol}: fundamentals context unavailable: ${(error as Error).message}`);
    return undefined;
  }
}

function buildEntryValue(strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number]): number | undefined {
  if (strategy.entryCost !== undefined) return strategy.entryCost;
  if (strategy.entryProceeds !== undefined) return -strategy.entryProceeds;
  if (strategy.entryNotional !== undefined) return strategy.entryNotional;
  if (strategy.entryPrice !== undefined && strategy.legs.length === 1) {
    const leg = strategy.legs[0] as StrategyLegSnapshotInput;
    return strategy.entryPrice * Math.abs(leg.amount) * contractMultiplier(inferLegAssetType(leg)) * (leg.buySell === 'Buy' ? 1 : -1);
  }
  if (strategy.entryNetDebit !== undefined) {
    return strategy.entryNetDebit * strategyMultiplier(strategy);
  }
  if (strategy.entryNetCredit !== undefined) {
    return -strategy.entryNetCredit * strategyMultiplier(strategy);
  }
  return undefined;
}

function thesisReferencePrice(
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  currentValue: number | undefined,
  currentUnderlyingPrice: number | undefined,
): number | undefined {
  if (currentUnderlyingPrice !== undefined && strategy.legs.some(leg => isOptionAssetType(inferLegAssetType(leg)))) {
    return currentUnderlyingPrice;
  }
  if (currentValue === undefined) {
    return undefined;
  }
  return currentUnitPrice(strategy, currentValue);
}

function strategyCurrentUnderlyingPrice(
  legs: StrategyLegSnapshotInput[],
  underlyingPriceByUic: Map<number, number>,
): number | undefined {
  for (const leg of legs) {
    const price = underlyingPriceByUic.get(leg.uic);
    if (price !== undefined) {
      return price;
    }
  }
  return undefined;
}

function expectedValueEstimate(
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  entryMaxRisk: number | undefined,
): StrategyFollowUpResult['reviews'][number]['expectedValue'] | undefined {
  const probability = strategy.probabilityOfProfit;
  if (probability === undefined) {
    return undefined;
  }
  const p = probability > 1 ? probability / 100 : probability;
  if (p < 0 || p > 1) {
    return {
      probabilityOfProfit: probability,
      notes: ['Probability of profit must be 0-1 or 0-100.'],
    };
  }
  const expectedProfit = strategy.expectedProfit ?? strategy.entryMaxProfit;
  const expectedLoss = strategy.expectedLoss ?? entryMaxRisk;
  const notes: string[] = [];
  if (expectedProfit === undefined) {
    notes.push('Expected profit unavailable; set expectedProfit or entryMaxProfit for EV.');
  }
  if (expectedLoss === undefined) {
    notes.push('Expected loss unavailable; set expectedLoss or entryMaxRisk for EV.');
  }
  const estimatedExpectedValue =
    expectedProfit !== undefined && expectedLoss !== undefined
      ? p * expectedProfit - (1 - p) * expectedLoss
      : undefined;
  return {
    probabilityOfProfit: roundMoney(p * 100),
    expectedProfit,
    expectedLoss,
    estimatedExpectedValue: roundMoney(estimatedExpectedValue),
    estimatedExpectedValuePercentOfMaxRisk: percent(estimatedExpectedValue, entryMaxRisk),
    notes,
  };
}

function reviewSymbol(strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number]): string | undefined {
  return strategy.symbol?.trim().split(':')[0]?.split('/')[0]?.toUpperCase();
}

function stockInstrumentScore(stock: { SummaryType?: string; Symbol?: string }, keyword: string): number {
  const symbol = reviewDisplaySymbol(stock.Symbol ?? '');
  return (
    (stock.SummaryType === 'Instrument' ? 100 : 0) +
    (symbol === keyword ? 60 : 0) +
    (symbol.startsWith(keyword) ? 10 : 0)
  );
}

function reviewDisplaySymbol(symbol: string): string {
  return symbol.trim().split(':')[0]?.split('/')[0]?.toUpperCase() ?? symbol.trim().toUpperCase();
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
): TechnicalReviewContext | undefined {
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
    ].filter((item): item is string => Boolean(item)).join(' '),
    riskNotes: technicalRiskNotes({ annualizedVolatilityPercent, averageRange14dPercent, return5dPercent, return20dPercent, bias }),
    metrics: {
      lastClose: roundMoney(lastClose),
      return5dPercent: roundMoney(return5dPercent),
      return20dPercent: roundMoney(return20dPercent),
      sma20: roundMoney(sma20),
      sma50: roundMoney(sma50),
      distanceToSma20Percent: roundMoney(distanceToSma20Percent),
      distanceToSma50Percent: roundMoney(distanceToSma50Percent),
      annualizedVolatilityPercent: roundMoney(annualizedVolatilityPercent),
      averageRange14dPercent: roundMoney(averageRange14dPercent),
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
    notes.push('High realized volatility; review sizing and stop discipline.');
  }
  if ((input.averageRange14dPercent ?? 0) >= 5) {
    notes.push('Wide recent daily ranges; use limit orders and avoid oversizing additions.');
  }
  if (Math.abs(input.return5dPercent ?? 0) >= 10) {
    notes.push('Large 5-day move; watch reversal and gap risk.');
  }
  if (input.bias !== 'neutral' && Math.abs(input.return20dPercent ?? 0) >= 20) {
    notes.push('Extended 20-day move; thesis may be crowded or late.');
  }
  return notes;
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
    .filter((value): value is number => value !== undefined);
  return ranges.length ? average(ranges) : undefined;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMetric(label: string, value: number | undefined, suffix: string): string | undefined {
  if (value === undefined) return undefined;
  return `${label} ${roundMoney(value)}${suffix}.`;
}

function priceFromFields(...values: Array<number | undefined>): number | undefined {
  return values.find(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function strategyMultiplier(strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number]): number {
  if (!strategy.legs.length) return 1;
  const multipliers = unique(strategy.legs.map(leg => contractMultiplier(inferLegAssetType(leg))));
  return multipliers.length === 1 ? multipliers[0] as number : 1;
}

function currentUnitPrice(
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  currentValue: number,
): number | undefined {
  if (strategy.legs.length !== 1) return undefined;
  const leg = strategy.legs[0] as StrategyLegSnapshotInput;
  const denominator = Math.abs(leg.amount) * contractMultiplier(inferLegAssetType(leg));
  return denominator > 0 ? Math.abs(currentValue) / denominator : undefined;
}

function inferStrategyInstrumentType(legs: StrategyLegSnapshotInput[]): StrategyInstrumentType {
  const hasOption = legs.some(leg => isOptionAssetType(inferLegAssetType(leg)));
  const hasStock = legs.some(leg => inferLegAssetType(leg) === 'Stock');
  if (hasOption && hasStock) return 'mixed';
  if (hasOption) return 'option';
  if (hasStock) return 'stock';
  return 'mixed';
}

function inferLegAssetType(leg: StrategyLegSnapshotInput): string {
  if (leg.assetType?.trim()) return leg.assetType.trim();
  if (leg.expiry || leg.putCall || leg.strike !== undefined) return 'StockOption';
  return 'Stock';
}

function isOptionAssetType(assetType: string): boolean {
  return assetType.toLowerCase().includes('option');
}

function priceFieldGroups(assetType: string): string[] {
  return isOptionAssetType(assetType)
    ? ['Quote', 'Greeks', 'InstrumentPriceDetails']
    : ['Quote', 'PriceInfoDetails', 'DisplayAndFormat'];
}

function readGreek(greeks: Record<string, number> | undefined, name: 'delta' | 'gamma' | 'theta' | 'vega'): number | undefined {
  if (!greeks) return undefined;
  const entry = Object.entries(greeks).find(([key]) => key.toLowerCase() === name);
  return typeof entry?.[1] === 'number' && Number.isFinite(entry[1]) ? entry[1] : undefined;
}

function summarizeOpenAmounts(rows: Record<string, unknown>[]): Map<number, number> {
  const byUic = new Map<number, number>();
  for (const row of rows) {
    const uic = firstNumberPath(row, ['Uic', 'PositionBase.Uic']);
    if (uic === undefined) continue;
    const amount = firstNumberPath(row, ['PositionBase.Amount', 'Amount']) ?? 0;
    const buySell = firstStringPath(row, ['PositionBase.BuySell', 'BuySell']);
    const signed = buySell === 'Sell' ? -Math.abs(amount) : amount;
    byUic.set(uic, (byUic.get(uic) ?? 0) + signed);
  }
  return byUic;
}

function summarizeUnderlyingPrices(rows: Record<string, unknown>[]): Map<number, number> {
  const byUic = new Map<number, number>();
  for (const row of rows) {
    const uic = firstNumberPath(row, ['Uic', 'PositionBase.Uic']);
    if (uic === undefined) continue;
    const underlyingPrice = firstNumberPath(row, ['PositionView.UnderlyingCurrentPrice']);
    if (underlyingPrice !== undefined) {
      byUic.set(uic, underlyingPrice);
    }
  }
  return byUic;
}

function earliestDte(legs: StrategyLegSnapshotInput[], now: Date): number | undefined {
  const dtes = legs
    .map(leg => leg.expiry ? Math.ceil((Date.parse(leg.expiry) - now.getTime()) / 86_400_000) : undefined)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return dtes.length ? Math.max(0, Math.min(...dtes)) : undefined;
}

function feedRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.Data)) return value.Data.filter(isRecord);
  return [];
}

function firstNumberPath(value: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const found = readPath(value, path);
    if (typeof found === 'number' && Number.isFinite(found)) return found;
    if (typeof found === 'string' && Number.isFinite(Number(found))) return Number(found);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mid(bid: number | undefined, ask: number | undefined): number | undefined {
  return typeof bid === 'number' && typeof ask === 'number' ? (bid + ask) / 2 : undefined;
}

function percent(value: number | undefined, base: number | undefined): number | undefined {
  if (value === undefined || base === undefined || base <= 0) return undefined;
  return roundMoney(Math.abs(value) / base * 100);
}

function maxDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return defined.length ? Math.max(...defined) : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function roundMoney(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function roundGreek(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 10_000) / 10_000;
}

function unique(values: number[]): number[] {
  return Array.from(new Set(values));
}
