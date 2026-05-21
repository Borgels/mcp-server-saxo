import type { SaxoClient } from './client.js';
import {
  getOptionVolatilityContext,
  type OptionVolatilityContext,
  type VolatilityRegime,
} from './option-volatility.js';
import type { MarketNewsContext, MarketSentiment } from './market-context.js';

export type OptionStrategyKind =
  | 'cash_secured_put'
  | 'put_credit_spread'
  | 'call_credit_spread'
  | 'long_call'
  | 'debit_spread'
  | 'iron_condor';

export type DirectionalBias = 'bullish' | 'bearish' | 'neutral';
export type PutCall = 'Put' | 'Call';

export interface ExternalStrategyContext {
  summary?: string;
  sentiment?: DirectionalBias;
  technicalBias?: DirectionalBias;
  volatility?: OptionVolatilityContext;
  news?: MarketNewsContext;
  riskNotes?: string[];
}

export interface GetOptionChainInput {
  keywords?: string;
  optionRootId?: number;
  accountKey?: string;
  minDte?: number;
  maxDte?: number;
  strikeWindowPercent?: number;
  putCall?: PutCall;
  limitExpiries?: number;
  limitStrikesPerExpiry?: number;
}

export interface PlanOptionStrategyInput extends GetOptionChainInput {
  accountKey: string;
  strategies?: OptionStrategyKind[];
  maxCandidates?: number;
  riskBudget?: number;
  requireGreeks?: boolean;
  maxThetaDailyPercentOfRisk?: number;
  minOpenInterest?: number;
  maxSpreadPercent?: number;
  includeVolatilityContext?: boolean;
  optionVolatilityContext?: OptionVolatilityContext;
  externalContext?: ExternalStrategyContext;
  directionalBias?: DirectionalBias;
}

interface Feed<T> {
  Data?: T[];
}

interface OptionRootSearchResult {
  AssetType?: string;
  CanParticipateInMultiLegOrder?: boolean;
  CurrencyCode?: string;
  Description?: string;
  ExchangeId?: string;
  GroupOptionRootId?: number;
  Identifier?: number;
  SummaryType?: string;
  Symbol?: string;
}

interface ContractOptionSpace {
  AssetType?: string;
  CanParticipateInMultiLegOrder?: boolean;
  ContractSize?: number;
  CurrencyCode?: string;
  DefaultOption?: {
    UnderlyingUic?: number;
  };
  Description?: string;
  Exchange?: {
    ExchangeId?: string;
    Name?: string;
  };
  ExerciseStyle?: string;
  OptionRootId?: number;
  OptionSpace?: Array<{
    DisplayDaysToExpiry?: number;
    DisplayExpiry?: string;
    Expiry?: string;
    LastTradeDate?: string;
    SpecificOptions?: Array<{
      PutCall?: PutCall;
      StrikePrice?: number;
      TradingStatus?: string;
      Uic?: number;
      UnderlyingUic?: number;
    }>;
  }>;
}

interface InfoPrice {
  DisplayAndFormat?: {
    Currency?: string;
    Description?: string;
    Symbol?: string;
  };
  ErrorCode?: string;
  InstrumentPriceDetails?: {
    IsMarketOpen?: boolean;
    OpenInterest?: number;
    ShortTradeDisabled?: boolean;
  };
  LastUpdated?: string;
  PriceInfo?: {
    NetChange?: number;
    PercentChange?: number;
  };
  PriceInfoDetails?: {
    AskSize?: number;
    BidSize?: number;
    LastClose?: number;
    LastTraded?: number;
    Open?: number;
    Volume?: number;
  };
  PriceSource?: string;
  Quote?: {
    Ask?: number;
    AskSize?: number;
    Bid?: number;
    BidSize?: number;
    DelayedByMinutes?: number;
    ErrorCode?: string;
    MarketState?: string;
    Mid?: number;
    PriceTypeAsk?: string;
    PriceTypeBid?: string;
  };
  Uic?: number;
  Greeks?: Record<string, number>;
}

interface TradablePriceResponse {
  Greeks?: Record<string, number>;
  Legs?: Array<{
    Greeks?: Record<string, number>;
    Quote?: {
      Ask?: number;
      Bid?: number;
      Mid?: number;
    };
    Uic?: number;
  }>;
  Quote?: {
    Ask?: number;
    Bid?: number;
    Mid?: number;
  };
}

interface PriceSubscriptionResponse {
  ContextId?: string;
  ReferenceId?: string;
  Snapshot?: TradablePriceResponse;
}

interface OptionContract {
  assetType: 'StockOption';
  ask?: number;
  askSize?: number;
  bid?: number;
  bidSize?: number;
  daysToExpiry: number;
  delayedByMinutes?: number;
  description?: string;
  expiry: string;
  greeks?: Record<string, number>;
  isMarketOpen?: boolean;
  lastUpdated?: string;
  mid?: number;
  openInterest?: number;
  priceSource?: string;
  putCall: PutCall;
  quoteSpreadPercent?: number;
  shortTradeDisabled?: boolean;
  strikePrice: number;
  symbol?: string;
  tradingStatus?: string;
  uic: number;
  underlyingUic?: number;
  volume?: number;
}

export interface OptionChainResult {
  optionRoot: {
    optionRootId: number;
    assetType: string;
    description?: string;
    symbol?: string;
    exchangeId?: string;
    currencyCode?: string;
    contractSize: number;
    underlyingUic?: number;
    underlyingPrice?: number;
    canParticipateInMultiLegOrder?: boolean;
    exerciseStyle?: string;
  };
  filters: {
    minDte: number;
    maxDte: number;
    strikeWindowPercent: number;
    putCall?: PutCall;
  };
  warnings: string[];
  expiries: Array<{
    expiry: string;
    daysToExpiry: number;
    contracts: OptionContract[];
  }>;
}

interface StrategyLeg {
  amount: number;
  assetType: 'StockOption';
  buySell: 'Buy' | 'Sell';
  putCall: PutCall;
  strikePrice: number;
  expiry: string;
  uic: number;
  bid?: number;
  ask?: number;
  greeks?: Record<string, number>;
  mid?: number;
  openInterest?: number;
  quoteSpreadPercent?: number;
  toOpenClose: 'ToOpen';
}

export interface StrategyGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  thetaDailyPercentOfRisk?: number;
  thetaDailyPercentOfMaxProfit?: number;
}

export interface OptionStrategyPlan {
  rank: number;
  strategy: OptionStrategyKind;
  thesis: string;
  score: {
    liquidity: number;
    structure: number;
    context: number;
    total: number;
  };
  warnings: string[];
  underlyingPrice?: number;
  expiry: string;
  daysToExpiry: number;
  contractSize: number;
  orderSide: 'Buy' | 'Sell';
  estimatedCredit?: number;
  estimatedDebit?: number;
  maxProfit?: number;
  maxLoss?: number;
  breakevens: number[];
  greeks?: StrategyGreeks;
  collateralRequired?: number;
  legs: StrategyLeg[];
  multilegPrecheckInput?: unknown;
  singleLegPrecheckInput?: unknown;
  pricing?: unknown;
}

export interface OptionStrategyPlanResult {
  optionRoot: OptionChainResult['optionRoot'];
  generatedAt: string;
  strategies: OptionStrategyKind[];
  externalContext?: ExternalStrategyContext;
  warnings: string[];
  Data: OptionStrategyPlan[];
}

const DEFAULT_STRATEGIES: OptionStrategyKind[] = [
  'cash_secured_put',
  'put_credit_spread',
  'call_credit_spread',
  'iron_condor',
];

const OPTION_PRICE_FIELD_GROUPS = [
  'DisplayAndFormat',
  'PriceInfo',
  'PriceInfoDetails',
  'Quote',
  'Greeks',
  'InstrumentPriceDetails',
].join(',');

export async function getOptionChain(
  client: SaxoClient,
  input: GetOptionChainInput,
  now: Date = new Date(),
): Promise<OptionChainResult> {
  const root = await resolveOptionRoot(client, input);
  const space = await client.get<ContractOptionSpace>(
    `/ref/v1/instruments/contractoptionspaces/${encodeURIComponent(String(root.optionRootId))}`,
    { AccountKey: input.accountKey },
  );
  const contractSize = space.ContractSize ?? 100;
  const warnings: string[] = [];
  const underlyingUic = space.DefaultOption?.UnderlyingUic;
  const underlyingPrice = underlyingUic
    ? await fetchUnderlyingPrice(client, underlyingUic, input.accountKey, warnings)
    : undefined;

  const minDte = input.minDte ?? 14;
  const maxDte = input.maxDte ?? 60;
  const strikeWindowPercent = input.strikeWindowPercent ?? 20;
  const limitExpiries = input.limitExpiries ?? 6;
  const limitStrikesPerExpiry = input.limitStrikesPerExpiry ?? 40;
  const rawContracts = flattenOptionSpace(space, now)
    .filter(contract => contract.daysToExpiry >= minDte && contract.daysToExpiry <= maxDte)
    .filter(contract => !input.putCall || contract.putCall === input.putCall)
    .filter(contract => withinStrikeWindow(contract, underlyingPrice, strikeWindowPercent));

  const byExpiry = groupByExpiry(rawContracts)
    .slice(0, limitExpiries)
    .map(expiry => ({
      ...expiry,
      contracts: trimContractsAroundUnderlying(expiry.contracts, underlyingPrice, limitStrikesPerExpiry),
    }));
  const selectedContracts = byExpiry.flatMap(expiry => expiry.contracts);
  const priceByUic = await fetchOptionPrices(client, selectedContracts, input.accountKey);

  const pricedExpiries = byExpiry
    .map(expiry => ({
      ...expiry,
      contracts: expiry.contracts
        .map(contract => enrichContract(contract, priceByUic.get(contract.uic)))
        .filter(contract => contract.tradingStatus === 'Tradable'),
    }))
    .filter(expiry => expiry.contracts.length > 0);

  if (pricedExpiries.length === 0) {
    warnings.push('No tradable option contracts matched the requested filters.');
  }

  return {
    optionRoot: {
      optionRootId: root.optionRootId,
      assetType: space.AssetType ?? root.assetType,
      description: space.Description ?? root.description,
      symbol: root.symbol,
      exchangeId: space.Exchange?.ExchangeId ?? root.exchangeId,
      currencyCode: space.CurrencyCode ?? root.currencyCode,
      contractSize,
      underlyingUic,
      underlyingPrice,
      canParticipateInMultiLegOrder: space.CanParticipateInMultiLegOrder ?? root.canParticipateInMultiLegOrder,
      exerciseStyle: space.ExerciseStyle,
    },
    filters: {
      minDte,
      maxDte,
      strikeWindowPercent,
      putCall: input.putCall,
    },
    warnings,
    expiries: pricedExpiries,
  };
}

export async function planOptionStrategy(
  client: SaxoClient,
  input: PlanOptionStrategyInput,
  now: Date = new Date(),
): Promise<OptionStrategyPlanResult> {
  const strategies = input.strategies?.length ? input.strategies : DEFAULT_STRATEGIES;
  const warnings: string[] = [];
  const chain = await getOptionChain(client, {
    ...input,
    minDte: input.minDte ?? 14,
    maxDte: input.maxDte ?? 60,
    strikeWindowPercent: input.strikeWindowPercent ?? 25,
    limitExpiries: input.limitExpiries ?? 8,
    limitStrikesPerExpiry: input.limitStrikesPerExpiry ?? 60,
  }, now);
  warnings.push(...chain.warnings);

  if (!chain.optionRoot.underlyingPrice) {
    warnings.push('Underlying price was unavailable, so option strategy scoring is limited.');
  }

  const effectiveContext = await resolveEffectiveStrategyContext(client, input, chain.optionRoot.optionRootId, warnings);
  const effectiveInput = {
    ...input,
    externalContext: effectiveContext,
  };
  const maxCandidates = clampInt(input.maxCandidates ?? 10, 1, 25);
  const minOpenInterest = input.minOpenInterest ?? 1;
  const maxSpreadPercent = input.maxSpreadPercent ?? 35;
  const plans: OptionStrategyPlan[] = [];

  for (const expiry of chain.expiries) {
    const contracts = expiry.contracts.filter(contract =>
      isUsableContract(contract, minOpenInterest, maxSpreadPercent),
    );
    if (strategies.includes('long_call')) {
      plans.push(...buildLongCalls(contracts, chain, expiry.daysToExpiry, effectiveInput));
    }
    if (strategies.includes('cash_secured_put')) {
      plans.push(...buildCashSecuredPuts(contracts, chain, expiry.daysToExpiry, effectiveInput));
    }
    if (strategies.includes('put_credit_spread')) {
      plans.push(...buildPutCreditSpreads(contracts, chain, expiry.daysToExpiry, effectiveInput));
    }
    if (strategies.includes('call_credit_spread')) {
      plans.push(...buildCallCreditSpreads(contracts, chain, expiry.daysToExpiry, effectiveInput));
    }
    if (strategies.includes('debit_spread')) {
      plans.push(...buildDebitSpreads(contracts, chain, expiry.daysToExpiry, effectiveInput));
    }
    if (strategies.includes('iron_condor')) {
      plans.push(...buildIronCondors(contracts, chain, expiry.daysToExpiry, effectiveInput));
    }
  }

  const prefilteredPlans = plans
    .filter(plan => input.riskBudget === undefined || plan.maxLoss === undefined || plan.maxLoss <= input.riskBudget)
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, prePricingCandidateLimit(plans.length, maxCandidates, input));

  await enrichTradablePricing(client, input.accountKey, prefilteredPlans);

  const { plans: greekFilteredPlans, missingGreeksCount, thetaFilteredCount } = filterByGreekRequirements(prefilteredPlans, input);
  warnings.push(...greekFilterWarnings({ missingGreeksCount, thetaFilteredCount }, input));

  const ranked = greekFilteredPlans
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, maxCandidates)
    .map((plan, index) => ({ ...plan, rank: index + 1 }));

  if (ranked.length === 0) {
    warnings.push('No option strategy candidates passed the liquidity, spread, and risk filters.');
  }

  return {
    optionRoot: chain.optionRoot,
    generatedAt: now.toISOString(),
    strategies,
    externalContext: effectiveContext,
    warnings,
    Data: ranked,
  };
}

async function resolveEffectiveStrategyContext(
  client: SaxoClient,
  input: PlanOptionStrategyInput,
  optionRootId: number,
  warnings: string[],
): Promise<ExternalStrategyContext | undefined> {
  let volatility = input.optionVolatilityContext;
  if (!volatility && input.includeVolatilityContext) {
    try {
      volatility = await getOptionVolatilityContext(client, {
        accountKey: input.accountKey,
        optionRootId,
      });
    } catch (error) {
      warnings.push(`Saxo option volatility context was unavailable: ${(error as Error).message}`);
    }
  }
  return mergeStrategyContext(input.externalContext, volatility);
}

function mergeStrategyContext(
  context: ExternalStrategyContext | undefined,
  volatility: OptionVolatilityContext | undefined,
): ExternalStrategyContext | undefined {
  if (!volatility) {
    return context;
  }
  return {
    ...context,
    summary: [context?.summary, volatility.summary].filter(Boolean).join(' '),
    volatility,
    riskNotes: [...(context?.riskNotes ?? []), ...volatility.riskNotes],
  };
}

function prePricingCandidateLimit(
  planCount: number,
  maxCandidates: number,
  input: Pick<PlanOptionStrategyInput, 'requireGreeks' | 'maxThetaDailyPercentOfRisk'>,
): number {
  if (input.requireGreeks || input.maxThetaDailyPercentOfRisk !== undefined) {
    return Math.min(planCount, Math.max(12, maxCandidates * 3));
  }
  return Math.min(planCount, maxCandidates);
}

async function enrichTradablePricing(
  client: SaxoClient,
  accountKey: string,
  plans: OptionStrategyPlan[],
): Promise<void> {
  for (const plan of plans) {
    if (plan.legs.length > 1) {
      await enrichMultiLegPricing(client, accountKey, plan);
    } else {
      await enrichSingleLegPricing(client, accountKey, plan);
    }
    refreshGreekDependentFields(plan);
  }
}

async function enrichMultiLegPricing(
  client: SaxoClient,
  accountKey: string,
  plan: OptionStrategyPlan,
): Promise<void> {
  try {
    const pricing = await client.post<TradablePriceResponse>('/trade/v1/prices/multileg', {
      AccountKey: accountKey,
      FieldGroups: ['Quote', 'Greeks', 'InstrumentPriceDetails'],
      Legs: plan.legs.map(leg => ({
        Amount: leg.amount,
        AssetType: leg.assetType,
        BuySell: leg.buySell,
        ToOpenClose: leg.toOpenClose,
        Uic: leg.uic,
      })),
    });
    plan.pricing = pricing;
    applyTradablePricingGreeks(plan, pricing);
  } catch (error) {
    plan.warnings.push(`Saxo multi-leg pricing was unavailable: ${(error as Error).message}`);
  }
}

async function enrichSingleLegPricing(
  client: SaxoClient,
  accountKey: string,
  plan: OptionStrategyPlan,
): Promise<void> {
  const firstLeg = plan.legs[0];
  if (!firstLeg) {
    return;
  }
  const contextId = `mcp_saxo_price_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referenceId = `leg_${firstLeg.uic}`;
  let created = false;
  try {
    const response = await client.post<PriceSubscriptionResponse>('/trade/v1/prices/subscriptions', {
      Arguments: {
        AccountKey: accountKey,
        Amount: firstLeg.amount,
        AssetType: firstLeg.assetType,
        FieldGroups: ['Quote', 'Greeks', 'InstrumentPriceDetails'],
        Uic: firstLeg.uic,
      },
      ContextId: contextId,
      Format: 'application/json',
      ReferenceId: referenceId,
      RefreshRate: 1000,
    });
    created = true;
    plan.pricing = response.Snapshot;
    if (response.Snapshot) {
      applyTradablePricingGreeks(plan, response.Snapshot);
    }
  } catch (error) {
    plan.warnings.push(`Saxo price subscription snapshot was unavailable: ${(error as Error).message}`);
  } finally {
    if (created) {
      try {
        await client.delete(
          `/trade/v1/prices/subscriptions/${encodeURIComponent(contextId)}/${encodeURIComponent(referenceId)}`,
        );
      } catch {
        // Best-effort cleanup. Saxo also expires inactive subscriptions.
      }
    }
  }
}

async function resolveOptionRoot(
  client: SaxoClient,
  input: GetOptionChainInput,
): Promise<{
  optionRootId: number;
  assetType: string;
  canParticipateInMultiLegOrder?: boolean;
  currencyCode?: string;
  description?: string;
  exchangeId?: string;
  symbol?: string;
}> {
  if (typeof input.optionRootId === 'number') {
    return {
      optionRootId: input.optionRootId,
      assetType: 'StockOption',
    };
  }
  if (!input.keywords?.trim()) {
    throw new Error('Set either optionRootId or keywords to resolve a StockOption root.');
  }

  const response = await client.get<Feed<OptionRootSearchResult>>('/ref/v1/instruments', {
    AccountKey: input.accountKey,
    AssetTypes: 'StockOption',
    Keywords: input.keywords,
    $top: 10,
  });
  const root = chooseOptionRoot(response.Data ?? [], input.keywords);

  if (!root?.Identifier) {
    throw new Error(`No StockOption root found for keywords=${JSON.stringify(input.keywords)}.`);
  }

  return {
    optionRootId: root.GroupOptionRootId ?? root.Identifier,
    assetType: root.AssetType ?? 'StockOption',
    canParticipateInMultiLegOrder: root.CanParticipateInMultiLegOrder,
    currencyCode: root.CurrencyCode,
    description: root.Description,
    exchangeId: root.ExchangeId,
    symbol: root.Symbol,
  };
}

function chooseOptionRoot(
  roots: OptionRootSearchResult[],
  keywords: string,
): OptionRootSearchResult | undefined {
  const keyword = displayRootSymbol(keywords);
  return roots
    .filter(item => typeof item.Identifier === 'number')
    .sort((a, b) => optionRootScore(b, keyword) - optionRootScore(a, keyword))
    .at(0);
}

function optionRootScore(root: OptionRootSearchResult, keyword: string): number {
  const symbol = displayRootSymbol(root.Symbol ?? '');
  return (
    (root.SummaryType === 'ContractOptionRoot' ? 100 : 0) +
    (root.ExchangeId === 'OPRA' ? 50 : 0) +
    (root.CurrencyCode === 'USD' ? 25 : 0) +
    (symbol === keyword ? 20 : 0) +
    (symbol.startsWith(keyword) ? 5 : 0)
  );
}

function displayRootSymbol(symbol: string): string {
  return symbol.trim().split(':')[0]?.toUpperCase() ?? symbol.trim().toUpperCase();
}

async function fetchUnderlyingPrice(
  client: SaxoClient,
  uic: number,
  accountKey: string | undefined,
  warnings: string[],
): Promise<number | undefined> {
  try {
    const response = await client.get<InfoPrice>('/trade/v1/infoprices', {
      AccountKey: accountKey,
      AssetType: 'Stock',
      FieldGroups: 'DisplayAndFormat,PriceInfo,PriceInfoDetails,Quote',
      Uic: uic,
    });
    return response.Quote?.Mid ?? mid(response.Quote?.Bid, response.Quote?.Ask) ?? response.PriceInfoDetails?.LastTraded;
  } catch (error) {
    warnings.push(`Could not fetch underlying stock price for Uic ${uic}: ${(error as Error).message}`);
    return undefined;
  }
}

async function fetchOptionPrices(
  client: SaxoClient,
  contracts: Array<{ uic: number }>,
  accountKey?: string,
): Promise<Map<number, InfoPrice>> {
  const prices = new Map<number, InfoPrice>();
  for (const batch of chunk(contracts, 100)) {
    if (batch.length === 0) {
      continue;
    }
    const response = await client.get<Feed<InfoPrice>>('/trade/v1/infoprices/list', {
      AccountKey: accountKey,
      AssetType: 'StockOption',
      FieldGroups: OPTION_PRICE_FIELD_GROUPS,
      Uics: batch.map(contract => contract.uic).join(','),
    });
    for (const price of response.Data ?? []) {
      if (typeof price.Uic === 'number') {
        prices.set(price.Uic, price);
      }
    }
  }
  return prices;
}

function flattenOptionSpace(space: ContractOptionSpace, now: Date): OptionContract[] {
  const contracts: OptionContract[] = [];
  for (const expiry of space.OptionSpace ?? []) {
    const expiryDate = expiry.Expiry ?? expiry.DisplayExpiry;
    if (!expiryDate) {
      continue;
    }
    const daysToExpiry = expiry.DisplayDaysToExpiry ?? daysBetween(now, expiryDate);
    for (const option of expiry.SpecificOptions ?? []) {
      if (
        typeof option.Uic !== 'number' ||
        typeof option.StrikePrice !== 'number' ||
        (option.PutCall !== 'Put' && option.PutCall !== 'Call')
      ) {
        continue;
      }
      contracts.push({
        assetType: 'StockOption',
        daysToExpiry,
        expiry: expiryDate.slice(0, 10),
        putCall: option.PutCall,
        strikePrice: option.StrikePrice,
        tradingStatus: option.TradingStatus,
        uic: option.Uic,
        underlyingUic: option.UnderlyingUic,
      });
    }
  }
  return contracts;
}

function enrichContract(contract: OptionContract, price?: InfoPrice): OptionContract {
  const bid = price?.Quote?.Bid;
  const ask = price?.Quote?.Ask;
  const quoteMid = price?.Quote?.Mid ?? mid(bid, ask);
  return {
    ...contract,
    ask,
    askSize: price?.Quote?.AskSize ?? price?.PriceInfoDetails?.AskSize,
    bid,
    bidSize: price?.Quote?.BidSize ?? price?.PriceInfoDetails?.BidSize,
    delayedByMinutes: price?.Quote?.DelayedByMinutes,
    description: price?.DisplayAndFormat?.Description,
    greeks: price?.Greeks,
    isMarketOpen: price?.InstrumentPriceDetails?.IsMarketOpen,
    lastUpdated: price?.LastUpdated,
    mid: quoteMid,
    openInterest: price?.InstrumentPriceDetails?.OpenInterest,
    priceSource: price?.PriceSource,
    quoteSpreadPercent: spreadPercent(bid, ask),
    shortTradeDisabled: price?.InstrumentPriceDetails?.ShortTradeDisabled,
    symbol: price?.DisplayAndFormat?.Symbol,
    volume: price?.PriceInfoDetails?.Volume,
  };
}

function groupByExpiry(contracts: OptionContract[]): Array<{
  expiry: string;
  daysToExpiry: number;
  contracts: OptionContract[];
}> {
  const groups = new Map<string, OptionContract[]>();
  for (const contract of contracts) {
    groups.set(contract.expiry, [...(groups.get(contract.expiry) ?? []), contract]);
  }
  return Array.from(groups.entries())
    .map(([expiry, items]) => ({
      expiry,
      daysToExpiry: items[0]?.daysToExpiry ?? 0,
      contracts: items.sort((a, b) => a.strikePrice - b.strikePrice || a.putCall.localeCompare(b.putCall)),
    }))
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}

function trimContractsAroundUnderlying(
  contracts: OptionContract[],
  underlyingPrice: number | undefined,
  limit: number,
): OptionContract[] {
  if (!underlyingPrice || contracts.length <= limit) {
    return contracts.slice(0, limit);
  }
  return [...contracts]
    .sort((a, b) => Math.abs(a.strikePrice - underlyingPrice) - Math.abs(b.strikePrice - underlyingPrice))
    .slice(0, limit)
    .sort((a, b) => a.strikePrice - b.strikePrice || a.putCall.localeCompare(b.putCall));
}

function withinStrikeWindow(
  contract: OptionContract,
  underlyingPrice: number | undefined,
  windowPercent: number,
): boolean {
  if (!underlyingPrice) {
    return true;
  }
  const distance = Math.abs(contract.strikePrice - underlyingPrice) / underlyingPrice * 100;
  return distance <= windowPercent;
}

function isUsableContract(
  contract: OptionContract,
  minOpenInterest: number,
  maxSpreadPercent: number,
): boolean {
  return (
    contract.tradingStatus === 'Tradable' &&
    typeof contract.bid === 'number' &&
    typeof contract.ask === 'number' &&
    contract.bid > 0 &&
    contract.ask > 0 &&
    contract.ask >= contract.bid &&
    (contract.openInterest ?? 0) >= minOpenInterest &&
    (contract.quoteSpreadPercent ?? 1000) <= maxSpreadPercent
  );
}

function buildCashSecuredPuts(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const underlying = chain.optionRoot.underlyingPrice;
  const puts = contracts
    .filter(contract => contract.putCall === 'Put')
    .filter(contract => !underlying || contract.strikePrice < underlying)
    .filter(contract => !underlying || moneynessDistance(contract, underlying) >= 3 && moneynessDistance(contract, underlying) <= 20);

  return puts.map(put => {
    const credit = put.bid ?? 0;
    const maxProfit = credit * chain.optionRoot.contractSize;
    const maxLoss = Math.max(0, (put.strikePrice - credit) * chain.optionRoot.contractSize);
    const plan = basePlan('cash_secured_put', [leg(put, 'Sell')], chain, daysToExpiry, input, {
      estimatedCredit: credit,
      maxProfit,
      maxLoss,
      breakevens: [put.strikePrice - credit],
      collateralRequired: put.strikePrice * chain.optionRoot.contractSize,
      orderSide: 'Sell',
      thesis: 'Sell an out-of-the-money put to collect premium with willingness to own the underlying at the breakeven.',
    });
    plan.singleLegPrecheckInput = {
      AccountKey: input.accountKey,
      Uic: put.uic,
      AssetType: 'StockOption',
      BuySell: 'Sell',
      Amount: 1,
      OrderType: 'Limit',
      OrderPrice: roundPrice(credit),
      OrderDuration: { DurationType: 'DayOrder' },
      ManualOrder: true,
    };
    return plan;
  });
}

function buildLongCalls(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const underlying = chain.optionRoot.underlyingPrice;
  const calls = contracts
    .filter(contract => contract.putCall === 'Call')
    .filter(contract => !underlying || moneynessDistance(contract, underlying) <= 35);

  return calls.map(call => {
    const debit = call.ask ?? call.mid ?? 0;
    const maxLoss = debit * chain.optionRoot.contractSize;
    const plan = basePlan('long_call', [leg(call, 'Buy')], chain, daysToExpiry, input, {
      estimatedDebit: debit,
      maxLoss,
      breakevens: [call.strikePrice + debit],
      orderSide: 'Buy',
      thesis: 'Buy a call option to express bullish convexity with defined premium risk and uncapped upside before expiry.',
    });
    plan.singleLegPrecheckInput = {
      AccountKey: input.accountKey,
      Uic: call.uic,
      AssetType: 'StockOption',
      BuySell: 'Buy',
      Amount: 1,
      OrderType: 'Limit',
      OrderPrice: roundPrice(debit),
      OrderDuration: { DurationType: 'DayOrder' },
      ManualOrder: true,
    };
    return plan;
  });
}

function buildPutCreditSpreads(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const underlying = chain.optionRoot.underlyingPrice;
  const puts = contracts.filter(contract => contract.putCall === 'Put');
  const plans: OptionStrategyPlan[] = [];
  for (const shortPut of puts) {
    if (underlying && shortPut.strikePrice >= underlying) {
      continue;
    }
    for (const longPut of puts) {
      if (longPut.strikePrice >= shortPut.strikePrice) {
        continue;
      }
      const width = shortPut.strikePrice - longPut.strikePrice;
      if (width <= 0 || width > Math.max(25, shortPut.strikePrice * 0.12)) {
        continue;
      }
      const credit = (shortPut.bid ?? 0) - (longPut.ask ?? 0);
      if (credit <= 0) {
        continue;
      }
      plans.push(basePlan('put_credit_spread', [leg(shortPut, 'Sell'), leg(longPut, 'Buy')], chain, daysToExpiry, input, {
        estimatedCredit: credit,
        maxProfit: credit * chain.optionRoot.contractSize,
        maxLoss: (width - credit) * chain.optionRoot.contractSize,
        breakevens: [shortPut.strikePrice - credit],
        orderSide: 'Sell',
        thesis: 'Sell a put credit spread to express neutral-to-bullish income with capped downside risk.',
      }));
    }
  }
  return plans;
}

function buildCallCreditSpreads(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const underlying = chain.optionRoot.underlyingPrice;
  const calls = contracts.filter(contract => contract.putCall === 'Call');
  const plans: OptionStrategyPlan[] = [];
  for (const shortCall of calls) {
    if (underlying && shortCall.strikePrice <= underlying) {
      continue;
    }
    for (const longCall of calls) {
      if (longCall.strikePrice <= shortCall.strikePrice) {
        continue;
      }
      const width = longCall.strikePrice - shortCall.strikePrice;
      if (width <= 0 || width > Math.max(25, shortCall.strikePrice * 0.12)) {
        continue;
      }
      const credit = (shortCall.bid ?? 0) - (longCall.ask ?? 0);
      if (credit <= 0) {
        continue;
      }
      plans.push(basePlan('call_credit_spread', [leg(shortCall, 'Sell'), leg(longCall, 'Buy')], chain, daysToExpiry, input, {
        estimatedCredit: credit,
        maxProfit: credit * chain.optionRoot.contractSize,
        maxLoss: (width - credit) * chain.optionRoot.contractSize,
        breakevens: [shortCall.strikePrice + credit],
        orderSide: 'Sell',
        thesis: 'Sell a call credit spread to express neutral-to-bearish income with capped upside risk.',
      }));
    }
  }
  return plans;
}

function buildDebitSpreads(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const bias = input.directionalBias ?? input.externalContext?.technicalBias ?? input.externalContext?.sentiment ?? 'bullish';
  if (bias === 'bearish') {
    return buildBearishPutDebitSpreads(contracts, chain, daysToExpiry, input);
  }
  return buildBullishCallDebitSpreads(contracts, chain, daysToExpiry, input);
}

function buildBullishCallDebitSpreads(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const calls = contracts.filter(contract => contract.putCall === 'Call');
  const plans: OptionStrategyPlan[] = [];
  for (const longCall of calls) {
    for (const shortCall of calls) {
      if (shortCall.strikePrice <= longCall.strikePrice) {
        continue;
      }
      const width = shortCall.strikePrice - longCall.strikePrice;
      const debit = (longCall.ask ?? 0) - (shortCall.bid ?? 0);
      if (debit <= 0 || debit >= width) {
        continue;
      }
      plans.push(basePlan('debit_spread', [leg(longCall, 'Buy'), leg(shortCall, 'Sell')], chain, daysToExpiry, input, {
        estimatedDebit: debit,
        maxProfit: (width - debit) * chain.optionRoot.contractSize,
        maxLoss: debit * chain.optionRoot.contractSize,
        breakevens: [longCall.strikePrice + debit],
        orderSide: 'Buy',
        thesis: 'Buy a call debit spread to express bullish direction with capped downside and capped upside.',
      }));
    }
  }
  return plans;
}

function buildBearishPutDebitSpreads(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const puts = contracts.filter(contract => contract.putCall === 'Put');
  const plans: OptionStrategyPlan[] = [];
  for (const longPut of puts) {
    for (const shortPut of puts) {
      if (shortPut.strikePrice >= longPut.strikePrice) {
        continue;
      }
      const width = longPut.strikePrice - shortPut.strikePrice;
      const debit = (longPut.ask ?? 0) - (shortPut.bid ?? 0);
      if (debit <= 0 || debit >= width) {
        continue;
      }
      plans.push(basePlan('debit_spread', [leg(longPut, 'Buy'), leg(shortPut, 'Sell')], chain, daysToExpiry, input, {
        estimatedDebit: debit,
        maxProfit: (width - debit) * chain.optionRoot.contractSize,
        maxLoss: debit * chain.optionRoot.contractSize,
        breakevens: [longPut.strikePrice - debit],
        orderSide: 'Buy',
        thesis: 'Buy a put debit spread to express bearish direction with capped downside and capped upside.',
      }));
    }
  }
  return plans;
}

function buildIronCondors(
  contracts: OptionContract[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
): OptionStrategyPlan[] {
  const putSpreads = buildPutCreditSpreads(contracts, chain, daysToExpiry, input).slice(0, 15);
  const callSpreads = buildCallCreditSpreads(contracts, chain, daysToExpiry, input).slice(0, 15);
  const plans: OptionStrategyPlan[] = [];
  for (const putSpread of putSpreads) {
    for (const callSpread of callSpreads) {
      const putShort = putSpread.legs[0];
      const callShort = callSpread.legs[0];
      if (!putShort || !callShort || putShort.strikePrice >= callShort.strikePrice) {
        continue;
      }
      const putLong = putSpread.legs[1];
      const callLong = callSpread.legs[1];
      if (!putLong || !callLong) {
        continue;
      }
      const credit = (putSpread.estimatedCredit ?? 0) + (callSpread.estimatedCredit ?? 0);
      const putWidth = Math.abs(putShort.strikePrice - putLong.strikePrice);
      const callWidth = Math.abs(callLong.strikePrice - callShort.strikePrice);
      const maxWidth = Math.max(putWidth, callWidth);
      if (credit <= 0 || credit >= maxWidth) {
        continue;
      }
      plans.push(basePlan('iron_condor', [...putSpread.legs, ...callSpread.legs], chain, daysToExpiry, input, {
        estimatedCredit: credit,
        maxProfit: credit * chain.optionRoot.contractSize,
        maxLoss: (maxWidth - credit) * chain.optionRoot.contractSize,
        breakevens: [putShort.strikePrice - credit, callShort.strikePrice + credit],
        orderSide: 'Sell',
        thesis: 'Sell an iron condor to express range-bound income with capped risk on both tails.',
      }));
    }
  }
  return plans;
}

function basePlan(
  strategy: OptionStrategyKind,
  legs: StrategyLeg[],
  chain: OptionChainResult,
  daysToExpiry: number,
  input: PlanOptionStrategyInput,
  economics: {
    estimatedCredit?: number;
    estimatedDebit?: number;
    maxProfit?: number;
    maxLoss?: number;
    breakevens: number[];
    collateralRequired?: number;
    orderSide: 'Buy' | 'Sell';
    thesis: string;
  },
): OptionStrategyPlan {
  const liquidity = scoreLiquidity(legs);
  const greeks = aggregateStrategyGreeks(legs, chain.optionRoot.contractSize, economics);
  const structure = scoreStructure(strategy, economics, chain.optionRoot.underlyingPrice, daysToExpiry);
  const context = scoreContext(strategy, input);
  const greekScore = scoreGreekRisk(strategy, greeks);
  const total = roundScore(liquidity * 0.3 + structure * 0.3 + context * 0.25 + greekScore * 0.15);
  const warnings = collectPlanWarnings(legs, economics, strategy, greeks, daysToExpiry);
  const orderPrice = economics.estimatedCredit ?? economics.estimatedDebit ?? 0;
  const plan: OptionStrategyPlan = {
    rank: 0,
    strategy,
    thesis: economics.thesis,
    score: {
      liquidity,
      structure,
      context,
      total,
    },
    warnings,
    underlyingPrice: chain.optionRoot.underlyingPrice,
    expiry: legs[0]?.expiry ?? '',
    daysToExpiry,
    contractSize: chain.optionRoot.contractSize,
    orderSide: economics.orderSide,
    estimatedCredit: economics.estimatedCredit === undefined ? undefined : roundPrice(economics.estimatedCredit),
    estimatedDebit: economics.estimatedDebit === undefined ? undefined : roundPrice(economics.estimatedDebit),
    maxProfit: economics.maxProfit === undefined ? undefined : roundMoney(economics.maxProfit),
    maxLoss: economics.maxLoss === undefined ? undefined : roundMoney(economics.maxLoss),
    breakevens: economics.breakevens.map(roundPrice),
    greeks,
    collateralRequired:
      economics.collateralRequired === undefined ? undefined : roundMoney(economics.collateralRequired),
    legs,
  };

  if (legs.length > 1) {
    plan.multilegPrecheckInput = {
      AccountKey: input.accountKey,
      OrderDuration: { DurationType: 'DayOrder' },
      OrderPrice: roundPrice(orderPrice),
      OrderType: 'Limit',
      ManualOrder: true,
      Legs: legs.map(item => ({
        Amount: item.amount,
        AssetType: item.assetType,
        BuySell: item.buySell,
        ToOpenClose: item.toOpenClose,
        ManualOrder: true,
        Uic: item.uic,
      })),
    };
  }

  return plan;
}

function leg(contract: OptionContract, buySell: 'Buy' | 'Sell'): StrategyLeg {
  return {
    amount: 1,
    assetType: 'StockOption',
    buySell,
    putCall: contract.putCall,
    strikePrice: contract.strikePrice,
    expiry: contract.expiry,
    uic: contract.uic,
    bid: contract.bid,
    ask: contract.ask,
    greeks: contract.greeks,
    mid: contract.mid,
    openInterest: contract.openInterest,
    quoteSpreadPercent: contract.quoteSpreadPercent,
    toOpenClose: 'ToOpen',
  };
}

function applyTradablePricingGreeks(plan: OptionStrategyPlan, pricing: TradablePriceResponse): void {
  for (const pricedLeg of pricing.Legs ?? []) {
    if (typeof pricedLeg.Uic !== 'number' || !pricedLeg.Greeks) {
      continue;
    }
    const planLeg = plan.legs.find(item => item.uic === pricedLeg.Uic);
    if (planLeg) {
      planLeg.greeks = pricedLeg.Greeks;
    }
  }

  const legGreeks = aggregateStrategyGreeks(plan.legs, plan.contractSize, {
    maxLoss: plan.maxLoss,
    maxProfit: plan.maxProfit,
  });
  if (legGreeks) {
    plan.greeks = legGreeks;
    return;
  }

  const strategyGreeks = strategyGreeksFromSaxo(pricing.Greeks, {
    maxLoss: plan.maxLoss,
    maxProfit: plan.maxProfit,
  });
  if (strategyGreeks) {
    plan.greeks = strategyGreeks;
  }
}

function strategyGreeksFromSaxo(
  greeks: Record<string, number> | undefined,
  economics: { maxLoss?: number; maxProfit?: number },
): StrategyGreeks | undefined {
  const delta = readGreek(greeks, 'delta');
  const gamma = readGreek(greeks, 'gamma');
  const theta = readGreek(greeks, 'theta');
  const vega = readGreek(greeks, 'vega');
  if ([delta, gamma, theta, vega].every(value => value === undefined)) {
    return undefined;
  }
  return {
    delta: roundGreek(delta),
    gamma: roundGreek(gamma),
    theta: roundGreek(theta),
    vega: roundGreek(vega),
    thetaDailyPercentOfRisk: percentOf(theta, economics.maxLoss),
    thetaDailyPercentOfMaxProfit: percentOf(theta, economics.maxProfit),
  };
}

function refreshGreekDependentFields(plan: OptionStrategyPlan): void {
  const greekScore = scoreGreekRisk(plan.strategy, plan.greeks);
  plan.score.total = roundScore(
    plan.score.liquidity * 0.3 +
    plan.score.structure * 0.3 +
    plan.score.context * 0.25 +
    greekScore * 0.15,
  );
  plan.warnings = refreshGreekWarnings(plan.warnings, plan.strategy, plan.greeks, plan.daysToExpiry);
}

function refreshGreekWarnings(
  warnings: string[],
  strategy: OptionStrategyKind,
  greeks: StrategyGreeks | undefined,
  daysToExpiry: number,
): string[] {
  const retained = warnings.filter(warning =>
    !warning.startsWith('Saxo Greeks were unavailable;') &&
    !warning.startsWith('Theta drag is high for this long-premium structure') &&
    !warning.startsWith('Short-dated gamma exposure is elevated;'),
  );
  return Array.from(new Set([...retained, ...greekWarnings(strategy, greeks, daysToExpiry)]));
}

function greekWarnings(
  strategy: OptionStrategyKind,
  greeks: StrategyGreeks | undefined,
  daysToExpiry: number,
): string[] {
  if (!greeks) {
    return ['Saxo Greeks were unavailable; theta, delta, gamma, and vega risk were not included in scoring.'];
  }
  if ((strategy === 'long_call' || strategy === 'debit_spread') && (greeks.thetaDailyPercentOfRisk ?? 0) > 1) {
    return [`Theta drag is high for this long-premium structure (${greeks.thetaDailyPercentOfRisk}% of max risk per day).`];
  }
  if (daysToExpiry <= 14 && Math.abs(greeks.gamma ?? 0) > 20) {
    return ['Short-dated gamma exposure is elevated; size and exits need extra discipline.'];
  }
  return [];
}

function filterByGreekRequirements(plans: OptionStrategyPlan[], input: PlanOptionStrategyInput): {
  plans: OptionStrategyPlan[];
  missingGreeksCount: number;
  thetaFilteredCount: number;
} {
  const filtered: OptionStrategyPlan[] = [];
  let missingGreeksCount = 0;
  let thetaFilteredCount = 0;

  for (const plan of plans) {
    if (input.requireGreeks && !hasCompleteCoreGreeks(plan.greeks)) {
      missingGreeksCount += 1;
      continue;
    }
    if (
      input.maxThetaDailyPercentOfRisk !== undefined &&
      plan.greeks?.theta !== undefined &&
      plan.greeks.theta < 0 &&
      (plan.greeks.thetaDailyPercentOfRisk ?? Number.POSITIVE_INFINITY) > input.maxThetaDailyPercentOfRisk
    ) {
      thetaFilteredCount += 1;
      continue;
    }
    filtered.push(plan);
  }

  return { plans: filtered, missingGreeksCount, thetaFilteredCount };
}

function hasCompleteCoreGreeks(greeks: StrategyGreeks | undefined): boolean {
  return greeks?.delta !== undefined &&
    greeks.gamma !== undefined &&
    greeks.theta !== undefined &&
    greeks.vega !== undefined;
}

function greekFilterWarnings(
  counts: { missingGreeksCount: number; thetaFilteredCount: number },
  input: PlanOptionStrategyInput,
): string[] {
  const warnings: string[] = [];
  if (counts.missingGreeksCount > 0) {
    warnings.push(`Filtered ${counts.missingGreeksCount} option candidate(s) because complete Saxo Greeks were unavailable.`);
  }
  if (counts.thetaFilteredCount > 0 && input.maxThetaDailyPercentOfRisk !== undefined) {
    warnings.push(
      `Filtered ${counts.thetaFilteredCount} option candidate(s) because theta drag exceeded ` +
      `${input.maxThetaDailyPercentOfRisk}% of max risk per day.`,
    );
  }
  return warnings;
}

function aggregateStrategyGreeks(
  legs: StrategyLeg[],
  contractSize: number,
  economics: { maxLoss?: number; maxProfit?: number },
): StrategyGreeks | undefined {
  const delta = aggregateGreek(legs, 'delta', contractSize);
  const gamma = aggregateGreek(legs, 'gamma', contractSize);
  const theta = aggregateGreek(legs, 'theta', contractSize);
  const vega = aggregateGreek(legs, 'vega', contractSize);
  if ([delta, gamma, theta, vega].every(value => value === undefined)) {
    return undefined;
  }
  return {
    delta: roundGreek(delta),
    gamma: roundGreek(gamma),
    theta: roundGreek(theta),
    vega: roundGreek(vega),
    thetaDailyPercentOfRisk: percentOf(theta, economics.maxLoss),
    thetaDailyPercentOfMaxProfit: percentOf(theta, economics.maxProfit),
  };
}

function aggregateGreek(legs: StrategyLeg[], name: 'delta' | 'gamma' | 'theta' | 'vega', contractSize: number): number | undefined {
  let found = false;
  let total = 0;
  for (const legItem of legs) {
    const value = readGreek(legItem.greeks, name);
    if (value === undefined) {
      continue;
    }
    found = true;
    const sign = legItem.buySell === 'Buy' ? 1 : -1;
    total += sign * value * legItem.amount * contractSize;
  }
  return found ? total : undefined;
}

function readGreek(greeks: Record<string, number> | undefined, name: 'delta' | 'gamma' | 'theta' | 'vega'): number | undefined {
  if (!greeks) {
    return undefined;
  }
  const entry = Object.entries(greeks).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function percentOf(value: number | undefined, base: number | undefined): number | undefined {
  if (value === undefined || base === undefined || base <= 0) {
    return undefined;
  }
  return roundPrice(Math.abs(value) / base * 100);
}

function roundGreek(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 10_000) / 10_000;
}

function scoreGreekRisk(strategy: OptionStrategyKind, greeks: StrategyGreeks | undefined): number {
  if (!greeks || greeks.theta === undefined) {
    return 60;
  }
  const thetaDrag = greeks.theta < 0 ? (greeks.thetaDailyPercentOfRisk ?? 0) : 0;
  if (strategy === 'long_call' || strategy === 'debit_spread') {
    return roundScore(scaleDown(thetaDrag, 0.25, 3));
  }
  if (strategy === 'cash_secured_put' || strategy === 'put_credit_spread' || strategy === 'call_credit_spread' || strategy === 'iron_condor') {
    return greeks.theta >= 0 ? 85 : roundScore(scaleDown(thetaDrag, 0.25, 2));
  }
  return 60;
}

function scoreLiquidity(legs: StrategyLeg[]): number {
  const scores = legs.map(item => {
    const spreadScore = scaleDown(item.quoteSpreadPercent ?? 100, 5, 35);
    const oiScore = scaleUp(item.openInterest ?? 0, 0, 1000);
    const sizeScore = scaleUp(Math.min(item.bid ?? 0, item.ask ?? 0), 0, 5);
    return spreadScore * 0.55 + oiScore * 0.3 + sizeScore * 0.15;
  });
  return roundScore(Math.min(...scores));
}

function scoreStructure(
  strategy: OptionStrategyKind,
  economics: { estimatedCredit?: number; estimatedDebit?: number; maxProfit?: number; maxLoss?: number; breakevens: number[] },
  underlyingPrice: number | undefined,
  daysToExpiry: number,
): number {
  if (strategy === 'long_call') {
    const dteScore = scaleUp(daysToExpiry, 90, 540);
    const debit = economics.estimatedDebit ?? 0;
    const distanceScore =
      underlyingPrice && economics.breakevens.length
        ? Math.min(...economics.breakevens.map(value => Math.abs(value - underlyingPrice) / underlyingPrice * 100))
        : 25;
    const breakevenScore = scaleDown(distanceScore, 0, 35);
    const premiumScore = underlyingPrice ? scaleDown(debit / underlyingPrice * 100, 1, 35) : 50;
    return roundScore(dteScore * 0.35 + breakevenScore * 0.4 + premiumScore * 0.25);
  }
  const dteScore = scaleDown(Math.abs(daysToExpiry - 35), 0, 35);
  const rr =
    economics.maxProfit && economics.maxLoss && economics.maxLoss > 0
      ? scaleUp(economics.maxProfit / economics.maxLoss, 0.1, strategy === 'debit_spread' ? 1.5 : 0.5)
      : 40;
  const distanceScore =
    underlyingPrice && economics.breakevens.length
      ? Math.min(...economics.breakevens.map(value => Math.abs(value - underlyingPrice) / underlyingPrice * 100))
      : 0;
  const normalizedDistance =
    strategy === 'debit_spread' ? scaleDown(distanceScore, 0, 20) : scaleUp(distanceScore, 2, 15);
  return roundScore(rr * 0.45 + dteScore * 0.25 + normalizedDistance * 0.3);
}

function scoreContext(strategy: OptionStrategyKind, input: PlanOptionStrategyInput): number {
  const sentiment = input.externalContext?.sentiment;
  const technicalBias = input.externalContext?.technicalBias;
  const bias = input.directionalBias ?? technicalBias ?? sentiment ?? 'neutral';
  const directionalScore = scoreDirectionalContext(strategy, bias);
  const volatilityScore = scoreVolatilityContext(strategy, input.externalContext?.volatility?.regime);
  const newsScore = scoreNewsContext(strategy, input.externalContext?.news?.sentiment, bias);
  if (volatilityScore === undefined && newsScore === undefined) {
    return directionalScore;
  }
  const weightedScores = [
    { score: directionalScore, weight: 0.45 },
    { score: volatilityScore, weight: 0.35 },
    { score: newsScore, weight: 0.2 },
  ].filter((item): item is { score: number; weight: number } => item.score !== undefined);
  const totalWeight = weightedScores.reduce((sum, item) => sum + item.weight, 0);
  return roundScore(weightedScores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight);
}

function scoreDirectionalContext(strategy: OptionStrategyKind, bias: DirectionalBias): number {
  if (bias === 'neutral') {
    return strategy === 'iron_condor' ? 75 : 55;
  }
  if (bias === 'bullish') {
    return strategy === 'cash_secured_put' || strategy === 'put_credit_spread' || strategy === 'debit_spread' || strategy === 'long_call'
      ? 75
      : 35;
  }
  return strategy === 'call_credit_spread' || strategy === 'debit_spread' ? 75 : 35;
}

function scoreVolatilityContext(
  strategy: OptionStrategyKind,
  regime: VolatilityRegime | undefined,
): number | undefined {
  if (!regime || regime === 'unknown') {
    return undefined;
  }
  if (regime === 'low') {
    if (strategy === 'debit_spread' || strategy === 'long_call') {
      return 85;
    }
    if (strategy === 'cash_secured_put') {
      return 50;
    }
    return 40;
  }
  if (regime === 'high') {
    if (strategy === 'put_credit_spread' || strategy === 'call_credit_spread' || strategy === 'iron_condor') {
      return 95;
    }
    if (strategy === 'cash_secured_put') {
      return 65;
    }
    return strategy === 'long_call' ? 35 : 20;
  }
  return strategy === 'debit_spread' || strategy === 'long_call' ? 60 : 70;
}

function scoreNewsContext(
  strategy: OptionStrategyKind,
  sentiment: MarketSentiment | undefined,
  technicalBias: DirectionalBias,
): number | undefined {
  if (!sentiment || sentiment === 'unknown') {
    return undefined;
  }
  if (sentiment === 'mixed' || sentiment === 'neutral') {
    return strategy === 'iron_condor' ? 70 : 55;
  }
  if (sentiment === 'bullish') {
    return strategy === 'cash_secured_put' || strategy === 'put_credit_spread' || strategy === 'debit_spread' || strategy === 'long_call'
      ? sentimentAlignedScore(technicalBias, 'bullish')
      : 35;
  }
  return strategy === 'call_credit_spread' || strategy === 'debit_spread'
    ? sentimentAlignedScore(technicalBias, 'bearish')
    : 35;
}

function sentimentAlignedScore(technicalBias: DirectionalBias, sentimentBias: DirectionalBias): number {
  if (technicalBias === sentimentBias) {
    return 85;
  }
  if (technicalBias === 'neutral') {
    return 70;
  }
  return 45;
}

function collectPlanWarnings(
  legs: StrategyLeg[],
  economics: { estimatedCredit?: number; estimatedDebit?: number; maxLoss?: number },
  strategy: OptionStrategyKind,
  greeks: StrategyGreeks | undefined,
  daysToExpiry: number,
): string[] {
  const warnings: string[] = [];
  if (legs.some(item => (item.quoteSpreadPercent ?? 0) > 20)) {
    warnings.push('One or more legs have wide bid/ask spreads.');
  }
  if (legs.some(item => (item.openInterest ?? 0) < 100)) {
    warnings.push('One or more legs have low open interest.');
  }
  if ((economics.estimatedCredit ?? economics.estimatedDebit ?? 0) <= 0) {
    warnings.push('Estimated strategy price is not positive.');
  }
  if ((economics.maxLoss ?? 0) <= 0) {
    warnings.push('Max loss could not be estimated reliably.');
  }
  warnings.push(...greekWarnings(strategy, greeks, daysToExpiry));
  return warnings;
}

function moneynessDistance(contract: OptionContract, underlying: number): number {
  return Math.abs(contract.strikePrice - underlying) / underlying * 100;
}

function daysBetween(now: Date, isoDate: string): number {
  return Math.max(0, Math.ceil((Date.parse(isoDate) - now.getTime()) / 86_400_000));
}

function mid(bid: number | undefined, ask: number | undefined): number | undefined {
  if (typeof bid === 'number' && typeof ask === 'number') {
    return (bid + ask) / 2;
  }
  return undefined;
}

function spreadPercent(bid: number | undefined, ask: number | undefined): number | undefined {
  const quoteMid = mid(bid, ask);
  if (!quoteMid || typeof bid !== 'number' || typeof ask !== 'number') {
    return undefined;
  }
  return (ask - bid) / quoteMid * 100;
}

function scaleUp(value: number, low: number, high: number): number {
  if (value <= low) {
    return 0;
  }
  if (value >= high) {
    return 100;
  }
  return (value - low) / (high - low) * 100;
}

function scaleDown(value: number, low: number, high: number): number {
  if (value <= low) {
    return 100;
  }
  if (value >= high) {
    return 0;
  }
  return 100 - (value - low) / (high - low) * 100;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
