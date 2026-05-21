export type StrategyRiskPlaybook =
  | 'income_30_60d'
  | 'aggressive_short_term'
  | 'earnings_defined_risk'
  | 'long_term_directional'
  | 'leaps_replacement'
  | 'quality_put_write';

export type StrategyDirection = 'bullish' | 'bearish' | 'neutral';

export interface PlaybookRiskDefaults {
  profitTakePercentOfMaxProfit: number;
  stopSigmaMultiple: number;
  targetSigmaMultiple: number;
  timeStopDte: number;
  profitTakeReviewWhenDteRemainingPercent: number;
}

export interface StrategyRiskAnalyticsInput {
  annualizedVolatilityPercent?: number;
  averageRange14dPercent?: number;
  direction?: StrategyDirection;
  dte?: number;
  expectedExpiryValue?: number;
  lossAtStopPercentOfMaxRisk?: number;
  longStrike?: number;
  maxLoss?: number;
  maxProfit?: number;
  playbook?: StrategyRiskPlaybook;
  postEventStopSpot?: number;
  profitTakePercentOfMaxProfit?: number;
  spot?: number;
  stopSpot?: number;
  stopSigmaMultiple?: number;
  targetSigmaMultiple?: number;
  targetSpot?: number;
}

export interface StrategyRiskAnalytics {
  model: 'driftless_brownian_touch_approximation';
  direction: StrategyDirection;
  playbook: StrategyRiskPlaybook;
  spot?: number;
  dte?: number;
  annualizedVolatilityPercent?: number;
  averageRange14dPercent?: number;
  expectedMove1Sigma?: number;
  expectedMove1SigmaPercent?: number;
  expectedMove2Sigma?: number;
  expectedMove2SigmaPercent?: number;
  atr14Estimate?: number;
  stopSigmaMultiple: number;
  targetSigmaMultiple: number;
  suggestedStopSpot?: number;
  suggestedProfitTakeSpot?: number;
  longStrikeStopReference?: number;
  expectedTouchProbabilityToStop?: number;
  expectedTouchProbabilityToTarget?: number;
  expectedDaysToStop?: number;
  expectedDaysToTarget?: number;
  modelExpectedValue?: {
    profitAtTarget?: number;
    lossAtStop?: number;
    expectedExpiryValue?: number;
    estimatedValue?: number;
    estimatedValuePercentOfMaxRisk?: number;
    notes: string[];
  };
  notes: string[];
}

const DEFAULT_PLAYBOOK: StrategyRiskPlaybook = 'income_30_60d';
const DAYS_PER_YEAR = 365;
const NORMAL_75TH_PERCENTILE = 0.6744897501960817;

export const PLAYBOOK_RISK_DEFAULTS: Record<StrategyRiskPlaybook, PlaybookRiskDefaults> = {
  income_30_60d: {
    profitTakePercentOfMaxProfit: 50,
    stopSigmaMultiple: 1,
    targetSigmaMultiple: 1,
    timeStopDte: 14,
    profitTakeReviewWhenDteRemainingPercent: 50,
  },
  aggressive_short_term: {
    profitTakePercentOfMaxProfit: 75,
    stopSigmaMultiple: 0.5,
    targetSigmaMultiple: 1,
    timeStopDte: 7,
    profitTakeReviewWhenDteRemainingPercent: 40,
  },
  earnings_defined_risk: {
    profitTakePercentOfMaxProfit: 60,
    stopSigmaMultiple: 1,
    targetSigmaMultiple: 1,
    timeStopDte: 5,
    profitTakeReviewWhenDteRemainingPercent: 35,
  },
  long_term_directional: {
    profitTakePercentOfMaxProfit: 80,
    stopSigmaMultiple: 0.75,
    targetSigmaMultiple: 1.5,
    timeStopDte: 30,
    profitTakeReviewWhenDteRemainingPercent: 60,
  },
  leaps_replacement: {
    profitTakePercentOfMaxProfit: 100,
    stopSigmaMultiple: 1.5,
    targetSigmaMultiple: 2,
    timeStopDte: 60,
    profitTakeReviewWhenDteRemainingPercent: 70,
  },
  quality_put_write: {
    profitTakePercentOfMaxProfit: 50,
    stopSigmaMultiple: 1,
    targetSigmaMultiple: 0.75,
    timeStopDte: 14,
    profitTakeReviewWhenDteRemainingPercent: 50,
  },
};

export function playbookRiskDefaults(playbook: StrategyRiskPlaybook | undefined): PlaybookRiskDefaults {
  return PLAYBOOK_RISK_DEFAULTS[playbook ?? DEFAULT_PLAYBOOK];
}

export function buildStrategyRiskAnalytics(input: StrategyRiskAnalyticsInput): StrategyRiskAnalytics {
  const playbook = input.playbook ?? DEFAULT_PLAYBOOK;
  const defaults = playbookRiskDefaults(playbook);
  const direction = input.direction ?? 'bullish';
  const stopSigmaMultiple = input.stopSigmaMultiple ?? defaults.stopSigmaMultiple;
  const targetSigmaMultiple = input.targetSigmaMultiple ?? defaults.targetSigmaMultiple;
  const notes: string[] = [
    'Touch probabilities use a driftless Brownian approximation from realized volatility; treat as decision support, not a forecast.',
  ];
  const spot = positiveNumber(input.spot);
  const dte = nonNegativeNumber(input.dte);
  const annualizedVolatilityPercent = nonNegativeNumber(input.annualizedVolatilityPercent);
  const averageRange14dPercent = nonNegativeNumber(input.averageRange14dPercent);
  const expectedMove1Sigma = expectedMove(spot, annualizedVolatilityPercent, dte, 1);
  const expectedMove2Sigma = expectedMove(spot, annualizedVolatilityPercent, dte, 2);
  const atr14Estimate = spot !== undefined && averageRange14dPercent !== undefined
    ? spot * averageRange14dPercent / 100
    : undefined;

  if (spot === undefined) notes.push('Spot price unavailable; vol-scaled stop and target levels were not computed.');
  if (dte === undefined) notes.push('DTE unavailable; expected move and touch probabilities were not computed.');
  if (annualizedVolatilityPercent === undefined) notes.push('Annualized realized volatility unavailable; expected move and touch probabilities were not computed.');

  const suggestedStopSpot = resolveStopSpot({
    direction,
    expectedMove1Sigma,
    longStrike: positiveNumber(input.longStrike),
    playbook,
    postEventStopSpot: positiveNumber(input.postEventStopSpot),
    spot,
    stopSigmaMultiple,
    stopSpot: positiveNumber(input.stopSpot),
  });
  const suggestedProfitTakeSpot = resolveTargetSpot({
    direction,
    expectedMove1Sigma,
    spot,
    targetSigmaMultiple,
    targetSpot: positiveNumber(input.targetSpot),
  });
  const expectedTouchProbabilityToStop = touchProbability({
    direction: stopDirection(direction),
    dte,
    spot,
    target: suggestedStopSpot,
    annualizedVolatilityPercent,
  });
  const expectedTouchProbabilityToTarget = touchProbability({
    direction: targetDirection(direction),
    dte,
    spot,
    target: suggestedProfitTakeSpot,
    annualizedVolatilityPercent,
  });

  const result: StrategyRiskAnalytics = {
    model: 'driftless_brownian_touch_approximation',
    direction,
    playbook,
    spot: roundMoney(spot),
    dte,
    annualizedVolatilityPercent: round(annualizedVolatilityPercent),
    averageRange14dPercent: round(averageRange14dPercent),
    expectedMove1Sigma: roundMoney(expectedMove1Sigma),
    expectedMove1SigmaPercent: percent(expectedMove1Sigma, spot),
    expectedMove2Sigma: roundMoney(expectedMove2Sigma),
    expectedMove2SigmaPercent: percent(expectedMove2Sigma, spot),
    atr14Estimate: roundMoney(atr14Estimate),
    stopSigmaMultiple,
    targetSigmaMultiple,
    suggestedStopSpot: roundMoney(suggestedStopSpot),
    suggestedProfitTakeSpot: roundMoney(suggestedProfitTakeSpot),
    longStrikeStopReference: roundMoney(positiveNumber(input.longStrike)),
    expectedTouchProbabilityToStop,
    expectedTouchProbabilityToTarget,
    expectedDaysToStop: expectedDaysToTouch({
      direction: stopDirection(direction),
      dte,
      spot,
      target: suggestedStopSpot,
      annualizedVolatilityPercent,
    }),
    expectedDaysToTarget: expectedDaysToTouch({
      direction: targetDirection(direction),
      dte,
      spot,
      target: suggestedProfitTakeSpot,
      annualizedVolatilityPercent,
    }),
    modelExpectedValue: modelExpectedValue({
      expectedExpiryValue: input.expectedExpiryValue,
      expectedTouchProbabilityToStop,
      expectedTouchProbabilityToTarget,
      lossAtStopPercentOfMaxRisk: input.lossAtStopPercentOfMaxRisk,
      maxLoss: input.maxLoss,
      maxProfit: input.maxProfit,
      profitTakePercentOfMaxProfit: input.profitTakePercentOfMaxProfit ?? defaults.profitTakePercentOfMaxProfit,
    }),
    notes,
  };
  return pruneUndefined(result);
}

export function adjustedProfitTakePercent(input: {
  baseProfitTakePercent?: number;
  currentDte?: number;
  originalDte?: number;
}): number | undefined {
  const base = nonNegativeNumber(input.baseProfitTakePercent);
  const currentDte = nonNegativeNumber(input.currentDte);
  const originalDte = positiveNumber(input.originalDte);
  if (base === undefined) {
    return undefined;
  }
  if (currentDte === undefined || originalDte === undefined) {
    return round(base);
  }
  const fractionDteRemaining = clamp(currentDte / originalDte, 0, 1);
  return round(base * (1 - 0.5 * fractionDteRemaining));
}

function expectedMove(
  spot: number | undefined,
  annualizedVolatilityPercent: number | undefined,
  dte: number | undefined,
  sigmaMultiple: number,
): number | undefined {
  if (spot === undefined || annualizedVolatilityPercent === undefined || dte === undefined || dte <= 0) {
    return undefined;
  }
  return spot * annualizedVolatilityPercent / 100 * Math.sqrt(dte / DAYS_PER_YEAR) * sigmaMultiple;
}

function resolveStopSpot(input: {
  direction: StrategyDirection;
  expectedMove1Sigma?: number;
  longStrike?: number;
  playbook: StrategyRiskPlaybook;
  postEventStopSpot?: number;
  spot?: number;
  stopSigmaMultiple: number;
  stopSpot?: number;
}): number | undefined {
  if (input.stopSpot !== undefined) return input.stopSpot;
  if (input.playbook === 'earnings_defined_risk' && input.postEventStopSpot !== undefined) return input.postEventStopSpot;
  if (input.spot === undefined || input.expectedMove1Sigma === undefined) return input.longStrike;
  const sigmaStop = input.direction === 'bearish'
    ? input.spot + input.stopSigmaMultiple * input.expectedMove1Sigma
    : input.spot - input.stopSigmaMultiple * input.expectedMove1Sigma;
  if (input.longStrike === undefined) return sigmaStop;
  return input.direction === 'bearish'
    ? Math.min(sigmaStop, input.longStrike)
    : Math.max(sigmaStop, input.longStrike);
}

function resolveTargetSpot(input: {
  direction: StrategyDirection;
  expectedMove1Sigma?: number;
  spot?: number;
  targetSigmaMultiple: number;
  targetSpot?: number;
}): number | undefined {
  if (input.targetSpot !== undefined) return input.targetSpot;
  if (input.spot === undefined || input.expectedMove1Sigma === undefined) return undefined;
  if (input.direction === 'bearish') {
    return input.spot - input.targetSigmaMultiple * input.expectedMove1Sigma;
  }
  return input.spot + input.targetSigmaMultiple * input.expectedMove1Sigma;
}

function touchProbability(input: {
  annualizedVolatilityPercent?: number;
  direction: 'up' | 'down';
  dte?: number;
  spot?: number;
  target?: number;
}): number | undefined {
  const distance = barrierDistance(input);
  if (distance === undefined) return undefined;
  if (distance <= 0) return 100;
  const annualizedVol = (input.annualizedVolatilityPercent ?? 0) / 100;
  if (annualizedVol <= 0 || input.spot === undefined || input.dte === undefined || input.dte <= 0) return 0;
  const sigmaMove = input.spot * annualizedVol * Math.sqrt(input.dte / DAYS_PER_YEAR);
  if (sigmaMove <= 0) return 0;
  const probability = 2 * (1 - normalCdf(distance / sigmaMove));
  return round(clamp(probability * 100, 0, 100));
}

function expectedDaysToTouch(input: {
  annualizedVolatilityPercent?: number;
  direction: 'up' | 'down';
  dte?: number;
  spot?: number;
  target?: number;
}): number | undefined {
  const distance = barrierDistance(input);
  const annualizedVol = (input.annualizedVolatilityPercent ?? 0) / 100;
  if (
    distance === undefined ||
    input.spot === undefined ||
    input.dte === undefined ||
    input.dte <= 0 ||
    annualizedVol <= 0
  ) {
    return undefined;
  }
  if (distance <= 0) return 0;
  const years = Math.pow(distance / (input.spot * annualizedVol * NORMAL_75TH_PERCENTILE), 2);
  const days = years * DAYS_PER_YEAR;
  return days <= input.dte ? round(days) : undefined;
}

function modelExpectedValue(input: {
  expectedExpiryValue?: number;
  expectedTouchProbabilityToStop?: number;
  expectedTouchProbabilityToTarget?: number;
  lossAtStopPercentOfMaxRisk?: number;
  maxLoss?: number;
  maxProfit?: number;
  profitTakePercentOfMaxProfit?: number;
}): StrategyRiskAnalytics['modelExpectedValue'] | undefined {
  const maxProfit = positiveNumber(input.maxProfit);
  const maxLoss = positiveNumber(input.maxLoss);
  if (
    maxProfit === undefined ||
    maxLoss === undefined ||
    input.expectedTouchProbabilityToTarget === undefined ||
    input.expectedTouchProbabilityToStop === undefined
  ) {
    return undefined;
  }
  const targetProbability = input.expectedTouchProbabilityToTarget / 100;
  const stopProbability = input.expectedTouchProbabilityToStop / 100;
  const probabilitySum = targetProbability + stopProbability;
  const normalizedTargetProbability = probabilitySum > 1 ? targetProbability / probabilitySum : targetProbability;
  const normalizedStopProbability = probabilitySum > 1 ? stopProbability / probabilitySum : stopProbability;
  const neitherProbability = Math.max(0, 1 - normalizedTargetProbability - normalizedStopProbability);
  const profitAtTarget = maxProfit * (input.profitTakePercentOfMaxProfit ?? 50) / 100;
  const lossAtStop = -maxLoss * (input.lossAtStopPercentOfMaxRisk ?? 50) / 100;
  const expectedExpiryValue = input.expectedExpiryValue ?? 0;
  const estimatedValue =
    normalizedTargetProbability * profitAtTarget +
    normalizedStopProbability * lossAtStop +
    neitherProbability * expectedExpiryValue;
  return {
    profitAtTarget: roundMoney(profitAtTarget),
    lossAtStop: roundMoney(lossAtStop),
    expectedExpiryValue: roundMoney(expectedExpiryValue),
    estimatedValue: roundMoney(estimatedValue),
    estimatedValuePercentOfMaxRisk: percent(estimatedValue, maxLoss),
    notes: [
      'Model EV uses touch probabilities and simple payoff assumptions; it is decision support, not a valuation model.',
      probabilitySum > 1 ? 'Target/stop touch probabilities overlapped and were normalized before EV estimation.' : undefined,
    ].filter((item): item is string => Boolean(item)),
  };
}

function barrierDistance(input: {
  direction: 'up' | 'down';
  spot?: number;
  target?: number;
}): number | undefined {
  if (input.spot === undefined || input.target === undefined) return undefined;
  return input.direction === 'up'
    ? input.target - input.spot
    : input.spot - input.target;
}

function targetDirection(direction: StrategyDirection): 'up' | 'down' {
  return direction === 'bearish' ? 'down' : 'up';
}

function stopDirection(direction: StrategyDirection): 'up' | 'down' {
  return direction === 'bearish' ? 'up' : 'down';
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function percent(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator === 0) return undefined;
  return round(numerator / denominator * 100);
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function roundMoney(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pruneUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
