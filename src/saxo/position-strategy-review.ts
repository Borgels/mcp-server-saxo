import type { SaxoClient } from './client.js';
import { getInfoPricesList } from './prices.js';
import { listPositions } from './portfolio.js';

export type FollowUpVerdict = 'hold' | 'review' | 'consider_trim' | 'consider_close' | 'roll_watch' | 'unknown';

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
  strategyPositions?: Array<{
    name?: string;
    thesisName?: string;
    symbol?: string;
    strategy?: string;
    openedAt?: string;
    entryNetDebit?: number;
    entryNetCredit?: number;
    entryMaxRisk?: number;
    entryMaxProfit?: number;
    entryUnderlyingPrice?: number;
    legs: StrategyLegSnapshotInput[];
    rules?: {
      profitTakePercentOfMaxProfit?: number;
      lossExitPercentOfMaxRisk?: number;
      rollWhenDaysToExpiryBelow?: number;
      closeWhenDaysToExpiryBelow?: number;
      thesisInvalidBelow?: number;
      thesisInvalidAbove?: number;
      maxThetaDailyPercentOfRisk?: number;
    };
  }>;
  defaultRules?: {
    profitTakePercentOfMaxProfit?: number;
    lossExitPercentOfMaxRisk?: number;
    rollWhenDaysToExpiryBelow?: number;
    closeWhenDaysToExpiryBelow?: number;
    maxThetaDailyPercentOfRisk?: number;
  };
}

export interface StrategyFollowUpResult {
  generatedAt: string;
  filters: {
    accountKey?: string;
    strategiesProvided: number;
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
    verdict: FollowUpVerdict;
    daysToEarliestExpiry?: number;
    openLegsMatched: number;
    expectedLegs: number;
    entryMaxRisk?: number;
    entryMaxProfit?: number;
    currentValue?: number;
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
    triggeredRules: string[];
    warnings: string[];
    legs: Array<{
      uic: number;
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
  Greeks?: Record<string, number>;
  Quote?: {
    Ask?: number;
    Bid?: number;
    Mid?: number;
  };
}

export async function reviewStrategyPositions(
  client: SaxoClient,
  input: StrategyFollowUpInput,
  now: Date = new Date(),
): Promise<StrategyFollowUpResult> {
  const strategies = input.strategyPositions ?? [];
  const warnings: string[] = [];
  const positions = await listPositions(client, {
    accountKey: input.accountKey,
    clientKey: input.clientKey,
    fieldGroups: ['DisplayAndFormat', 'PositionBase', 'PositionView'],
    top: 500,
  });
  const positionRows = feedRows(positions);
  const openAmountByUic = summarizeOpenAmounts(positionRows);
  const uics = unique(strategies.flatMap(strategy => strategy.legs.map(leg => leg.uic)));
  const prices = uics.length
    ? await getInfoPricesList(client, {
      accountKey: input.accountKey,
      assetType: 'StockOption',
      fieldGroups: ['Quote', 'Greeks', 'InstrumentPriceDetails'],
      uics,
    }) as { Data?: InfoPrice[]; _warning?: string }
    : { Data: [] };
  if (prices._warning) {
    warnings.push(prices._warning);
  }
  const priceByUic = new Map((prices.Data ?? []).filter(row => typeof row.Uic === 'number').map(row => [row.Uic as number, row]));

  const reviews = strategies.map((strategy, index) =>
    reviewOneStrategy(strategy, {
      defaultRules: input.defaultRules,
      now,
      openAmountByUic,
      priceByUic,
      fallbackName: `Strategy ${index + 1}`,
    }),
  );

  const matchedLegs = reviews.reduce((total, review) => total + review.openLegsMatched, 0);
  const expectedLegs = reviews.reduce((total, review) => total + review.expectedLegs, 0);

  return {
    generatedAt: now.toISOString(),
    filters: {
      accountKey: input.accountKey,
      strategiesProvided: strategies.length,
    },
    accountPositions: {
      positionsFetched: positionRows.length,
      matchedLegs,
      unmatchedLegs: expectedLegs - matchedLegs,
    },
    reviews,
    warnings,
  };
}

function reviewOneStrategy(
  strategy: NonNullable<StrategyFollowUpInput['strategyPositions']>[number],
  context: {
    defaultRules?: StrategyFollowUpInput['defaultRules'];
    fallbackName: string;
    now: Date;
    openAmountByUic: Map<number, number>;
    priceByUic: Map<number, InfoPrice>;
  },
): StrategyFollowUpResult['reviews'][number] {
  const rules = { ...context.defaultRules, ...strategy.rules };
  const entryMaxRisk = strategy.entryMaxRisk ?? strategy.entryNetDebit;
  const entryMaxProfit = strategy.entryMaxProfit;
  const legs = strategy.legs.map(leg => reviewLeg(leg, context));
  const openLegsMatched = legs.filter(leg => leg.matched).length;
  const currentValue = aggregateCurrentValue(legs);
  const entryValue = strategy.entryNetDebit !== undefined
    ? strategy.entryNetDebit * 100
    : strategy.entryNetCredit !== undefined
      ? -strategy.entryNetCredit * 100
      : undefined;
  const unrealizedPnL = currentValue !== undefined && entryValue !== undefined
    ? currentValue - entryValue
    : undefined;
  const netGreeks = aggregateGreeks(strategy.legs, context.priceByUic, entryMaxRisk);
  const daysToEarliestExpiry = earliestDte(strategy.legs, context.now);
  const triggeredRules = triggeredFollowUpRules({
    currentValue,
    daysToEarliestExpiry,
    entryMaxProfit,
    entryMaxRisk,
    netGreeks,
    rules,
    unrealizedPnL,
  });
  const warnings = [
    openLegsMatched < strategy.legs.length ? 'One or more expected legs were not found in open positions.' : undefined,
    currentValue === undefined ? 'Current close value could not be estimated for all legs.' : undefined,
    netGreeks === undefined ? 'Greeks were unavailable for one or more reviewed legs.' : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    name: strategy.name ?? context.fallbackName,
    thesisName: strategy.thesisName,
    symbol: strategy.symbol,
    strategy: strategy.strategy,
    verdict: verdictFromRules(triggeredRules, warnings, daysToEarliestExpiry),
    daysToEarliestExpiry,
    openLegsMatched,
    expectedLegs: strategy.legs.length,
    entryMaxRisk,
    entryMaxProfit,
    currentValue: roundMoney(currentValue),
    unrealizedPnL: roundMoney(unrealizedPnL),
    unrealizedPnLPercentOfMaxRisk: percent(unrealizedPnL, entryMaxRisk),
    unrealizedPnLPercentOfMaxProfit: percent(unrealizedPnL, entryMaxProfit),
    netGreeks,
    triggeredRules,
    warnings,
    legs,
  };
}

function reviewLeg(
  leg: StrategyLegSnapshotInput,
  context: { openAmountByUic: Map<number, number>; priceByUic: Map<number, InfoPrice> },
): StrategyFollowUpResult['reviews'][number]['legs'][number] {
  const price = context.priceByUic.get(leg.uic);
  const quote = price?.Quote;
  const closeMid = quote?.Mid ?? mid(quote?.Bid, quote?.Ask);
  const openAmount = context.openAmountByUic.get(leg.uic);
  const expectedSigned = leg.buySell === 'Buy' ? Math.abs(leg.amount) : -Math.abs(leg.amount);
  const matched = openAmount !== undefined && Math.sign(openAmount) === Math.sign(expectedSigned) && Math.abs(openAmount) >= Math.abs(expectedSigned);
  const closeValue = closeMid === undefined ? undefined : closeMid * Math.abs(leg.amount) * 100 * (leg.buySell === 'Buy' ? 1 : -1);
  return {
    uic: leg.uic,
    expectedAmount: expectedSigned,
    openAmount,
    closeMid: roundMoney(closeMid),
    closeValue: roundMoney(closeValue),
    greeks: price?.Greeks,
    matched,
    warnings: [
      !matched ? 'Expected leg was not matched to an open position with the same direction.' : undefined,
      closeMid === undefined ? 'Bid/ask midpoint was unavailable.' : undefined,
      !price?.Greeks ? 'Greeks unavailable for leg.' : undefined,
    ].filter((item): item is string => Boolean(item)),
  };
}

function triggeredFollowUpRules(input: {
  currentValue?: number;
  daysToEarliestExpiry?: number;
  entryMaxProfit?: number;
  entryMaxRisk?: number;
  netGreeks?: NonNullable<StrategyFollowUpResult['reviews'][number]['netGreeks']>;
  rules: NonNullable<StrategyFollowUpInput['defaultRules']>;
  unrealizedPnL?: number;
}): string[] {
  const triggered: string[] = [];
  if (
    input.rules.profitTakePercentOfMaxProfit !== undefined &&
    input.unrealizedPnL !== undefined &&
    input.entryMaxProfit !== undefined &&
    input.unrealizedPnL >= input.entryMaxProfit * input.rules.profitTakePercentOfMaxProfit / 100
  ) {
    triggered.push(`Profit target reached: P/L is at least ${input.rules.profitTakePercentOfMaxProfit}% of max profit.`);
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
    input.rules.rollWhenDaysToExpiryBelow !== undefined &&
    input.daysToEarliestExpiry !== undefined &&
    input.daysToEarliestExpiry <= input.rules.rollWhenDaysToExpiryBelow
  ) {
    triggered.push(`Roll watch: ${input.daysToEarliestExpiry} DTE is at or below ${input.rules.rollWhenDaysToExpiryBelow}.`);
  }
  if (
    input.rules.closeWhenDaysToExpiryBelow !== undefined &&
    input.daysToEarliestExpiry !== undefined &&
    input.daysToEarliestExpiry <= input.rules.closeWhenDaysToExpiryBelow
  ) {
    triggered.push(`Close watch: ${input.daysToEarliestExpiry} DTE is at or below ${input.rules.closeWhenDaysToExpiryBelow}.`);
  }
  if (
    input.rules.maxThetaDailyPercentOfRisk !== undefined &&
    input.netGreeks?.theta !== undefined &&
    input.netGreeks.theta < 0 &&
    (input.netGreeks.thetaDailyPercentOfRisk ?? 0) > input.rules.maxThetaDailyPercentOfRisk
  ) {
    triggered.push(`Theta rule reached: daily theta exceeds ${input.rules.maxThetaDailyPercentOfRisk}% of max risk.`);
  }
  return triggered;
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
    const value = readGreek(priceByUic.get(leg.uic)?.Greeks, name);
    if (value === undefined) {
      continue;
    }
    found = true;
    total += (leg.buySell === 'Buy' ? 1 : -1) * value * Math.abs(leg.amount) * 100;
  }
  return found ? total : undefined;
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

function roundMoney(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function roundGreek(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 10_000) / 10_000;
}

function unique(values: number[]): number[] {
  return Array.from(new Set(values));
}
