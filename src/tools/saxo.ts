import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { formatUnknownError, SaxoPolicyDeniedError } from '../errors.js';
import { writeAuditEvent } from '../saxo/audit.js';
import {
  READ_TOOL_ANNOTATIONS,
  SAXO_CAPABILITIES,
  searchCapabilities,
  WRITE_TOOL_ANNOTATIONS,
} from '../saxo/capabilities.js';
import type { SaxoClient } from '../saxo/client.js';
import {
  computeSpreadQuote,
  estimateVerticalSpread,
  getChart,
  getInfoPrice,
  getInfoPricesList,
} from '../saxo/prices.js';
import { planOptionStrategy } from '../saxo/options.js';
import { screenOptionStrategies } from '../saxo/option-strategy-screener.js';
import { planPortfolioStrategy } from '../saxo/portfolio-strategy.js';
import { reviewStrategyPositions } from '../saxo/position-strategy-review.js';
import {
  getBalance,
  getOrder,
  listAccounts,
  listActivities,
  listClosedPositions,
  listNetPositions,
  listOrders,
  listPositions,
} from '../saxo/portfolio.js';
import {
  checkMultiLegOrder,
  checkOrder,
  checkToolAllowed,
  isLiveTradingEnabled,
  loadPolicy,
  type OrderPolicyInput,
} from '../saxo/policy.js';
import {
  findOptionLeg,
  getInstrumentDetails,
  getOptionChain,
  listExchanges,
  listOptionExpiries,
  listStandardOptionExpiries,
  normalizeOptionChain,
  searchInstruments,
} from '../saxo/reference.js';
import { screenMarket } from '../saxo/screener.js';
import { screenStockStrategies } from '../saxo/stock-strategy-screener.js';
import { getDiagnostics, getFeatureAvailability, getSessionMe } from '../saxo/session.js';
import {
  cancelMultiLegOrder,
  cancelOrder,
  modifyMultiLegOrder,
  modifyOrder,
  placeMultiLegOrder,
  placeOrder,
  precheckMultiLegOrder,
  precheckOrder,
  type ModifyMultiLegOrderInput,
  type ModifyOrderInput,
  type PlaceMultiLegOrderInput,
  type PlaceOrderInput,
} from '../saxo/trading.js';
import { resolve } from 'node:path';
import { upsertEnvFile } from '../saxo/env-file.js';
import {
  cancelOauthFlow,
  completeOauthFlow,
  loadOauthConfigFromEnv,
  openBrowser,
  startOauthFlow,
} from '../saxo/oauth.js';

const orderDurationSchema = z.object({
  DurationType: z.enum([
    'DayOrder',
    'GoodTillCancel',
    'GoodTillDate',
    'GoodForPeriod',
    'ImmediateOrCancel',
    'FillOrKill',
    'AtTheOpening',
    'AtTheClose',
  ]),
  ExpirationDate: z.string().trim().optional(),
  ExpirationTime: z.string().trim().optional(),
});

const relatedOrderSchema = z.object({
  AssetType: z.string().trim().min(1),
  BuySell: z.enum(['Buy', 'Sell']),
  Amount: z.number().positive(),
  OrderType: z.string().trim().min(1),
  OrderPrice: z.number().optional(),
  StopPrice: z.number().optional(),
  OrderDuration: orderDurationSchema,
});

const placeOrderSchema = z.object({
  AccountKey: z.string().trim().min(1),
  Uic: z.number().int().nonnegative(),
  AssetType: z.string().trim().min(1),
  BuySell: z.enum(['Buy', 'Sell']),
  Amount: z.number().positive(),
  OrderType: z.string().trim().min(1),
  OrderDuration: orderDurationSchema,
  OrderPrice: z.number().optional(),
  StopPrice: z.number().optional(),
  ManualOrder: z.boolean().optional(),
  ExternalReference: z.string().trim().optional(),
  Orders: z.array(relatedOrderSchema).max(10).optional(),
});

const modifyOrderSchema = z.object({
  OrderId: z.string().trim().min(1),
  AccountKey: z.string().trim().min(1),
  Uic: z.number().int().nonnegative(),
  AssetType: z.string().trim().min(1),
  Amount: z.number().positive().optional(),
  OrderType: z.string().trim().min(1).optional(),
  OrderPrice: z.number().optional(),
  StopPrice: z.number().optional(),
  OrderDuration: orderDurationSchema.optional(),
});

const multiLegLegSchema = z.object({
  Uic: z.number().int().nonnegative(),
  AssetType: z.enum(['StockOption', 'IndexOption']),
  BuySell: z.enum(['Buy', 'Sell']),
  Amount: z.number().int().positive(),
  ToOpenClose: z.enum(['ToOpen', 'ToClose']),
});

const multiLegOrderSchema = z.object({
  AccountKey: z.string().trim().min(1),
  OrderType: z.literal('Limit'),
  OrderPrice: z.number().optional(),
  OrderDuration: orderDurationSchema,
  Legs: z.array(multiLegLegSchema).min(2).max(20),
  ManualOrder: z.boolean().optional(),
  ExternalReference: z.string().trim().optional(),
});

const modifyMultiLegOrderSchema = z.object({
  AccountKey: z.string().trim().min(1),
  MultiLegOrderId: z.string().trim().min(1),
  Amount: z.number().int().positive().optional(),
  OrderPrice: z.number().optional(),
});

const screenMarketSchema = z.object({
  preset: z.enum(['top_gainers', 'top_losers', 'premarket_gainers', 'premarket_losers']),
  market: z
    .enum(['us', 'us_nasdaq', 'us_nyse', 'denmark', 'sweden', 'norway', 'finland', 'nordics', 'europe'])
    .default('us'),
  exchangeIds: z.array(z.string().trim().min(1)).max(20).optional(),
  assetType: z.string().trim().min(1).default('Stock'),
  limit: z.number().int().min(1).max(50).default(10),
  maxInstruments: z.number().int().min(1).max(500).default(200),
  accountKey: z.string().trim().min(1).optional(),
  includeNonTradable: z.boolean().default(false),
});

const putCallSchema = z.enum(['Put', 'Call']);
const optionStrategySchema = z.enum([
  'cash_secured_put',
  'put_credit_spread',
  'call_credit_spread',
  'long_call',
  'debit_spread',
  'iron_condor',
]);
const strategyPlaybookSchema = z.enum([
  'income_30_60d',
  'aggressive_short_term',
  'earnings_defined_risk',
  'long_term_directional',
  'leaps_replacement',
  'quality_put_write',
]);
const riskProfileSchema = z.enum(['conservative', 'balanced', 'aggressive']);
const tradeObjectiveSchema = z.enum([
  'income',
  'directional',
  'volatility',
  'stock_replacement',
  'capital_preservation',
]);
const underlyingUniverseSchema = z.enum([
  'auto',
  'single_preset',
  'bullish_movers',
  'bearish_movers',
  'two_sided_movers',
]);
const directionalBiasSchema = z.enum(['bullish', 'bearish', 'neutral']);
const newsProviderSchema = z.enum(['auto', 'none', 'alpha_vantage']);
const marketSentimentSchema = z.enum(['bullish', 'bearish', 'neutral', 'mixed', 'unknown']);
const stockStrategyObjectiveSchema = z.enum([
  'core_growth',
  'tactical_momentum',
  'quality_value',
  'defensive',
  'balanced',
]);
const stockUniverseSchema = z.enum(['auto', 'large_cap', 'movers', 'watchlist', 'symbols']);
const portfolioObjectiveSchema = z.enum([
  'balanced_growth_income',
  'income_options',
  'capital_preservation',
  'growth',
]);
const deploymentStyleSchema = z.enum(['staged', 'immediate', 'watchlist']);
const portfolioProfileSchema = z.enum(['balanced', 'concentrated_conviction']);
const optionsModeSchema = z.enum(['guardrailed', 'user_driven']);
const optionThesisRoleSchema = z.enum(['core_conviction', 'tactical_momentum', 'income', 'hedge', 'speculative']);
const optionThesisHorizonSchema = z.enum(['short_term', 'swing', 'long_term', 'leaps']);
const optionPortfolioStructureSchema = z.enum([
  'cash_secured_put',
  'put_credit_spread',
  'call_credit_spread',
  'long_call',
  'debit_spread',
  'iron_condor',
  'covered_call',
  'collar',
  'diagonal',
]);

const marketNewsContextSchema = z.object({
  source: z.enum(['alpha_vantage', 'external']).default('external'),
  provider: z.string().trim().min(1).default('external'),
  symbol: z.string().trim().min(1),
  generatedAt: z.string().trim().default(() => new Date().toISOString()),
  lookbackDays: z.number().int().min(1).max(365).default(7),
  headlineCount: z.number().int().min(0).default(0),
  sentiment: marketSentimentSchema,
  sentimentScore: z.number().optional(),
  latestPublishedAt: z.string().trim().optional(),
  catalystTags: z.array(z.string().trim().min(1)).max(50).default([]),
  riskNotes: z.array(z.string().trim().max(500)).max(20).default([]),
  summary: z.string().trim().max(4000).optional(),
  headlines: z
    .array(z.object({
      title: z.string().trim().min(1).max(1000),
      source: z.string().trim().optional(),
      url: z.string().trim().optional(),
      publishedAt: z.string().trim().optional(),
      sentiment: marketSentimentSchema.optional(),
      sentimentScore: z.number().optional(),
      relevanceScore: z.number().optional(),
    }))
    .max(20)
    .default([]),
  earnings: z
    .object({
      reportDate: z.string().trim().optional(),
      fiscalDateEnding: z.string().trim().optional(),
      estimate: z.number().optional(),
      currency: z.string().trim().optional(),
      daysUntil: z.number().int().optional(),
    })
    .optional(),
});

const optionStrategyPlanSchema = z.object({
  keywords: z.string().trim().min(1).optional(),
  optionRootId: z.number().int().positive().optional(),
  accountKey: z.string().trim().min(1),
  minDte: z.number().int().min(0).max(3650).optional(),
  maxDte: z.number().int().min(0).max(3650).optional(),
  strikeWindowPercent: z.number().positive().max(1000).optional(),
  putCall: putCallSchema.optional(),
  limitExpiries: z.number().int().min(1).max(50).optional(),
  limitStrikesPerExpiry: z.number().int().min(1).max(200).optional(),
  strategies: z.array(optionStrategySchema).min(1).max(5).optional(),
  maxCandidates: z.number().int().min(1).max(25).optional(),
  riskBudget: z.number().positive().optional(),
  requireGreeks: z.boolean().optional(),
  maxThetaDailyPercentOfRisk: z.number().min(0).max(100).optional(),
  minOpenInterest: z.number().int().min(0).optional(),
  maxSpreadPercent: z.number().positive().max(1000).optional(),
  includeVolatilityContext: z.boolean().optional(),
  externalContext: z
    .object({
      summary: z.string().trim().max(4000).optional(),
      sentiment: directionalBiasSchema.optional(),
      technicalBias: directionalBiasSchema.optional(),
      news: marketNewsContextSchema.optional(),
      riskNotes: z.array(z.string().trim().max(500)).max(20).optional(),
    })
    .optional(),
  directionalBias: directionalBiasSchema.optional(),
});

const externalStrategyContextSchema = z.object({
  summary: z.string().trim().max(4000).optional(),
  sentiment: directionalBiasSchema.optional(),
  technicalBias: directionalBiasSchema.optional(),
  news: marketNewsContextSchema.optional(),
  riskNotes: z.array(z.string().trim().max(500)).max(20).optional(),
});

const optionStrategyScreenerSchema = z.object({
  accountKey: z.string().trim().min(1),
  market: z.enum(['us', 'us_nasdaq', 'us_nyse']).default('us'),
  symbols: z.array(z.string().trim().min(1)).max(50).optional(),
  underlyingUniverse: underlyingUniverseSchema.default('auto'),
  underlyingPreset: z.enum(['top_gainers', 'top_losers', 'premarket_gainers', 'premarket_losers']).optional(),
  playbook: strategyPlaybookSchema.default('income_30_60d'),
  riskProfile: riskProfileSchema.default('balanced'),
  objective: tradeObjectiveSchema.optional(),
  strategies: z.array(optionStrategySchema).min(1).max(5).optional(),
  minDte: z.number().int().min(0).max(3650).optional(),
  maxDte: z.number().int().min(0).max(3650).optional(),
  maxUnderlyings: z.number().int().min(1).max(50).default(50),
  maxUnderlyingScan: z.number().int().min(1).max(500).default(500),
  maxSymbolsToPlan: z.number().int().min(1).max(10).default(5),
  maxPlans: z.number().int().min(1).max(25).default(10),
  riskBudget: z.number().positive().optional(),
  requireGreeks: z.boolean().default(false),
  maxThetaDailyPercentOfRisk: z.number().min(0).max(100).optional(),
  includeAccountContext: z.boolean().default(true),
  riskBudgetPercent: z.number().positive().max(100).default(1),
  maxPortfolioRiskPercent: z.number().positive().max(100).default(5),
  maxSymbolExposurePercent: z.number().positive().max(100).default(10),
  allowExistingExposureIncrease: z.boolean().default(false),
  minOpenInterest: z.number().int().min(0).optional(),
  maxSpreadPercent: z.number().positive().max(1000).optional(),
  includeTechnicalContext: z.boolean().default(true),
  includeVolatilityContext: z.boolean().default(true),
  includeNewsContext: z.boolean().default(false),
  newsProvider: newsProviderSchema.default('auto'),
  newsLookbackDays: z.number().int().min(1).max(30).default(7),
  newsLimit: z.number().int().min(1).max(50).default(20),
  earningsHorizon: z.enum(['3month', '6month', '12month']).default('3month'),
  technicalHorizon: z.number().int().min(1).max(10080).default(1440),
  technicalBars: z.number().int().min(20).max(1200).default(90),
  externalContextBySymbol: z.record(z.string(), externalStrategyContextSchema).optional(),
});

const stockStrategyScreenerSchema = z.object({
  accountKey: z.string().trim().min(1),
  market: z.enum(['us', 'us_nasdaq', 'us_nyse']).default('us'),
  symbols: z.array(z.string().trim().min(1)).max(50).optional(),
  excludeSymbols: z.array(z.string().trim().min(1)).max(50).optional(),
  universe: stockUniverseSchema.default('auto'),
  objective: stockStrategyObjectiveSchema.default('balanced'),
  riskProfile: riskProfileSchema.default('balanced'),
  maxResults: z.number().int().min(1).max(25).default(10),
  maxCandidates: z.number().int().min(1).max(500).default(120),
  maxTechnicalCandidates: z.number().int().min(0).max(100).default(25),
  includeAccountContext: z.boolean().default(true),
  riskBudgetPercentPerIdea: z.number().positive().max(100).default(1),
  maxSingleNamePercent: z.number().positive().max(100).default(10),
  allowExistingExposureIncrease: z.boolean().default(false),
  includeTechnicalContext: z.boolean().default(true),
  includeFundamentalContext: z.boolean().default(true),
  fundamentalProvider: newsProviderSchema.default('auto'),
  fundamentalsLimit: z.number().int().min(0).max(50).default(12),
  includeNewsContext: z.boolean().default(false),
  newsProvider: newsProviderSchema.default('auto'),
  newsLookbackDays: z.number().int().min(1).max(30).default(7),
  newsLimit: z.number().int().min(1).max(50).default(10),
  technicalHorizon: z.number().int().min(1).max(10080).default(1440),
  technicalBars: z.number().int().min(20).max(1200).default(90),
  externalContextBySymbol: z.record(z.string(), z.object({
    summary: z.string().trim().max(4000).optional(),
    sentiment: directionalBiasSchema.optional(),
    riskNotes: z.array(z.string().trim().max(500)).max(20).optional(),
    news: marketNewsContextSchema.optional(),
  })).optional(),
});

const portfolioStrategySchema = z.object({
  accountKey: z.string().trim().min(1),
  objective: portfolioObjectiveSchema.default('balanced_growth_income'),
  riskProfile: riskProfileSchema.default('balanced'),
  portfolioProfile: portfolioProfileSchema.default('balanced'),
  deploymentStyle: deploymentStyleSchema.default('staged'),
  targetInvestedPercent: z.number().positive().max(100).optional(),
  cashReservePercent: z.number().min(0).max(95).optional(),
  maxCashDollars: z.number().min(0).optional(),
  maxSingleNamePercent: z.number().positive().max(100).default(10),
  maxSectorPercent: z.number().positive().max(100).default(35),
  maxOptionsRiskPercent: z.number().min(0).max(100).default(5),
  maxThesisRiskPercent: z.number().positive().max(100).optional(),
  maxSingleTradeRiskPercent: z.number().positive().max(100).optional(),
  riskBudgetPercentPerIdea: z.number().positive().max(100).default(1),
  requireGreeks: z.boolean().default(false),
  maxThetaDailyPercentOfRisk: z.number().min(0).max(100).optional(),
  optionsMode: optionsModeSchema.default('guardrailed'),
  fragmentationPolicy: z.enum(['warn', 'reject']).optional(),
  maxContractsPerPosition: z.number().int().min(1).max(1000).optional(),
  maxSelectedUnderlyings: z.number().int().min(1).max(25).optional(),
  maxMonitoringSymbols: z.number().int().min(1).max(25).optional(),
  minPositionRiskDollars: z.number().positive().optional(),
  minPositionRiskPercent: z.number().positive().max(100).optional(),
  includeStocks: z.boolean().default(true),
  includeOptions: z.boolean().default(true),
  stockMarket: z.enum(['us', 'us_nasdaq', 'us_nyse']).optional(),
  stockUniverse: stockUniverseSchema.optional(),
  stockMaxCandidates: z.number().int().min(1).max(500).optional(),
  stockMaxTechnicalCandidates: z.number().int().min(0).max(100).optional(),
  discoverOptionCandidates: z.boolean().default(false),
  optionDiscoveryUniverse: underlyingUniverseSchema.optional(),
  optionDiscoveryPreset: z.enum(['top_gainers', 'top_losers', 'premarket_gainers', 'premarket_losers']).optional(),
  optionDiscoveryPlaybook: strategyPlaybookSchema.optional(),
  optionDiscoveryMaxUnderlyings: z.number().int().min(1).max(50).optional(),
  optionDiscoveryMaxSymbolsToPlan: z.number().int().min(1).max(10).optional(),
  optionDiscoveryTargetRiskPercent: z.number().positive().max(100).optional(),
  stockSymbols: z.array(z.string().trim().min(1)).max(50).optional(),
  optionSymbols: z.array(z.string().trim().min(1)).max(50).optional(),
  optionTheses: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    symbols: z.array(z.string().trim().min(1)).min(1).max(20),
    role: optionThesisRoleSchema.optional(),
    conviction: z.enum(['low', 'medium', 'high']).optional(),
    directionalBias: directionalBiasSchema.optional(),
    horizon: optionThesisHorizonSchema.optional(),
    preferredStructures: z.array(optionPortfolioStructureSchema).min(1).max(10).optional(),
    targetRiskPercent: z.number().positive().max(100).optional(),
    maxRiskDollars: z.number().positive().optional(),
    notes: z.string().trim().max(2000).optional(),
  })).max(20).optional(),
  maxStockIdeas: z.number().int().min(1).max(25).default(8),
  maxOptionIdeas: z.number().int().min(1).max(25).default(6),
  includeNewsContext: z.boolean().default(false),
  includeFundamentalContext: z.boolean().default(true),
});

const strategyFollowUpRulesSchema = z.object({
  profitTakePercentOfCost: z.number().min(0).max(1000).optional(),
  profitTakePercentOfMaxProfit: z.number().min(0).max(1000).optional(),
  lossExitPercentOfCost: z.number().min(0).max(1000).optional(),
  lossExitPercentOfMaxRisk: z.number().min(0).max(1000).optional(),
  rollWhenDaysToExpiryBelow: z.number().int().min(0).max(3650).optional(),
  closeWhenDaysToExpiryBelow: z.number().int().min(0).max(3650).optional(),
  thesisInvalidBelow: z.number().optional(),
  thesisInvalidAbove: z.number().optional(),
  maxThetaDailyPercentOfRisk: z.number().min(0).max(100).optional(),
});

const strategyPositionReviewSchema = z.object({
  accountKey: z.string().trim().min(1).optional(),
  clientKey: z.string().trim().min(1).optional(),
  defaultRules: strategyFollowUpRulesSchema.optional(),
  strategyPositions: z.array(z.object({
    name: z.string().trim().min(1).max(200).optional(),
    thesisName: z.string().trim().min(1).max(200).optional(),
    symbol: z.string().trim().min(1).max(40).optional(),
    strategy: z.string().trim().min(1).max(80).optional(),
    openedAt: z.string().trim().min(1).optional(),
    entryPrice: z.number().positive().optional(),
    entryCost: z.number().positive().optional(),
    entryProceeds: z.number().positive().optional(),
    entryNotional: z.number().positive().optional(),
    entryNetDebit: z.number().optional(),
    entryNetCredit: z.number().optional(),
    entryMaxRisk: z.number().positive().optional(),
    entryMaxProfit: z.number().positive().optional(),
    entryUnderlyingPrice: z.number().positive().optional(),
    legs: z.array(z.object({
      uic: z.number().int().positive(),
      assetType: z.string().trim().min(1).optional(),
      buySell: z.enum(['Buy', 'Sell']),
      amount: z.number().positive(),
      expiry: z.string().trim().optional(),
      putCall: z.enum(['Put', 'Call']).optional(),
      strike: z.number().optional(),
    })).min(1).max(8),
    rules: strategyFollowUpRulesSchema.optional(),
  })).min(0).max(50).default([]),
});

export function registerSaxoTools(server: McpServer, client: SaxoClient): void {
  server.registerTool(
    'saxo_capabilities',
    {
      title: 'Search Saxo Capabilities',
      description:
        'Search the Saxo MCP server capabilities and examples. Use this first when deciding which Saxo tool to call.',
      inputSchema: {
        query: z.string().trim().default(''),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_capabilities', input, async () =>
        jsonToolResult(searchCapabilities(input.query, input.limit)),
      ),
  );

  server.registerTool(
    'saxo_session_me',
    {
      title: 'Get Saxo Session',
      description:
        'Return the current Saxo session (ClientKey, UserKey, default account, culture). Useful to verify the access token works.',
      inputSchema: {},
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async () =>
      runAuditedTool(client, 'saxo_session_me', {}, async () =>
        jsonToolResult(await getSessionMe(client)),
      ),
  );

  server.registerTool(
    'saxo_diagnostics',
    {
      title: 'Saxo OpenAPI Diagnostics',
      description: 'Hit the Saxo diagnostics endpoint to verify connectivity.',
      inputSchema: {},
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async () =>
      runAuditedTool(client, 'saxo_diagnostics', {}, async () =>
        jsonToolResult(await getDiagnostics(client)),
      ),
  );

  server.registerTool(
    'saxo_feature_availability',
    {
      title: 'Get Saxo Feature Availability',
      description:
        'Return Saxo feature flags for News, Calendar, Gainers/Losers, and Chart. Diagnostic only: availability flags do not guarantee that every feature has a public documented endpoint exposed by this MCP server.',
      inputSchema: {},
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async () =>
      runAuditedTool(client, 'saxo_feature_availability', {}, async () =>
        jsonToolResult(await getFeatureAvailability(client)),
      ),
  );

  server.registerTool(
    'saxo_search_instruments',
    {
      title: 'Search Instruments',
      description:
        'Search Saxo reference data for instruments by keyword and asset type. Returns matching instruments with Uic and AssetType (use those as input to other tools).',
      inputSchema: {
        keywords: z.string().trim().min(1).optional(),
        assetTypes: z.array(z.string().trim().min(1)).optional(),
        exchangeIds: z.array(z.string().trim().min(1)).optional(),
        accountKey: z.string().trim().min(1).optional(),
        includeNonTradable: z.boolean().optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_search_instruments', input, async () =>
        jsonToolResult(await searchInstruments(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_instrument_details',
    {
      title: 'Get Instrument Details',
      description: 'Fetch detailed metadata for one or more instruments by Uic + AssetType.',
      inputSchema: {
        uics: z.array(z.number().int().nonnegative()).min(1).max(100),
        assetType: z.string().trim().min(1),
        accountKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_instrument_details', input, async () =>
        jsonToolResult(await getInstrumentDetails(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_exchanges',
    {
      title: 'List Exchanges',
      description: 'List Saxo-supported exchanges, or fetch one by ExchangeId.',
      inputSchema: {
        exchangeId: z.string().trim().min(1).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_exchanges', input, async () =>
        jsonToolResult(await listExchanges(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_option_chain',
    {
      title: 'Get Option Chain',
      description:
        'Fetch the option chain (strikes + expirations) for an option root. Use this after saxo_search_instruments with assetTypes=[StockOption] to find the Uic of each option leg before placing a multi-leg spread. Set normalize=true (default) to return one row per strike with callUic+putUic; normalize=false returns the raw Saxo OptionSpace shape.',
      inputSchema: {
        optionRootId: z.number().int().nonnegative(),
        expiryDates: z
          .array(
            z
              .string()
              .trim()
              .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.'),
          )
          .optional(),
        strikeCount: z.number().int().min(1).max(200).optional(),
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        trading: z.enum(['AllTrading', 'OnlyTradable']).optional(),
        normalize: z.boolean().default(true),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_option_chain', input, async () => {
        const { normalize, ...query } = input;
        const raw = await getOptionChain(client, query);
        return jsonToolResult(normalize ? normalizeOptionChain(raw) : raw);
      }),
  );

  server.registerTool(
    'saxo_list_option_expiries',
    {
      title: 'List Option Expiries',
      description:
        'Cheap helper that returns just the available expiries for an option root: expiry date, days-to-expiry, last trade date, and strike count. Use to pick an expiry before pulling the full chain.',
      inputSchema: {
        optionRootId: z.number().int().nonnegative(),
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        trading: z.enum(['AllTrading', 'OnlyTradable']).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_option_expiries', input, async () =>
        jsonToolResult(await listOptionExpiries(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_standard_option_expiries',
    {
      title: 'List Standard Option Expiry Dates',
      description:
        'Return the standardized option-expiry calendar (3rd Friday monthlies, quarterlies, weeklies) from Saxo reference data. Useful for "is 2027-01-15 a standard monthly?" reasoning. For per-option-root expiries, use saxo_list_option_expiries instead.',
      inputSchema: {
        fromDate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.')
          .optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_standard_option_expiries', input, async () =>
        jsonToolResult(await listStandardOptionExpiries(client, input)),
      ),
  );

  server.registerTool(
    'saxo_find_option_leg',
    {
      title: 'Find Option Leg by Symbol/Expiry/Strike',
      description:
        'Convenience helper that resolves an option leg Uic from human-readable parameters (symbol + expiry + strike + Call/Put). Compresses the 4-step option-discovery workflow (search instrument → search option root → fetch chain → locate strike) into one call. Useful before saxo_place_order / saxo_place_multileg_order. When multiple option roots match (e.g. ADR vs. local listing), prefers the multi-leg-capable root and surfaces alternatives in warnings[]; pass exchangeId to disambiguate.',
      inputSchema: {
        symbol: z.string().trim().min(1),
        expiry: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.'),
        strike: z.number().positive(),
        putCall: z.enum(['Call', 'Put']),
        exchangeId: z.string().trim().min(1).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_find_option_leg', input, async () =>
        jsonToolResult(await findOptionLeg(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_infoprice',
    {
      title: 'Get Snapshot Price',
      description:
        'Fetch a snapshot bid/ask/last price for a single instrument. Snapshot only — no subscription side effects.',
      inputSchema: {
        uic: z.number().int().nonnegative(),
        assetType: z.string().trim().min(1),
        accountKey: z.string().trim().min(1).optional(),
        amount: z.number().positive().optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_infoprice', input, async () =>
        jsonToolResult(await getInfoPrice(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_infoprices_list',
    {
      title: 'Get Snapshot Prices (List)',
      description: 'Fetch snapshot prices for multiple Uics in one call.',
      inputSchema: {
        uics: z.array(z.number().int().nonnegative()).min(1).max(100),
        assetType: z.string().trim().min(1),
        accountKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_infoprices_list', input, async () =>
        jsonToolResult(await getInfoPricesList(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_chart',
    {
      title: 'Get Chart (Historical OHLC)',
      description:
        'Fetch historical OHLC bars for an instrument. Horizon is in minutes (1, 5, 60, 1440 ...). Count defaults to Saxo default (max 1200).',
      inputSchema: {
        uic: z.number().int().nonnegative(),
        assetType: z.string().trim().min(1),
        horizon: z.number().int().positive(),
        count: z.number().int().min(1).max(1200).optional(),
        mode: z.enum(['From', 'UpTo']).optional(),
        time: z.string().trim().optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_chart', input, async () =>
        jsonToolResult(await getChart(client, input)),
      ),
  );

  server.registerTool(
    'saxo_screen_market',
    {
      title: 'Screen Market',
      description:
        'User-friendly read-only market screener for presets like top gainers, top losers, pre-market gainers, and pre-market losers. Uses Saxo instruments and InfoPrices only; output depends on market-data permissions and delay settings.',
      inputSchema: screenMarketSchema.shape,
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_screen_market', input, async () =>
        jsonToolResult(await screenMarket(client, input)),
      ),
  );

  server.registerTool(
    'saxo_compute_spread_quote',
    {
      title: 'Compute Spread Quote',
      description:
        'Fetch live bid/ask for each leg of a multi-leg option strategy and compute the worst-case, best-case, and mid net debit. Result is positive when the strategy is a net debit (you pay), negative when it is a net credit (you receive). Surfaces NoAccess warnings per leg when market-data terms are missing.',
      inputSchema: {
        legs: z
          .array(
            z.object({
              uic: z.number().int().nonnegative(),
              assetType: z.string().trim().min(1),
              buySell: z.enum(['Buy', 'Sell']),
              amount: z.number().positive(),
            }),
          )
          .min(1)
          .max(10),
        accountKey: z.string().trim().min(1).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_compute_spread_quote', input, async () =>
        jsonToolResult(await computeSpreadQuote(client, input)),
      ),
  );

  server.registerTool(
    'saxo_estimate_vertical_spread',
    {
      title: 'Estimate Vertical Spread Risk',
      description:
        'Pure math: given side (BullCall/BearCall/BullPut/BearPut), longStrike, shortStrike, debit (negative for credit spreads), and contracts, returns max loss, max gain, and breakeven in account currency, applying the option contract multiplier (100 for US equity options).',
      inputSchema: {
        side: z.enum(['BullCall', 'BearCall', 'BullPut', 'BearPut']),
        longStrike: z.number().positive(),
        shortStrike: z.number().positive(),
        debit: z.number(),
        contracts: z.number().int().positive(),
        assetType: z.string().trim().min(1).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_estimate_vertical_spread', input, async () =>
        jsonToolResult(estimateVerticalSpread(input)),
      ),
  );

  server.registerTool(
    'saxo_plan_option_strategy',
    {
      title: 'Plan Option Strategy',
      description:
        'Opinionated read-only options strategy planner for cash-secured puts, vertical spreads, debit spreads, and iron condors. Can include Saxo OptionsChain IV rank/percentile context. Returns ranked trade plans and precheck drafts; does not call precheck or place orders.',
      inputSchema: optionStrategyPlanSchema.shape,
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_plan_option_strategy', input, async () =>
        jsonToolResult(await planOptionStrategy(client, input)),
      ),
  );

  server.registerTool(
    'saxo_screen_option_strategies',
    {
      title: 'Screen Option Strategies',
      description:
        'Opinionated read-only screener that finds liquid US stock underlyings, derives Saxo chart, OptionsChain IV, and account-aware sizing context, can optionally enrich with Alpha Vantage news/earnings, runs option strategy planning, and returns ranked plans plus decision briefs. Saxo-only by default; does not call precheck or place orders.',
      inputSchema: optionStrategyScreenerSchema.shape,
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_screen_option_strategies', input, async () =>
        jsonToolResult(await screenOptionStrategies(client, input)),
      ),
  );

  server.registerTool(
    'saxo_screen_stock_strategies',
    {
      title: 'Screen Stock Strategies',
      description:
        'Opinionated read-only stock strategy screener with Saxo quotes, chart-based technical context, account-aware sizing, optional Alpha Vantage fundamentals/news, and decision briefs. Does not call precheck or place orders.',
      inputSchema: stockStrategyScreenerSchema.shape,
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_screen_stock_strategies', input, async () =>
        jsonToolResult(await screenStockStrategies(client, input)),
      ),
  );

  server.registerTool(
    'saxo_plan_portfolio_strategy',
    {
      title: 'Plan Portfolio Strategy',
      description:
        'Read-only whole-account portfolio strategy planner. Combines account snapshot, stock strategy screening, option strategy screening, risk caps, target allocation, and staged deployment into one decision package. Does not call precheck or place orders.',
      inputSchema: portfolioStrategySchema.shape,
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_plan_portfolio_strategy', input, async () =>
        jsonToolResult(await planPortfolioStrategy(client, input)),
      ),
  );

  server.registerTool(
    'saxo_review_strategy_positions',
    {
      title: 'Review Strategy Positions',
      description:
        'Read-only follow-up review for executed stock and option strategies. Matches expected legs to open positions, refreshes quotes, adds Greeks/DTE for options, evaluates P/L, trim/close/roll rules, and returns deterministic decision support. Does not precheck or place orders.',
      inputSchema: strategyPositionReviewSchema.shape,
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_review_strategy_positions', input, async () =>
        jsonToolResult(await reviewStrategyPositions(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_accounts',
    {
      title: 'List Accounts',
      description: 'List the authenticated client\'s trading accounts.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        includeSubAccounts: z.boolean().optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_accounts', input, async () =>
        jsonToolResult(await listAccounts(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_balance',
    {
      title: 'Get Account Balance',
      description: 'Fetch the cash + margin balance for an account.',
      inputSchema: {
        accountKey: z.string().trim().min(1).optional(),
        clientKey: z.string().trim().min(1).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_balance', input, async () =>
        jsonToolResult(await getBalance(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_positions',
    {
      title: 'List Open Positions',
      description: 'List open positions for the authenticated client or a specific account. Returns one row per position (multiple rows per instrument if filled at different prices). Use saxo_list_net_positions for the per-instrument aggregated view.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_positions', input, async () =>
        jsonToolResult(await listPositions(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_net_positions',
    {
      title: 'List Net Positions (Aggregated)',
      description: 'List positions aggregated per instrument (one row per Uic with the net amount), rather than per individual fill. Right view for "what is my current exposure?" — no manual deduplication needed.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_net_positions', input, async () =>
        jsonToolResult(await listNetPositions(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_closed_positions',
    {
      title: 'List Closed Positions',
      description: 'List closed positions / trade history.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        fromDate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.')
          .optional(),
        toDate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO 8601 date YYYY-MM-DD.')
          .optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_closed_positions', input, async () =>
        jsonToolResult(await listClosedPositions(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_activities',
    {
      title: 'List Account Activities',
      description: 'Recent account events from /port/v1/activities — placed/modified/cancelled orders, trades, dividend payments, corporate actions. Pass fromDateTime/toDateTime (ISO 8601 with timezone) to scope; defaults to a recent window on Saxo side. Useful for "what happened on my account today?" reasoning.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        fromDateTime: z.string().trim().min(1).optional(),
        toDateTime: z.string().trim().min(1).optional(),
        activityTypes: z.array(z.string().trim().min(1)).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_activities', input, async () =>
        jsonToolResult(await listActivities(client, input)),
      ),
  );

  server.registerTool(
    'saxo_list_orders',
    {
      title: 'List Orders',
      description: 'List working orders for the authenticated client or a specific account.',
      inputSchema: {
        clientKey: z.string().trim().min(1).optional(),
        accountKey: z.string().trim().min(1).optional(),
        status: z.enum(['Working', 'All']).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
        top: z.number().int().min(1).max(500).optional(),
        skip: z.number().int().min(0).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_list_orders', input, async () =>
        jsonToolResult(await listOrders(client, input)),
      ),
  );

  server.registerTool(
    'saxo_get_order',
    {
      title: 'Get Order',
      description: 'Fetch a specific order by OrderId.',
      inputSchema: {
        orderId: z.string().trim().min(1),
        clientKey: z.string().trim().min(1).optional(),
        fieldGroups: z.array(z.string().trim().min(1)).optional(),
      },
      annotations: READ_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_get_order', input, async () =>
        jsonToolResult(await getOrder(client, input)),
      ),
  );

  server.registerTool(
    'saxo_precheck_order',
    {
      title: 'Precheck Order',
      description:
        'Validate an order against Saxo (margin, prices, instrument rules) without placing it. Runs through the policy + audit even though no execution happens.',
      inputSchema: placeOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_precheck_order', input, async () => {
        applyOrderPolicy(input as PlaceOrderInput);
        return jsonToolResult(await precheckOrder(client, input as PlaceOrderInput));
      }),
  );

  server.registerTool(
    'saxo_place_order',
    {
      title: 'Place Order',
      description:
        'Place a new Saxo order. Defaults to SIM. LIVE writes require SAXO_ENABLE_LIVE_TRADING=true plus a policy.json that sets allow_live_writes=true. Policy may also cap Amount/AssetType/AccountKey/Uic/notional.',
      inputSchema: placeOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_place_order', input, async () => {
        const order = input as PlaceOrderInput;
        applyOrderPolicy(order);
        await maybeRunPrecheck(client, order);
        const result = await placeOrder(client, order);
        return jsonToolResult(result);
      }),
  );

  server.registerTool(
    'saxo_modify_order',
    {
      title: 'Modify Order',
      description:
        'Modify a working order (amount, price, duration). Same LIVE guards as saxo_place_order.',
      inputSchema: modifyOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_modify_order', input, async () => {
        const order = input as ModifyOrderInput;
        applyOrderPolicy({
          AccountKey: order.AccountKey,
          Uic: order.Uic,
          AssetType: order.AssetType,
          Amount: order.Amount,
          OrderType: order.OrderType,
          OrderPrice: order.OrderPrice,
          StopPrice: order.StopPrice,
        });
        return jsonToolResult(await modifyOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_cancel_order',
    {
      title: 'Cancel Order',
      description: 'Cancel one or more working orders. LIVE writes require SAXO_ENABLE_LIVE_TRADING=true.',
      inputSchema: {
        orderIds: z.array(z.string().trim().min(1)).min(1).max(10),
        accountKey: z.string().trim().min(1),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_cancel_order', input, async () => {
        applyOrderPolicy({ AccountKey: input.accountKey });
        return jsonToolResult(await cancelOrder(client, input));
      }),
  );

  server.registerTool(
    'saxo_precheck_multileg_order',
    {
      title: 'Precheck Multi-Leg Option Order',
      description:
        'Validate a multi-leg option strategy (vertical/calendar spread, condor, straddle, etc.) without placing it. OrderType must be Limit; OrderPrice is always **positive** — the absolute limit price you are willing to pay (debit spreads) or receive (credit spreads). Saxo infers debit vs credit from the Buy/Sell direction of the legs and rejects negative OrderPrice with "Price cannot be negative." All legs must share the same option root.',
      inputSchema: multiLegOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_precheck_multileg_order', input, async () => {
        const order = input as PlaceMultiLegOrderInput;
        applyMultiLegPolicy(order);
        return jsonToolResult(await precheckMultiLegOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_place_multileg_order',
    {
      title: 'Place Multi-Leg Option Order',
      description:
        'Place a multi-leg option strategy as one atomic order with a single limit price. OrderType must be Limit. OrderPrice is always positive — the absolute price you are willing to pay (debit) or receive (credit); Saxo infers direction from the legs. All legs must share the same option root (same underlying + expiry). Returns MultiLegOrderId plus per-leg OrderIds.',
      inputSchema: multiLegOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_place_multileg_order', input, async () => {
        const order = input as PlaceMultiLegOrderInput;
        applyMultiLegPolicy(order);
        await maybeRunMultiLegPrecheck(client, order);
        return jsonToolResult(await placeMultiLegOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_modify_multileg_order',
    {
      title: 'Modify Multi-Leg Option Order',
      description:
        'Modify a working multi-leg order. Only Amount (scaled symmetrically across legs) and OrderPrice can be changed.',
      inputSchema: modifyMultiLegOrderSchema,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_modify_multileg_order', input, async () => {
        const order = input as ModifyMultiLegOrderInput;
        applyMultiLegPolicy({
          AccountKey: order.AccountKey,
          OrderPrice: order.OrderPrice,
          Legs: typeof order.Amount === 'number' ? [{ Amount: order.Amount }] : [],
        });
        return jsonToolResult(await modifyMultiLegOrder(client, order));
      }),
  );

  server.registerTool(
    'saxo_cancel_multileg_order',
    {
      title: 'Cancel Multi-Leg Option Order',
      description: 'Cancel a working multi-leg order. Cancels the whole strategy — individual legs cannot be cancelled separately.',
      inputSchema: {
        multiLegOrderId: z.string().trim().min(1),
        accountKey: z.string().trim().min(1),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_cancel_multileg_order', input, async () => {
        applyMultiLegPolicy({ AccountKey: input.accountKey, Legs: [] });
        return jsonToolResult(await cancelMultiLegOrder(client, input));
      }),
  );

  server.registerTool(
    'saxo_oauth_login',
    {
      title: 'Run Saxo OAuth Login',
      description:
        'Run the full Saxo OAuth2 + PKCE login in one MCP call. Starts a loopback callback listener, optionally opens the browser, waits for approval, exchanges tokens, updates the running MCP server, and optionally persists tokens to an env file.',
      inputSchema: {
        environment: z.enum(['sim', 'live']).optional(),
        timeoutSeconds: z.number().int().min(5).max(900).default(180),
        openBrowser: z.boolean().default(true),
        writeToEnvFile: z.boolean().default(false),
        envFilePath: z.string().trim().min(1).optional(),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_oauth_login', input, async () => {
        const config = loadOauthConfigFromEnv(input.environment);
        const flow = startOauthFlow(config);
        const browserOpened = input.openBrowser ? openBrowser(flow.authorizeUrl) : false;

        try {
          const { tokens, environment } = await completeOauthFlow(flow.ticketId, input.timeoutSeconds * 1000);
          client.setTokens(tokens);

          const envFilePath = input.writeToEnvFile
            ? await persistOauthTokens(environment, tokens, input.envFilePath)
            : undefined;

          return jsonToolResult({
            status: 'ok',
            environment,
            redirectUri: flow.redirectUri,
            browserOpened,
            expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : undefined,
            hasRefreshToken: Boolean(tokens.refreshToken),
            tokenStorage: input.writeToEnvFile ? 'env_file' : 'memory',
            envFilePath,
            warnings: environment !== client.environment
              ? [`Authenticated ${environment}, but the running Saxo client was constructed for ${client.environment}. Restart the MCP server with SAXO_ENVIRONMENT=${environment} before using the token.`]
              : [],
          });
        } catch (error) {
          cancelOauthFlow(flow.ticketId);
          throw error;
        }
      }),
  );

  server.registerTool(
    'saxo_oauth_start',
    {
      title: 'Start Saxo OAuth Login',
      description:
        'Begin a Saxo OAuth2 + PKCE login. Requires SAXO_APP_KEY + SAXO_APP_SECRET in the MCP server environment. Returns a ticketId and an authorizeUrl, optionally opening it in the browser. Then call saxo_oauth_complete with the ticketId.',
      inputSchema: {
        environment: z.enum(['sim', 'live']).optional(),
        openBrowser: z.boolean().default(false),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_oauth_start', input, async () => {
        const config = loadOauthConfigFromEnv(input.environment);
        const flow = startOauthFlow(config);
        const browserOpened = input.openBrowser ? openBrowser(flow.authorizeUrl) : false;
        return jsonToolResult({
          ticketId: flow.ticketId,
          authorizeUrl: flow.authorizeUrl,
          redirectUri: flow.redirectUri,
          environment: flow.environment,
          browserOpened,
          instructions:
            'Open authorizeUrl in your browser, approve the consent, then call saxo_oauth_complete with this ticketId.',
        });
      }),
  );

  server.registerTool(
    'saxo_oauth_complete',
    {
      title: 'Complete Saxo OAuth Login',
      description:
        'Wait for the Saxo callback, exchange the code for tokens, and update the running MCP server. Optionally writes tokens to a .env file.',
      inputSchema: {
        ticketId: z.string().trim().min(1),
        timeoutSeconds: z.number().int().min(5).max(900).default(180),
        writeToEnvFile: z.boolean().default(false),
        envFilePath: z.string().trim().min(1).optional(),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_oauth_complete', input, async () => {
        const { tokens, environment } = await completeOauthFlow(input.ticketId, input.timeoutSeconds * 1000);

        client.setTokens(tokens);

        const envFilePath = input.writeToEnvFile
          ? await persistOauthTokens(environment, tokens, input.envFilePath)
          : undefined;

        return jsonToolResult({
          status: 'ok',
          environment,
          expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : undefined,
          hasRefreshToken: Boolean(tokens.refreshToken),
          tokenStorage: input.writeToEnvFile ? 'env_file' : 'memory',
          envFilePath,
        });
      }),
  );

  server.registerTool(
    'saxo_oauth_cancel',
    {
      title: 'Cancel Saxo OAuth Login',
      description: 'Cancel a pending OAuth login flow (closes the callback listener).',
      inputSchema: {
        ticketId: z.string().trim().min(1),
      },
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async input =>
      runAuditedTool(client, 'saxo_oauth_cancel', input, async () =>
        jsonToolResult({ cancelled: cancelOauthFlow(input.ticketId) }),
      ),
  );
}

async function persistOauthTokens(
  environment: string,
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  envFilePathInput?: string,
): Promise<string> {
  const envFilePath = resolve(process.cwd(), envFilePathInput ?? '.env');
  const entries: Record<string, string> = {
    SAXO_ENVIRONMENT: environment,
    SAXO_ACCESS_TOKEN: tokens.accessToken,
  };
  if (tokens.refreshToken) {
    entries.SAXO_REFRESH_TOKEN = tokens.refreshToken;
  }
  if (tokens.expiresAt) {
    entries.SAXO_TOKEN_EXPIRES_AT = new Date(tokens.expiresAt).toISOString();
  }
  await upsertEnvFile(envFilePath, entries);
  return envFilePath;
}

function applyOrderPolicy(order: OrderPolicyInput): void {
  const policy = loadPolicy();
  checkOrder(order, policy);
}

function applyMultiLegPolicy(order: {
  AccountKey?: string;
  OrderPrice?: number;
  Legs: Array<{ Uic?: number; AssetType?: string; Amount?: number; BuySell?: 'Buy' | 'Sell' }>;
}): void {
  const policy = loadPolicy();
  checkMultiLegOrder(order, policy);
}

async function maybeRunPrecheck(client: SaxoClient, order: PlaceOrderInput): Promise<void> {
  if (!client.isLive()) {
    return;
  }

  const policy = loadPolicy();
  if (!policy.require_precheck_on_live) {
    return;
  }

  await precheckOrder(client, order);
}

async function maybeRunMultiLegPrecheck(
  client: SaxoClient,
  order: PlaceMultiLegOrderInput,
): Promise<void> {
  if (!client.isLive()) {
    return;
  }

  const policy = loadPolicy();
  if (!policy.require_precheck_on_live) {
    return;
  }

  await precheckMultiLegOrder(client, order);
}

async function runAuditedTool<T>(
  client: SaxoClient,
  tool: string,
  input: unknown,
  call: () => Promise<T>,
): Promise<T> {
  const decision = checkToolAllowed({
    tool,
    environment: client.environment,
    liveTradingEnabled: isLiveTradingEnabled(),
    policy: loadPolicy(),
  });

  const target = auditTarget(input);

  if (!decision.allowed) {
    await writeAuditEvent({
      tool,
      environment: client.environment,
      action: 'policy_denied',
      target,
      reason: decision.reason,
    });
    throw new SaxoPolicyDeniedError(tool, decision.reason);
  }

  await writeAuditEvent({
    tool,
    environment: client.environment,
    action: 'start',
    target,
    reason: decision.reason,
  });

  try {
    const result = await call();
    await writeAuditEvent({
      tool,
      environment: client.environment,
      action: 'finish',
      target,
      status: 'ok',
      orderId: extractOrderId(result),
    });
    return result;
  } catch (error) {
    await writeAuditEvent({
      tool,
      environment: client.environment,
      action: 'error',
      target,
      status: 'error',
      error: formatUnknownError(error),
    });
    throw error;
  }
}

function extractOrderId(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) {
    return undefined;
  }
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const text = content?.[0]?.text;
  if (!text) {
    return undefined;
  }
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const orderId =
      data.MultiLegOrderId ?? data.OrderId ?? data.OrderID ?? data.orderId;
    return typeof orderId === 'string' ? orderId : undefined;
  } catch {
    return undefined;
  }
}

function auditTarget(input: unknown): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }
  const value = input as Record<string, unknown>;
  return {
    AccountKey: value.AccountKey,
    accountKey: value.accountKey,
    Uic: value.Uic,
    uic: value.uic,
    uics: value.uics,
    AssetType: value.AssetType,
    assetType: value.assetType,
    BuySell: value.BuySell,
    Amount: value.Amount,
    amount: value.amount,
    OrderType: value.OrderType,
    OrderDuration: value.OrderDuration,
    Legs: value.Legs,
    MultiLegOrderId: value.MultiLegOrderId,
    multiLegOrderId: value.multiLegOrderId,
    optionRootId: value.optionRootId,
    expiryDates: value.expiryDates,
    strikeCount: value.strikeCount,
    side: value.side,
    longStrike: value.longStrike,
    shortStrike: value.shortStrike,
    debit: value.debit,
    contracts: value.contracts,
    legs: value.legs,
    symbol: value.symbol,
    expiry: value.expiry,
    strike: value.strike,
    putCall: value.putCall,
    fromDateTime: value.fromDateTime,
    toDateTime: value.toDateTime,
    activityTypes: value.activityTypes,
    keywords: value.keywords,
    exchangeId: value.exchangeId,
    horizon: value.horizon,
    orderId: value.orderId,
    orderIds: value.orderIds,
    status: value.status,
    fromDate: value.fromDate,
    toDate: value.toDate,
    fieldGroups: value.fieldGroups,
    query: value.query,
    limit: value.limit,
  };
}

function jsonToolResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export const SAXO_TOOL_IDS = SAXO_CAPABILITIES.map(capability => capability.id);
