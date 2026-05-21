import type {
  AccountScreeningContext,
  DecisionConfidence,
  DecisionVerdict,
  ScreenOptionStrategiesResult,
} from './option-strategy-screener.js';
import type { OptionStrategyKind } from './options.js';

export type OptionsMode = 'guardrailed' | 'user_driven';
export type OptionThesisRole = 'core_conviction' | 'tactical_momentum' | 'income' | 'hedge' | 'speculative';
export type OptionThesisHorizon = 'short_term' | 'swing' | 'long_term' | 'leaps';
export type OptionPortfolioStructure =
  | OptionStrategyKind
  | 'covered_call'
  | 'collar'
  | 'diagonal';

export interface OptionThesisInput {
  name: string;
  symbols: string[];
  role?: OptionThesisRole;
  conviction?: 'low' | 'medium' | 'high';
  directionalBias?: 'bullish' | 'bearish' | 'neutral';
  horizon?: OptionThesisHorizon;
  preferredStructures?: OptionPortfolioStructure[];
  targetRiskPercent?: number;
  maxRiskDollars?: number;
  notes?: string;
}

export interface StockAllocationCandidate {
  symbol: string;
  notional?: number;
  shares?: number;
}

export interface BuildOptionPortfolioPlanInput {
  accountContext?: AccountScreeningContext;
  deploymentStyle: 'staged' | 'immediate' | 'watchlist';
  maxOptionIdeas: number;
  maxOptionsRiskPercent: number;
  maxSingleTradeRiskPercent?: number;
  maxThesisRiskPercent?: number;
  netValue?: number;
  optionScreen?: ScreenOptionStrategiesResult;
  optionTheses?: OptionThesisInput[];
  optionsMode: OptionsMode;
  riskBudgetPercentPerIdea: number;
  stockAllocations: StockAllocationCandidate[];
}

export interface OptionPortfolioSelectedCandidate {
  rank: number;
  thesisName: string;
  symbol: string;
  role: OptionThesisRole;
  strategy: string;
  verdict: DecisionVerdict;
  confidence: DecisionConfidence;
  recommendedContracts: number;
  plannedRisk?: number;
  maxProfit?: number;
  breakevens: number[];
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    thetaDailyPercentOfRisk?: number;
  };
  expiry?: string;
  daysToExpiry?: number;
  rationale: string;
  deploymentRule: string;
  exitRule: string;
  warnings: string[];
}

export interface OptionPortfolioRejectedCandidate {
  thesisName: string;
  symbol?: string;
  strategy?: string;
  reason: string;
  warnings: string[];
}

export interface OptionsRiskDashboard {
  totalMaxLoss?: number;
  maxOptionsRiskDollars?: number;
  maxThesisRiskDollars?: number;
  maxSingleTradeRiskDollars?: number;
  thesisConcentration: Record<string, number>;
  expiryBuckets: Record<string, number>;
  strategyMix: Record<string, number>;
  cashOrCollateralUsed?: number;
  warnings: string[];
}

export interface OptionsPortfolioPlan {
  mode: OptionsMode;
  totalBudget?: number;
  usedRisk?: number;
  sleeves: Array<{
    thesisName: string;
    role: OptionThesisRole;
    symbols: string[];
    targetRisk?: number;
    usedRisk?: number;
    rationale: string;
  }>;
  selectedCandidates: OptionPortfolioSelectedCandidate[];
  rejectedCandidates: OptionPortfolioRejectedCandidate[];
  deploymentRules: string[];
  scenarioNotes: Array<{
    thesisName: string;
    symbol: string;
    scenarios: string[];
  }>;
  warnings: string[];
}

type OptionPlan = ScreenOptionStrategiesResult['Data'][number];

export function buildOptionPortfolioPlan(input: BuildOptionPortfolioPlanInput): {
  optionsPortfolioPlan: OptionsPortfolioPlan;
  optionsRiskDashboard: OptionsRiskDashboard;
} {
  const netValue = input.netValue ?? input.accountContext?.netValue;
  const totalBudget = dollars(netValue, input.maxOptionsRiskPercent);
  const maxThesisRiskDollars = dollars(
    netValue,
    input.maxThesisRiskPercent ?? (input.optionsMode === 'guardrailed'
      ? Math.min(10, input.maxOptionsRiskPercent)
      : input.maxOptionsRiskPercent),
  );
  const maxSingleTradeRiskDollars = dollars(
    netValue,
    input.maxSingleTradeRiskPercent ?? (input.optionsMode === 'guardrailed'
      ? Math.min(5, input.maxOptionsRiskPercent)
      : input.maxOptionsRiskPercent),
  );
  const theses = normalizeTheses(input);
  const rejected: OptionPortfolioRejectedCandidate[] = [];
  const selected: OptionPortfolioSelectedCandidate[] = [];
  const thesisRiskUsed: Record<string, number> = {};
  let totalRiskUsed = 0;

  for (const thesis of theses) {
    const thesisBudget = resolveThesisBudget(thesis, {
      maxThesisRiskDollars,
      netValue,
      totalBudget,
    });
    const thesisPlans = plansForThesis(input.optionScreen?.Data ?? [], thesis);
    if (!thesisPlans.length) {
      for (const symbol of thesis.symbols) {
        const skipReason = input.optionScreen?.underlyings.find(item => item.symbol === symbol)?.skipReason;
        rejected.push({
          thesisName: thesis.name,
          symbol,
          reason: skipReason ?? 'No option candidate was available for this thesis under the current Saxo data and filters.',
          warnings: skipReason ? [skipReason] : [],
        });
      }
      continue;
    }

    for (const plan of thesisPlans) {
      if (selected.length >= input.maxOptionIdeas) {
        rejected.push({
          thesisName: thesis.name,
          symbol: plan.symbol,
          strategy: plan.strategy,
          reason: 'Rejected because maxOptionIdeas was reached.',
          warnings: [],
        });
        continue;
      }
      const riskPerContract = plan.positionSizing?.riskPerContract ?? plan.maxLoss;
      if (riskPerContract === undefined || riskPerContract <= 0) {
        rejected.push({
          thesisName: thesis.name,
          symbol: plan.symbol,
          strategy: plan.strategy,
          reason: 'Rejected because max loss or per-contract risk could not be estimated.',
          warnings: plan.keyRisks ?? plan.warnings,
        });
        continue;
      }
      const remainingTotal = totalBudget === undefined ? Number.POSITIVE_INFINITY : totalBudget - totalRiskUsed;
      const remainingThesis = thesisBudget === undefined
        ? Number.POSITIVE_INFINITY
        : thesisBudget - (thesisRiskUsed[thesis.name] ?? 0);
      const tradeCap = minDefined(remainingTotal, remainingThesis, maxSingleTradeRiskDollars) ?? riskPerContract;
      const maxByRisk = Math.floor(tradeCap / riskPerContract);
      const maxContracts = Math.min(plan.positionSizing?.maxContracts ?? maxByRisk, maxByRisk);
      if (maxContracts < 1) {
        rejected.push({
          thesisName: thesis.name,
          symbol: plan.symbol,
          strategy: plan.strategy,
          reason: `Rejected because one contract risk ${formatMoney(riskPerContract)} exceeds the remaining thesis or trade budget.`,
          warnings: plan.keyRisks ?? plan.warnings,
        });
        continue;
      }

      const recommendedContracts = input.deploymentStyle === 'watchlist' ? 0 : Math.max(1, Math.min(1, maxContracts));
      const plannedRisk = recommendedContracts * riskPerContract;
      totalRiskUsed += plannedRisk;
      thesisRiskUsed[thesis.name] = (thesisRiskUsed[thesis.name] ?? 0) + plannedRisk;
      const brief = input.optionScreen?.decisionBriefs.find(item => item.rank === plan.rank && item.symbol === plan.symbol);
      selected.push({
        rank: selected.length + 1,
        thesisName: thesis.name,
        symbol: plan.symbol,
        role: thesis.role,
        strategy: plan.strategy,
        verdict: brief?.verdict ?? 'watchlist',
        confidence: brief?.confidence ?? 'low',
        recommendedContracts,
        plannedRisk: roundMoney(plannedRisk),
        maxProfit: roundMoney(plan.maxProfit),
        breakevens: plan.breakevens,
        greeks: plan.greeks
          ? {
            delta: plan.greeks.delta,
            gamma: plan.greeks.gamma,
            theta: plan.greeks.theta,
            vega: plan.greeks.vega,
            thetaDailyPercentOfRisk: plan.greeks.thetaDailyPercentOfRisk,
          }
          : undefined,
        expiry: plan.expiry,
        daysToExpiry: plan.daysToExpiry,
        rationale: explainSelection(plan, thesis),
        deploymentRule: deploymentRule(plan, thesis, input.deploymentStyle),
        exitRule: exitRule(plan),
        warnings: Array.from(new Set([...(plan.keyRisks ?? []), ...plan.warnings])),
      });
      break;
    }

    for (const structure of thesis.preferredStructures ?? []) {
      if (structure === 'covered_call' || structure === 'collar' || structure === 'diagonal') {
        const hasStock = thesis.symbols.some(symbol => input.stockAllocations.some(item => item.symbol === symbol && (item.notional ?? 0) > 0));
        rejected.push({
          thesisName: thesis.name,
          strategy: structure,
          reason: hasStock
            ? `${structure} is a planning-only structure in this release; use the selected listed-option candidates plus manual stock-leg review before execution.`
            : `${structure} requires an existing or planned stock allocation for the underlying.`,
          warnings: ['Planning-only structure; no Saxo order draft was generated.'],
        });
      }
    }
  }

  const warnings = portfolioWarnings({
    input,
    maxSingleTradeRiskDollars,
    maxThesisRiskDollars,
    selected,
    totalBudget,
    totalRiskUsed,
  });
  const optionsPortfolioPlan: OptionsPortfolioPlan = {
    mode: input.optionsMode,
    totalBudget: roundMoney(totalBudget),
    usedRisk: roundMoney(totalRiskUsed),
    sleeves: theses.map(thesis => ({
      thesisName: thesis.name,
      role: thesis.role,
      symbols: thesis.symbols,
      targetRisk: roundMoney(resolveThesisBudget(thesis, { maxThesisRiskDollars, netValue, totalBudget })),
      usedRisk: roundMoney(thesisRiskUsed[thesis.name] ?? 0),
      rationale: thesis.notes ?? defaultThesisRationale(thesis),
    })),
    selectedCandidates: selected,
    rejectedCandidates: rejected,
    deploymentRules: buildDeploymentRules(input.deploymentStyle),
    scenarioNotes: selected.map(candidate => ({
      thesisName: candidate.thesisName,
      symbol: candidate.symbol,
      scenarios: scenarioNotes(candidate),
    })),
    warnings,
  };

  return {
    optionsPortfolioPlan,
    optionsRiskDashboard: {
      totalMaxLoss: roundMoney(totalRiskUsed),
      maxOptionsRiskDollars: roundMoney(totalBudget),
      maxThesisRiskDollars: roundMoney(maxThesisRiskDollars),
      maxSingleTradeRiskDollars: roundMoney(maxSingleTradeRiskDollars),
      thesisConcentration: mapRiskPercent(thesisRiskUsed, totalRiskUsed),
      expiryBuckets: summarizeExpiryBuckets(selected),
      strategyMix: summarizeStrategyMix(selected),
      cashOrCollateralUsed: roundMoney(totalRiskUsed),
      warnings,
    },
  };
}

function normalizeTheses(input: BuildOptionPortfolioPlanInput): Array<Required<Omit<OptionThesisInput, 'targetRiskPercent' | 'maxRiskDollars' | 'notes'>> & Pick<OptionThesisInput, 'targetRiskPercent' | 'maxRiskDollars' | 'notes'>> {
  if (input.optionTheses?.length) {
    return input.optionTheses.map((thesis, index) => ({
      name: thesis.name || `Thesis ${index + 1}`,
      symbols: uniqueSymbols(thesis.symbols),
      role: thesis.role ?? 'core_conviction',
      conviction: thesis.conviction ?? 'medium',
      directionalBias: thesis.directionalBias ?? 'bullish',
      horizon: thesis.horizon ?? 'swing',
      preferredStructures: thesis.preferredStructures?.length ? thesis.preferredStructures : defaultStructures(thesis.horizon ?? 'swing'),
      targetRiskPercent: thesis.targetRiskPercent,
      maxRiskDollars: thesis.maxRiskDollars,
      notes: thesis.notes,
    })).filter(thesis => thesis.symbols.length > 0);
  }
  const symbols = uniqueSymbols(input.optionScreen?.Data.map(plan => plan.symbol) ?? []);
  return symbols.map(symbol => ({
    name: `${symbol} options satellite`,
    symbols: [symbol],
    role: 'tactical_momentum',
    conviction: 'medium',
    directionalBias: 'bullish',
    horizon: 'swing',
    preferredStructures: ['debit_spread', 'put_credit_spread', 'call_credit_spread', 'cash_secured_put', 'iron_condor'],
    targetRiskPercent: undefined,
    maxRiskDollars: undefined,
    notes: undefined,
  }));
}

function plansForThesis(plans: OptionPlan[], thesis: ReturnType<typeof normalizeTheses>[number]): OptionPlan[] {
  const symbols = new Set(thesis.symbols);
  const preferred = new Set(thesis.preferredStructures.filter(isGeneratedStructure));
  return plans
    .filter(plan => symbols.has(plan.symbol))
    .filter(plan => preferred.size === 0 || preferred.has(plan.strategy))
    .filter(plan => horizonMatches(plan, thesis.horizon))
    .sort((a, b) => (b.rankingBreakdown?.finalScore ?? b.score.total) - (a.rankingBreakdown?.finalScore ?? a.score.total));
}

function isGeneratedStructure(structure: OptionPortfolioStructure): structure is OptionStrategyKind {
  return !['covered_call', 'collar', 'diagonal'].includes(structure);
}

function horizonMatches(plan: OptionPlan, horizon: OptionThesisHorizon): boolean {
  if (horizon === 'short_term') return plan.daysToExpiry <= 45;
  if (horizon === 'swing') return plan.daysToExpiry >= 7 && plan.daysToExpiry <= 120;
  if (horizon === 'long_term') return plan.daysToExpiry >= 60;
  return plan.daysToExpiry >= 180;
}

function defaultStructures(horizon: OptionThesisHorizon): OptionPortfolioStructure[] {
  if (horizon === 'leaps' || horizon === 'long_term') {
    return ['long_call', 'debit_spread', 'diagonal'];
  }
  return ['debit_spread', 'put_credit_spread', 'call_credit_spread'];
}

function resolveThesisBudget(
  thesis: Pick<OptionThesisInput, 'targetRiskPercent' | 'maxRiskDollars'>,
  input: { maxThesisRiskDollars?: number; netValue?: number; totalBudget?: number },
): number | undefined {
  const requested = thesis.maxRiskDollars ?? dollars(input.netValue, thesis.targetRiskPercent);
  const cap = minDefined(input.maxThesisRiskDollars, input.totalBudget);
  return minDefined(requested, cap) ?? cap;
}

function explainSelection(plan: OptionPlan, thesis: ReturnType<typeof normalizeTheses>[number]): string {
  const score = plan.rankingBreakdown?.finalScore ?? plan.score.total;
  const theta = plan.greeks?.theta !== undefined
    ? ` Net theta ${plan.greeks.theta}/day (${plan.greeks.thetaDailyPercentOfRisk ?? 'unknown'}% of max risk).`
    : ' Greeks unavailable.';
  return `${plan.symbol} ${plan.strategy} selected for ${thesis.name}: score ${score}, ${plan.daysToExpiry} DTE, max loss ${formatMoney(plan.maxLoss)}.${theta}`;
}

function deploymentRule(plan: OptionPlan, thesis: ReturnType<typeof normalizeTheses>[number], style: BuildOptionPortfolioPlanInput['deploymentStyle']): string {
  if (style === 'watchlist') {
    return 'Watchlist only; rerun the planner and refresh live quotes before allocating capital.';
  }
  if (thesis.conviction === 'high') {
    return 'Use a starter tranche first; add only after the thesis remains intact and live spread/quote quality is still acceptable.';
  }
  return 'Open only if live executable quote is at or better than the screened debit/credit and no catalyst risk has changed.';
}

function exitRule(plan: OptionPlan): string {
  if (plan.estimatedCredit !== undefined) {
    return 'For short-premium structures, consider taking profit around 40-60% of max credit or closing if the short strike is threatened.';
  }
  if (plan.strategy === 'long_call') {
    return 'Reassess on thesis break, material IV expansion/decay, or if theta decay starts consuming too much of remaining expected reward.';
  }
  return 'For debit spreads, reassess below breakeven and consider trimming near 60-80% of max profit.';
}

function buildDeploymentRules(style: BuildOptionPortfolioPlanInput['deploymentStyle']): string[] {
  if (style === 'watchlist') {
    return ['No capital deployment; use output as a ranked watchlist.', 'Refresh live quotes before converting any candidate into an order.'];
  }
  if (style === 'immediate') {
    return ['Deploy only pass/watchlist candidates that still fit quote, liquidity, and risk limits at execution time.'];
  }
  return [
    'Stage 1: open starter positions in the highest-confidence thesis candidates.',
    'Stage 2: add only after the thesis remains intact and price action confirms.',
    'Stage 3: keep unused budget for improved entries, rolls, or hedges.',
  ];
}

function scenarioNotes(candidate: OptionPortfolioSelectedCandidate): string[] {
  const breakeven = candidate.breakevens[0];
  return [
    '-20% underlying move: assume max loss or urgent thesis review unless the structure is explicitly hedged.',
    breakeven !== undefined ? `Flat to breakeven: monitor time decay; breakeven is ${breakeven}.` : 'Flat tape: monitor time decay and quote quality.',
    '+10% to +25% move: compare unrealized P/L with max profit and trim/roll instead of waiting mechanically for expiry.',
  ];
}

function portfolioWarnings(input: {
  input: BuildOptionPortfolioPlanInput;
  maxSingleTradeRiskDollars?: number;
  maxThesisRiskDollars?: number;
  selected: OptionPortfolioSelectedCandidate[];
  totalBudget?: number;
  totalRiskUsed: number;
}): string[] {
  const warnings = [...(input.input.optionScreen?.warnings ?? [])];
  if (input.input.optionsMode === 'guardrailed') {
    const large = input.selected.find(candidate =>
      input.maxSingleTradeRiskDollars !== undefined &&
      (candidate.plannedRisk ?? 0) > input.maxSingleTradeRiskDollars,
    );
    if (large) {
      warnings.push('One or more selected option candidates exceed guardrailed single-trade risk.');
    }
  }
  if (input.totalBudget !== undefined && input.totalRiskUsed > input.totalBudget) {
    warnings.push('Selected option risk exceeds the configured options risk budget.');
  }
  if (input.input.optionsMode === 'user_driven') {
    warnings.push('User-driven options mode allows higher concentration; review thesis sizing manually before execution.');
  }
  return Array.from(new Set(warnings));
}

function summarizeExpiryBuckets(candidates: OptionPortfolioSelectedCandidate[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const candidate of candidates) {
    const dte = candidate.daysToExpiry ?? 0;
    const bucket = dte < 45 ? '0-45d' : dte < 180 ? '45-180d' : dte < 365 ? '180-365d' : '365d+';
    buckets[bucket] = roundMoney((buckets[bucket] ?? 0) + (candidate.plannedRisk ?? 0)) ?? 0;
  }
  return buckets;
}

function summarizeStrategyMix(candidates: OptionPortfolioSelectedCandidate[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const candidate of candidates) {
    mix[candidate.strategy] = (mix[candidate.strategy] ?? 0) + candidate.recommendedContracts;
  }
  return mix;
}

function mapRiskPercent(values: Record<string, number>, total: number): Record<string, number> {
  const mapped: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    mapped[key] = total > 0 ? round(value / total * 100) ?? 0 : 0;
  }
  return mapped;
}

function defaultThesisRationale(thesis: { role: OptionThesisRole; horizon: OptionThesisHorizon; conviction: string }): string {
  return `${thesis.role} options sleeve with ${thesis.horizon} horizon and ${thesis.conviction} conviction.`;
}

function uniqueSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean)));
}

function dollars(netValue: number | undefined, percent: number | undefined): number | undefined {
  return netValue !== undefined && percent !== undefined ? netValue * percent / 100 : undefined;
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return defined.length ? Math.min(...defined) : undefined;
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function roundMoney(value: number | undefined): number | undefined {
  return round(value);
}

function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'unknown';
  }
  return `$${roundMoney(value)?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
