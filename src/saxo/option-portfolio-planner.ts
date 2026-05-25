import type {
  AccountScreeningContext,
  DecisionConfidence,
  DecisionVerdict,
  ScreenOptionStrategiesResult,
} from './option-strategy-screener.js';
import type { OptionStrategyKind } from './options.js';

export type OptionsMode = 'guardrailed' | 'user_driven';
export type ProfitOptimizationMode = 'standard' | 'convex_momentum';
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
  cashReserveDollars?: number;
  discoverOptionCandidates?: boolean;
  discoveryTargetRiskPercent?: number;
  discoveryThesisName?: string;
  deploymentStyle: 'staged' | 'immediate' | 'watchlist';
  fragmentationPolicy?: 'warn' | 'reject';
  maxOptionIdeas: number;
  maxContractsPerPosition?: number;
  maxSelectedUnderlyings?: number;
  maxOptionsRiskPercent: number;
  maxSingleTradeRiskPercent?: number;
  maxThesisRiskPercent?: number;
  minPositionRiskDollars?: number;
  minPositionRiskPercent?: number;
  netValue?: number;
  optionScreen?: ScreenOptionStrategiesResult;
  optionTheses?: OptionThesisInput[];
  optionsMode: OptionsMode;
  profitOptimizationMode?: ProfitOptimizationMode;
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
  sizing: {
    mode: 'watchlist' | 'starter' | 'budget_scaled';
    riskPerContract?: number;
    tradeCap?: number;
    maxContractsByBudget?: number;
    budgetUtilizationPercent?: number;
  };
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
  entryTiming: {
    verdict: 'enter' | 'scale_in' | 'wait' | 'avoid';
    underlyingPrice?: number;
    breakeven?: number;
    supportReference?: number;
    resistanceReference?: number;
    pullbackFromBreakevenPercent?: number;
    distanceToSma20Percent?: number;
    distanceToSma50Percent?: number;
    return5dPercent?: number;
    return20dPercent?: number;
    averageRange14dPercent?: number;
    starterTranchePercent: number;
    addRule: string;
    invalidateRule: string;
    rationale: string[];
  };
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
  const maxOptionsRiskDollars = dollars(netValue, input.maxOptionsRiskPercent);
  const deployableCash = input.accountContext?.cashAvailable !== undefined && input.cashReserveDollars !== undefined
    ? Math.max(0, input.accountContext.cashAvailable - input.cashReserveDollars)
    : undefined;
  const totalBudget = minDefined(maxOptionsRiskDollars, deployableCash) ?? maxOptionsRiskDollars ?? deployableCash;
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
  const selectedUnderlyings = new Set<string>();
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

    const selectedSymbols = new Set<string>();
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
      if (
        input.maxSelectedUnderlyings !== undefined &&
        !selectedUnderlyings.has(plan.symbol) &&
        selectedUnderlyings.size >= input.maxSelectedUnderlyings
      ) {
        rejected.push({
          thesisName: thesis.name,
          symbol: plan.symbol,
          strategy: plan.strategy,
          reason: `Rejected because maxSelectedUnderlyings=${input.maxSelectedUnderlyings} was reached.`,
          warnings: [],
        });
        continue;
      }
      if (selectedSymbols.has(plan.symbol)) {
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

      const sizing = contractSizing({
        deploymentStyle: input.deploymentStyle,
        maxContracts,
        riskPerContract,
        tradeCap,
      });
      const recommendedContracts = sizing.recommendedContracts;
      const plannedRisk = recommendedContracts * riskPerContract;
      const concentrationWarnings = [
        ...positionRiskWarnings(plannedRisk, {
          minPositionRiskDollars: resolveMinPositionRiskDollars(input, netValue),
        }),
        ...contractCountWarnings(recommendedContracts, input.maxContractsPerPosition),
      ];
      if (input.fragmentationPolicy === 'reject' && concentrationWarnings.length) {
        rejected.push({
          thesisName: thesis.name,
          symbol: plan.symbol,
          strategy: plan.strategy,
          reason: concentrationWarnings.join(' '),
          warnings: concentrationWarnings,
        });
        continue;
      }
      totalRiskUsed += plannedRisk;
      thesisRiskUsed[thesis.name] = (thesisRiskUsed[thesis.name] ?? 0) + plannedRisk;
      selectedSymbols.add(plan.symbol);
      selectedUnderlyings.add(plan.symbol);
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
        maxProfit: roundMoney(plan.maxProfit === undefined ? undefined : plan.maxProfit * recommendedContracts),
        sizing: {
          mode: sizing.mode,
          riskPerContract: roundMoney(riskPerContract),
          tradeCap: roundMoney(tradeCap),
          maxContractsByBudget: maxContracts,
          budgetUtilizationPercent: percent(plannedRisk, tradeCap),
        },
        breakevens: plan.breakevens,
        greeks: plan.greeks
          ? scaleGreeks(plan.greeks, recommendedContracts)
          : undefined,
        expiry: plan.expiry,
        daysToExpiry: plan.daysToExpiry,
        entryTiming: entryTiming(plan),
        rationale: explainSelection(plan, thesis),
        deploymentRule: deploymentRule(plan, thesis, input.deploymentStyle),
        exitRule: exitRule(plan, input.profitOptimizationMode ?? 'standard'),
        warnings: Array.from(new Set([
          ...(plan.keyRisks ?? []),
          ...plan.warnings,
          ...concentrationWarnings,
        ])),
      });
      if (totalBudget !== undefined && totalRiskUsed >= totalBudget) {
        break;
      }
      if (thesisBudget !== undefined && (thesisRiskUsed[thesis.name] ?? 0) >= thesisBudget) {
        break;
      }
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
  const discoveredSymbols = uniqueSymbols(input.optionScreen?.Data.map(plan => plan.symbol) ?? []);
  if (input.optionTheses?.length) {
    const explicit = input.optionTheses.map((thesis, index) => ({
      name: thesis.name || `Thesis ${index + 1}`,
      symbols: uniqueSymbols(thesis.symbols),
      role: thesis.role ?? 'core_conviction',
      conviction: thesis.conviction ?? 'medium',
      directionalBias: thesis.directionalBias ?? 'bullish',
      horizon: thesis.horizon ?? 'swing',
      preferredStructures: thesis.preferredStructures?.length ? thesis.preferredStructures : defaultStructures(thesis.horizon ?? 'swing', input.profitOptimizationMode ?? 'standard'),
      targetRiskPercent: thesis.targetRiskPercent,
      maxRiskDollars: thesis.maxRiskDollars,
      notes: thesis.notes,
    })).filter(thesis => thesis.symbols.length > 0);
    if (!input.discoverOptionCandidates) {
      return explicit;
    }
    const explicitSymbols = new Set(explicit.flatMap(thesis => thesis.symbols));
    const discoverySymbols = discoveredSymbols.filter(symbol => !explicitSymbols.has(symbol));
    if (!discoverySymbols.length) {
      return explicit;
    }
    return [
      ...explicit,
      {
        name: input.discoveryThesisName ?? 'Discovered option candidates',
        symbols: discoverySymbols,
        role: 'tactical_momentum',
        conviction: 'medium',
        directionalBias: 'bullish',
        horizon: 'swing',
        preferredStructures: input.profitOptimizationMode === 'convex_momentum'
          ? ['long_call', 'debit_spread']
          : ['debit_spread', 'put_credit_spread', 'call_credit_spread'],
        targetRiskPercent: input.discoveryTargetRiskPercent,
        maxRiskDollars: undefined,
        notes: 'Automatically discovered from Saxo market and option screens; still subject to the same risk, liquidity, and Greeks gates.',
      },
    ];
  }
  return discoveredSymbols.map(symbol => ({
    name: `${symbol} options satellite`,
    symbols: [symbol],
    role: 'tactical_momentum',
    conviction: 'medium',
    directionalBias: 'bullish',
    horizon: 'swing',
    preferredStructures: input.profitOptimizationMode === 'convex_momentum'
      ? ['long_call', 'debit_spread']
      : ['debit_spread', 'put_credit_spread', 'call_credit_spread', 'cash_secured_put', 'iron_condor'],
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

function defaultStructures(horizon: OptionThesisHorizon, profitOptimizationMode: ProfitOptimizationMode): OptionPortfolioStructure[] {
  if (profitOptimizationMode === 'convex_momentum') {
    return ['long_call', 'debit_spread'];
  }
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

function contractSizing(input: {
  deploymentStyle: BuildOptionPortfolioPlanInput['deploymentStyle'];
  maxContracts: number;
  riskPerContract: number;
  tradeCap: number;
}): {
  recommendedContracts: number;
  mode: OptionPortfolioSelectedCandidate['sizing']['mode'];
} {
  if (input.deploymentStyle === 'watchlist') {
    return { recommendedContracts: 0, mode: 'watchlist' };
  }
  if (input.deploymentStyle === 'staged') {
    return { recommendedContracts: Math.max(1, Math.min(1, input.maxContracts)), mode: 'starter' };
  }
  return { recommendedContracts: Math.max(1, input.maxContracts), mode: 'budget_scaled' };
}

function resolveMinPositionRiskDollars(
  input: Pick<BuildOptionPortfolioPlanInput, 'minPositionRiskDollars' | 'minPositionRiskPercent'>,
  netValue: number | undefined,
): number | undefined {
  return input.minPositionRiskDollars ?? dollars(netValue, input.minPositionRiskPercent);
}

function positionRiskWarnings(
  plannedRisk: number,
  input: { minPositionRiskDollars?: number },
): string[] {
  if (input.minPositionRiskDollars !== undefined && plannedRisk < input.minPositionRiskDollars) {
    return [
      `Position risk ${formatMoney(plannedRisk)} is below minPositionRiskDollars ${formatMoney(input.minPositionRiskDollars)}; this may be too small to monitor efficiently.`,
    ];
  }
  return [];
}

function contractCountWarnings(contracts: number, maxContractsPerPosition: number | undefined): string[] {
  if (maxContractsPerPosition !== undefined && contracts > maxContractsPerPosition) {
    return [`Contract count ${contracts} exceeds maxContractsPerPosition ${maxContractsPerPosition}; prefer a wider spread or a different structure.`];
  }
  if (contracts > 25) {
    return [`Large contract count (${contracts}); verify displayed size, liquidity, and partial-fill risk before execution.`];
  }
  return [];
}

function scaleGreeks(
  greeks: NonNullable<OptionPlan['greeks']>,
  contracts: number,
): NonNullable<OptionPortfolioSelectedCandidate['greeks']> {
  return {
    delta: scaleGreek(greeks.delta, contracts),
    gamma: scaleGreek(greeks.gamma, contracts),
    theta: scaleGreek(greeks.theta, contracts),
    vega: scaleGreek(greeks.vega, contracts),
    thetaDailyPercentOfRisk: greeks.thetaDailyPercentOfRisk,
  };
}

function scaleGreek(value: number | undefined, contracts: number): number | undefined {
  return value === undefined ? undefined : round(value * contracts);
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
  const timing = entryTiming(plan);
  if (timing.verdict === 'avoid') {
    return `${timing.invalidateRule} Do not open unless a fresh screen improves the entry timing verdict.`;
  }
  if (timing.verdict === 'wait') {
    return `${timing.addRule} Use no more than a small starter until price confirms.`;
  }
  if (thesis.conviction === 'high') {
    return `${timing.verdict === 'scale_in' ? `Start with about ${timing.starterTranchePercent}% of intended size. ` : ''}${timing.addRule}`;
  }
  return 'Open only if live executable quote is at or better than the screened debit/credit and no catalyst risk has changed.';
}

function exitRule(plan: OptionPlan, profitOptimizationMode: ProfitOptimizationMode): string {
  if (profitOptimizationMode === 'convex_momentum') {
    if (plan.strategy === 'long_call') {
      return 'Use fast-winner logic: trim only enough to de-risk, keep a runner while DTE and thesis remain favorable, and raise the stop after partial profit.';
    }
    if (plan.strategy === 'debit_spread') {
      return 'Use DTE-aware profit optimization: trim or roll up on fast spot moves, but avoid closing the full spread early when substantial DTE and upside remain.';
    }
  }
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

function entryTiming(plan: OptionPlan): OptionPortfolioSelectedCandidate['entryTiming'] {
  const metrics = plan.screeningContext?.metrics;
  const underlyingPrice = plan.underlyingPrice;
  const breakeven = plan.breakevens[0];
  const pullbackFromBreakevenPercent = underlyingPrice !== undefined && breakeven !== undefined
    ? (underlyingPrice - breakeven) / breakeven * 100
    : undefined;
  const distanceToSma20Percent = metrics?.distanceToSma20Percent;
  const distanceToSma50Percent = metrics?.distanceToSma50Percent;
  const return5dPercent = metrics?.return5dPercent;
  const return20dPercent = metrics?.return20dPercent;
  const averageRange14dPercent = metrics?.averageRange14dPercent;
  const supportReference = maxDefined(metrics?.sma20, metrics?.sma50);
  const resistanceReference = breakeven;
  const rationale: string[] = [];

  let verdict: OptionPortfolioSelectedCandidate['entryTiming']['verdict'] = 'enter';
  let starterTranchePercent = 100;

  if (return5dPercent !== undefined && return5dPercent <= -8 && return20dPercent !== undefined && return20dPercent > 0) {
    verdict = 'scale_in';
    starterTranchePercent = 50;
    rationale.push(`Recent ${round(return5dPercent)}% 5-day pullback inside a positive ${round(return20dPercent)}% 20-day trend; scale rather than chase full size.`);
  } else if (return5dPercent !== undefined && return5dPercent <= -8) {
    verdict = 'wait';
    starterTranchePercent = 25;
    rationale.push(`Recent ${round(return5dPercent)}% 5-day drop without confirmed 20-day uptrend; wait for stabilization.`);
  }

  if (distanceToSma50Percent !== undefined && distanceToSma50Percent >= 25) {
    if (verdict === 'enter') {
      verdict = 'scale_in';
      starterTranchePercent = Math.min(starterTranchePercent, 50);
    }
    rationale.push(`Underlying remains extended at ${round(distanceToSma50Percent)}% above SMA50; avoid full-size entry in one tranche.`);
  }

  if (pullbackFromBreakevenPercent !== undefined && pullbackFromBreakevenPercent < 0) {
    if (verdict === 'enter') {
      verdict = 'scale_in';
      starterTranchePercent = Math.min(starterTranchePercent, 50);
    }
    rationale.push(`Underlying is ${round(Math.abs(pullbackFromBreakevenPercent))}% below strategy breakeven; acceptable only as staged entry if thesis holds.`);
  }

  if (
    metrics?.sma20 !== undefined &&
    underlyingPrice !== undefined &&
    underlyingPrice < metrics.sma20 * 0.97 &&
    return5dPercent !== undefined &&
    return5dPercent < 0
  ) {
    verdict = return20dPercent !== undefined && return20dPercent > 15 ? 'wait' : 'avoid';
    starterTranchePercent = verdict === 'wait' ? 25 : 0;
    rationale.push('Price is more than 3% below SMA20 while short-term momentum is negative; wait for reclaim or rerun screen.');
  }

  if ((averageRange14dPercent ?? 0) >= 5) {
    if (verdict === 'enter') {
      verdict = 'scale_in';
      starterTranchePercent = Math.min(starterTranchePercent, 50);
    }
    rationale.push(`Average daily range is elevated at ${round(averageRange14dPercent)}%; use tranche sizing and limit orders.`);
  }

  if (!rationale.length) {
    rationale.push('Entry timing is acceptable under the current trend, breakeven, and volatility checks.');
  }

  return {
    verdict,
    underlyingPrice: roundMoney(underlyingPrice),
    breakeven: roundMoney(breakeven),
    supportReference: roundMoney(supportReference),
    resistanceReference: roundMoney(resistanceReference),
    pullbackFromBreakevenPercent: round(pullbackFromBreakevenPercent),
    distanceToSma20Percent: round(distanceToSma20Percent),
    distanceToSma50Percent: round(distanceToSma50Percent),
    return5dPercent: round(return5dPercent),
    return20dPercent: round(return20dPercent),
    averageRange14dPercent: round(averageRange14dPercent),
    starterTranchePercent,
    addRule: addRule(verdict, breakeven, metrics?.sma20),
    invalidateRule: invalidateRule(metrics?.sma20, metrics?.sma50, breakeven),
    rationale,
  };
}

function addRule(
  verdict: OptionPortfolioSelectedCandidate['entryTiming']['verdict'],
  breakeven: number | undefined,
  sma20: number | undefined,
): string {
  if (verdict === 'avoid') {
    return 'Do not add while the entry timing verdict is avoid.';
  }
  if (verdict === 'wait') {
    return `Wait for stabilization${breakeven !== undefined ? ` or reclaim above breakeven ${roundMoney(breakeven)}` : ''} before adding.`;
  }
  if (verdict === 'scale_in') {
    return `Open a starter tranche only; add after price stabilizes${breakeven !== undefined ? ` above breakeven ${roundMoney(breakeven)}` : sma20 !== undefined ? ` above SMA20 ${roundMoney(sma20)}` : ''} and live spread quality remains acceptable.`;
  }
  return 'Full planned entry is allowed if live quote is at or better than screened debit/credit and spread quality remains acceptable.';
}

function invalidateRule(sma20: number | undefined, sma50: number | undefined, breakeven: number | undefined): string {
  const references = [
    sma20 !== undefined ? `SMA20 ${roundMoney(sma20)}` : undefined,
    sma50 !== undefined ? `SMA50 ${roundMoney(sma50)}` : undefined,
    breakeven !== undefined ? `breakeven ${roundMoney(breakeven)}` : undefined,
  ].filter(Boolean);
  return references.length
    ? `Review or pause if price cannot hold/reclaim ${references.join(' / ')}.`
    : 'Review or pause if price action continues lower without stabilization.';
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

function maxDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return defined.length ? Math.max(...defined) : undefined;
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function roundMoney(value: number | undefined): number | undefined {
  return round(value);
}

function percent(value: number | undefined, base: number | undefined): number | undefined {
  if (value === undefined || base === undefined || base <= 0) {
    return undefined;
  }
  return round(value / base * 100);
}

function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'unknown';
  }
  return `$${roundMoney(value)?.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
