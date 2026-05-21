export type CapabilityRisk = 'read' | 'write';

export interface SaxoCapability {
  id: string;
  title: string;
  description: string;
  risk: CapabilityRisk;
  examples: unknown[];
  identifierFormats: string[];
  safetyNotes: string[];
  keywords: string[];
}

export const READ_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const WRITE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const SAXO_CAPABILITIES: SaxoCapability[] = [
  {
    id: 'saxo_capabilities',
    title: 'Search Saxo Capabilities',
    description: 'Discover the Saxo MCP tools, their inputs and risk level.',
    risk: 'read',
    examples: [{ query: 'place order' }],
    identifierFormats: ['Tool id such as saxo_get_infoprice or saxo_place_order.'],
    safetyNotes: ['Discovery only. Does not call Saxo.'],
    keywords: ['discover', 'capabilities', 'help', 'tools'],
  },
  {
    id: 'saxo_session_me',
    title: 'Get Saxo Session',
    description:
      'Return the authenticated Saxo user (Name, ClientKey, UserKey, LegalAssetTypes, MarketDataViaOpenApiTermsAccepted). Useful to verify the access token works.',
    risk: 'read',
    examples: [{}],
    identifierFormats: [],
    safetyNotes: ['Validates the access token without side effects.'],
    keywords: ['session', 'me', 'whoami', 'token check', 'user'],
  },
  {
    id: 'saxo_diagnostics',
    title: 'Saxo OpenAPI Diagnostics',
    description:
      'Aggregate session info, capabilities, token expiry, environment, and warnings (market-data terms not accepted, DataLevel not Realtime, token expiring soon). Call this first when prices look wrong or write tools fail.',
    risk: 'read',
    examples: [{}],
    identifierFormats: [],
    safetyNotes: ['Read-only.'],
    keywords: ['diagnostics', 'health', 'ping', 'warnings', 'check', 'token'],
  },
  {
    id: 'saxo_feature_availability',
    title: 'Get Saxo Feature Availability',
    description:
      'Return Saxo feature flags for News, Calendar, Gainers/Losers, and Chart. This shows entitlements/availability only; it does not imply every feature has a public, documented endpoint exposed through this MCP server.',
    risk: 'read',
    examples: [{}],
    identifierFormats: [],
    safetyNotes: [
      'Read-only.',
      'Use this as a diagnostic for Saxo-side feature flags, not as a replacement for documented endpoint support.',
    ],
    keywords: ['features', 'availability', 'news', 'calendar', 'gainers', 'losers', 'chart'],
  },
  {
    id: 'saxo_search_instruments',
    title: 'Search Instruments',
    description: 'Search Saxo reference data for instruments by keyword and asset type.',
    risk: 'read',
    examples: [{ keywords: 'Apple', assetTypes: ['Stock'], top: 10 }],
    identifierFormats: ['Free text', 'ISIN', 'Symbol'],
    safetyNotes: ['Read-only.'],
    keywords: ['search', 'instrument', 'isin', 'symbol', 'lookup'],
  },
  {
    id: 'saxo_get_instrument_details',
    title: 'Get Instrument Details',
    description: 'Fetch detailed metadata for one or more instruments by Uic and AssetType.',
    risk: 'read',
    examples: [{ uics: [211], assetType: 'Stock' }],
    identifierFormats: ['Uic (integer)', 'AssetType'],
    safetyNotes: ['Read-only.'],
    keywords: ['instrument', 'details', 'uic', 'metadata'],
  },
  {
    id: 'saxo_list_exchanges',
    title: 'List Exchanges',
    description: 'List Saxo-supported exchanges (or one by ExchangeId).',
    risk: 'read',
    examples: [{ top: 20 }],
    identifierFormats: ['ExchangeId'],
    safetyNotes: ['Read-only.'],
    keywords: ['exchanges', 'venues', 'mic'],
  },
  {
    id: 'saxo_get_option_chain',
    title: 'Get Option Chain',
    description:
      'Fetch the option chain (strikes + expirations) for an option root. By default returns a normalized shape with one row per strike containing callUic + putUic. Pass normalize=false for the raw Saxo OptionSpace structure.',
    risk: 'read',
    examples: [
      { optionRootId: 1467, expiryDates: ['2027-01-15'] },
      { optionRootId: 1467, expiryDates: ['2027-01-15'], normalize: false },
    ],
    identifierFormats: ['optionRootId (integer)'],
    safetyNotes: ['Read-only.'],
    keywords: ['option', 'chain', 'strikes', 'expiry', 'options'],
  },
  {
    id: 'saxo_list_option_expiries',
    title: 'List Option Expiries',
    description:
      'Cheap helper: returns just available expiries (date, days-to-expiry, last trade date, strike count) for an option root. Use to pick an expiry before pulling the full chain.',
    risk: 'read',
    examples: [{ optionRootId: 1467 }],
    identifierFormats: ['optionRootId (integer)'],
    safetyNotes: ['Read-only.'],
    keywords: ['option', 'expiries', 'expiry', 'dates'],
  },
  {
    id: 'saxo_list_standard_option_expiries',
    title: 'List Standard Option Expiry Dates',
    description:
      'Standardized option-expiry calendar (3rd Friday monthlies, quarterlies, weeklies) from Saxo reference data. Distinct from saxo_list_option_expiries which is per-option-root.',
    risk: 'read',
    examples: [{}, { fromDate: '2026-01-01' }],
    identifierFormats: ['optional fromDate (ISO 8601)'],
    safetyNotes: ['Read-only.'],
    keywords: ['option', 'expiry', 'standard', 'calendar', 'monthly', 'quarterly', 'weekly'],
  },
  {
    id: 'saxo_find_option_leg',
    title: 'Find Option Leg by Symbol/Expiry/Strike',
    description:
      'Convenience helper: given symbol + expiry + strike + Call/Put, returns the option leg Uic. Compresses the 4-step option discovery flow (search → root → chain → strike) into one call. Use before saxo_place_order / saxo_place_multileg_order.',
    risk: 'read',
    examples: [
      { symbol: 'NOK', expiry: '2027-01-15', strike: 15, putCall: 'Call' },
      { symbol: 'AAPL', expiry: '2027-01-15', strike: 200, putCall: 'Put', exchangeId: 'OPRA' },
    ],
    identifierFormats: ['symbol + ISO expiry + strike + Call/Put (+ optional exchangeId)'],
    safetyNotes: ['Read-only. Composed from saxo_search_instruments + saxo_get_option_chain — same data, fewer round trips.'],
    keywords: ['option', 'find', 'lookup', 'leg', 'uic', 'discovery'],
  },
  {
    id: 'saxo_compute_spread_quote',
    title: 'Compute Spread Quote',
    description:
      'Fetch bid/ask for each leg of a multi-leg spread and compute worst-case, best-case, and mid net debit. Returns per-leg warnings when market-data terms are not accepted.',
    risk: 'read',
    examples: [
      {
        legs: [
          { uic: 53115502, assetType: 'StockOption', buySell: 'Buy', amount: 150 },
          { uic: 57413062, assetType: 'StockOption', buySell: 'Sell', amount: 150 },
        ],
      },
    ],
    identifierFormats: ['legs: Array<{uic, assetType, buySell, amount}>'],
    safetyNotes: ['Read-only.'],
    keywords: ['spread', 'quote', 'debit', 'credit', 'price', 'multileg'],
  },
  {
    id: 'saxo_estimate_vertical_spread',
    title: 'Estimate Vertical Spread Risk',
    description:
      'Pure math: given side (BullCall/BearCall/BullPut/BearPut), strikes, debit, and contracts, returns max loss, max gain, and breakeven applying the option contract multiplier (100 for US equity options).',
    risk: 'read',
    examples: [
      { side: 'BullCall', longStrike: 15, shortStrike: 20, debit: 1.08, contracts: 150 },
    ],
    identifierFormats: ['side + strikes + debit + contracts'],
    safetyNotes: ['Read-only. Does not call Saxo.'],
    keywords: ['spread', 'risk', 'breakeven', 'max loss', 'max gain', 'vertical', 'estimate'],
  },
  {
    id: 'saxo_get_infoprice',
    title: 'Get Snapshot Price',
    description: 'Fetch a snapshot bid/ask/last price for a single instrument.',
    risk: 'read',
    examples: [{ uic: 211, assetType: 'Stock', fieldGroups: ['Quote', 'PriceInfoDetails'] }],
    identifierFormats: ['Uic + AssetType'],
    safetyNotes: ['Read-only snapshot. No subscription side effects.'],
    keywords: ['price', 'quote', 'infoprice', 'snapshot'],
  },
  {
    id: 'saxo_get_infoprices_list',
    title: 'Get Snapshot Prices (List)',
    description: 'Fetch snapshot prices for multiple Uics in one call.',
    risk: 'read',
    examples: [{ uics: [211, 16], assetType: 'Stock' }],
    identifierFormats: ['Uic[] + AssetType'],
    safetyNotes: ['Read-only.'],
    keywords: ['price', 'list', 'batch', 'snapshot'],
  },
  {
    id: 'saxo_get_chart',
    title: 'Get Chart (Historical OHLC)',
    description: 'Fetch historical OHLC bars for an instrument and horizon (minutes).',
    risk: 'read',
    examples: [{ uic: 211, assetType: 'Stock', horizon: 60, count: 100 }],
    identifierFormats: ['Uic + AssetType + Horizon (minutes)'],
    safetyNotes: ['Read-only.'],
    keywords: ['chart', 'ohlc', 'bars', 'history', 'candles'],
  },
  {
    id: 'saxo_screen_market',
    title: 'Screen Market',
    description:
      'Run user-friendly market screeners like top gainers, top losers, pre-market gainers, and pre-market losers across common market presets or explicit ExchangeIds.',
    risk: 'read',
    examples: [
      { preset: 'top_gainers', market: 'us', limit: 10 },
      { preset: 'top_losers', market: 'nordics', limit: 10 },
      { preset: 'premarket_gainers', market: 'us_nasdaq', limit: 5 },
    ],
    identifierFormats: ['preset + market', 'optional Saxo ExchangeId[] override'],
    safetyNotes: [
      'Read-only discovery. Does not draft, precheck, or place orders.',
      'Results depend on Saxo market-data permissions and delay settings.',
    ],
    keywords: ['screen', 'screener', 'gainers', 'losers', 'premarket', 'market movers', 'stocks'],
  },
  {
    id: 'saxo_plan_option_strategy',
    title: 'Plan Option Strategy',
    description:
      'Generate ranked read-only option trade plans for cash-secured puts, long calls, vertical spreads, debit spreads, and iron condors using Saxo option-chain data, Saxo Greeks, optional Saxo IV context, and caller-provided external context.',
    risk: 'read',
    examples: [
      {
        accountKey: 'AccountKey...',
        keywords: 'AAPL',
        strategies: ['cash_secured_put', 'put_credit_spread', 'iron_condor'],
        includeVolatilityContext: true,
        maxCandidates: 5,
      },
    ],
    identifierFormats: ['AccountKey + keywords', 'AccountKey + OptionRootId'],
    safetyNotes: [
      'Read-only strategy planning. Does not call precheck or place orders.',
      'Returns precheck draft payloads for separate manual use with guarded order tools.',
      'Aggregates leg Greeks and penalizes unfavorable theta decay when ranking long-premium structures.',
      'Not investment advice; outputs are deterministic screens based on available Saxo data.',
    ],
    keywords: ['option', 'strategy', 'trade plan', 'cash secured put', 'long call', 'leaps', 'vertical spread', 'iron condor'],
  },
  {
    id: 'saxo_screen_option_strategies',
    title: 'Screen Option Strategies',
    description:
      'Opinionated read-only screener that finds liquid US stock underlyings, derives Saxo chart-based technical, OptionsChain IV, and Greeks context, checks StockOption availability, runs strategy planning, and ranks option trade-plan candidates across symbols.',
    risk: 'read',
    examples: [
      {
        accountKey: 'AccountKey...',
        market: 'us_nasdaq',
        underlyingUniverse: 'auto',
        playbook: 'income_30_60d',
        riskProfile: 'balanced',
        strategies: ['put_credit_spread', 'iron_condor'],
        maxUnderlyings: 50,
        maxUnderlyingScan: 500,
        maxSymbolsToPlan: 5,
        maxPlans: 10,
        includeTechnicalContext: true,
        includeVolatilityContext: true,
        includeAccountContext: true,
        riskBudgetPercent: 1,
        requireGreeks: true,
        maxThetaDailyPercentOfRisk: 1,
        includeNewsContext: false,
      },
    ],
    identifierFormats: ['AccountKey + market preset', 'AccountKey + symbols[]'],
    safetyNotes: [
      'Read-only screening. Does not call precheck or place orders.',
      'Processes candidates conservatively to reduce Saxo rate-limit risk.',
      'Use playbook, riskProfile, and objective to make ranking explicit instead of asking for a generic best trade.',
      'Use underlyingUniverse=auto to let the playbook choose bullish, bearish, or two-sided movers; set underlyingPreset only when you want a specific market-mover list.',
      'Fetches account balance and positions by default for sizing and decision-brief context; set includeAccountContext=false to opt out.',
      'Scans a larger Saxo stock universe before ranking underlyings; tune maxUnderlyingScan when you need a faster or broader pass.',
      'Saxo chart data and short-lived OptionsChain subscriptions are the default sources for deterministic TA and IV context.',
      'Saxo Greeks from option quotes are aggregated across legs so theta, delta, gamma, and vega affect strategy scoring and warnings.',
      'Set requireGreeks=true to reject candidates when Saxo does not return complete delta/gamma/theta/vega, and maxThetaDailyPercentOfRisk to cap theta decay.',
      'Alpha Vantage is optional enrichment for news/earnings only and requires ALPHA_VANTAGE_API_KEY plus includeNewsContext=true.',
      'External news or LLM context can be supplied by the caller via externalContextBySymbol.',
    ],
    keywords: ['option', 'options', 'strategy screener', 'screen strategies', 'trade plan', 'income', 'spreads'],
  },
  {
    id: 'saxo_screen_stock_strategies',
    title: 'Screen Stock Strategies',
    description:
      'Opinionated read-only stock screener that ranks US stock candidates with Saxo quotes, chart-based technical context, account-aware sizing, optional Alpha Vantage fundamentals/news, and decision briefs.',
    risk: 'read',
    examples: [
      {
        accountKey: 'AccountKey...',
        market: 'us',
        universe: 'large_cap',
        objective: 'balanced',
        riskProfile: 'balanced',
        includeAccountContext: true,
        includeFundamentalContext: true,
        riskBudgetPercentPerIdea: 1,
        maxResults: 10,
      },
    ],
    identifierFormats: ['AccountKey + market/universe', 'AccountKey + symbols[]'],
    safetyNotes: [
      'Read-only screening. Does not call precheck or place orders.',
      'Saxo does not expose market capitalization through the documented reference/price endpoints used here; set ALPHA_VANTAGE_API_KEY to enrich candidates with OVERVIEW market capitalization and fundamentals.',
      'Without Alpha Vantage, large_cap is treated as a liquid-stock universe proxy and the result includes warnings.',
      'Fetches Saxo balance and positions by default for position sizing and concentration checks; set includeAccountContext=false to opt out.',
    ],
    keywords: ['stock', 'stocks', 'strategy screener', 'market cap', 'large cap', 'portfolio', 'screen strategies'],
  },
  {
    id: 'saxo_plan_portfolio_strategy',
    title: 'Plan Portfolio Strategy',
    description:
      'Read-only whole-account strategy planner that combines account snapshot, stock strategy screening, option strategy screening, target allocation, options thesis sleeves, risk caps, and staged deployment into a single decision package.',
    risk: 'read',
    examples: [
      {
        accountKey: 'AccountKey...',
        objective: 'balanced_growth_income',
        riskProfile: 'balanced',
        portfolioProfile: 'concentrated_conviction',
        deploymentStyle: 'staged',
        includeStocks: true,
        includeOptions: true,
        stockUniverse: 'large_cap',
        stockMaxCandidates: 120,
        targetInvestedPercent: 80,
        cashReservePercent: 10,
        maxCashDollars: 1000,
        maxSingleNamePercent: 10,
        maxOptionsRiskPercent: 5,
        riskBudgetPercentPerIdea: 1,
        requireGreeks: true,
        maxThetaDailyPercentOfRisk: 1,
        discoverOptionCandidates: true,
        optionDiscoveryUniverse: 'auto',
        optionDiscoveryPlaybook: 'long_term_directional',
        optionTheses: [
          {
            name: 'AI infrastructure momentum',
            symbols: ['NVDA', 'MU'],
            role: 'tactical_momentum',
            horizon: 'swing',
            preferredStructures: ['debit_spread', 'put_credit_spread'],
          },
        ],
      },
    ],
    identifierFormats: ['AccountKey'],
    safetyNotes: [
      'Read-only planning. Does not call precheck or place orders.',
      'Uses staged deployment by default; it may leave cash undeployed when candidates do not fit the risk rules.',
      'Stock candidate discovery is controlled with stockUniverse, stockMarket, stockMaxCandidates, and stockMaxTechnicalCandidates.',
      'Uses guardrailed options sizing by default; explicit optionTheses and optionsMode=user_driven are required for high-conviction concentration.',
      'Set includeStocks=false for an options-only account; stock allocation targets then stay at zero.',
      'Set discoverOptionCandidates=true to blend explicit option theses with a deterministic Saxo market/option screener discovery sleeve.',
      'Set requireGreeks=true for options-only or aggressive accounts so candidates without complete Saxo Greeks are rejected instead of merely warned.',
      'For options-only immediate plans, contract counts scale up to configured thesis, trade, and cash-reserve budgets; staged plans remain starter-sized.',
      'Risk dashboard reports cash reserve, deployable cash, unallocated option budget, and warnings when strict filters leave material cash undeployed.',
      'Use portfolioProfile=concentrated_conviction, maxSelectedUnderlyings, minPositionRiskDollars, and maxContractsPerPosition to avoid many tiny hard-to-monitor option positions.',
      'Not investment advice; output is decision support based on available Saxo and optional external data.',
    ],
    keywords: ['portfolio', 'allocation', 'strategy', 'whole account', 'cash deployment', 'stocks', 'options', 'leaps', 'thesis'],
  },
  {
    id: 'saxo_review_strategy_positions',
    title: 'Review Strategy Positions',
    description:
      'Read-only post-execution strategy monitor for stock and option positions. Matches expected strategy legs to open Saxo positions, refreshes quotes, adds Greeks/DTE for options, evaluates P/L and follow-up rules, and returns deterministic verdicts.',
    risk: 'read',
    examples: [
      {
        accountKey: 'AccountKey...',
        defaultRules: {
          profitTakePercentOfCost: 25,
          lossExitPercentOfCost: 10,
        },
        strategyPositions: [
          {
            name: 'AMD core stock',
            thesisName: 'AI accelerator share gain',
            symbol: 'AMD',
            strategy: 'stock_core',
            entryPrice: 145,
            legs: [
              { uic: 2556, assetType: 'Stock', buySell: 'Buy', amount: 25 },
            ],
          },
        ],
      },
      {
        accountKey: 'AccountKey...',
        defaultRules: {
          profitTakePercentOfMaxProfit: 60,
          lossExitPercentOfMaxRisk: 50,
          rollWhenDaysToExpiryBelow: 21,
          closeWhenDaysToExpiryBelow: 7,
          maxThetaDailyPercentOfRisk: 1,
        },
        strategyPositions: [
          {
            name: 'NVDA Jul call debit spread',
            thesisName: 'AI semis directional options',
            symbol: 'NVDA',
            strategy: 'debit_spread',
            entryNetDebit: 18.15,
            entryMaxRisk: 1815,
            entryMaxProfit: 2685,
            legs: [
              { uic: 56275354, buySell: 'Buy', amount: 1, expiry: '2026-07-17', putCall: 'Call', strike: 215 },
              { uic: 53837883, buySell: 'Sell', amount: 1, expiry: '2026-07-17', putCall: 'Call', strike: 250 },
            ],
          },
        ],
      },
    ],
    identifierFormats: ['AccountKey + strategyPositions[].legs[].uic'],
    safetyNotes: [
      'Read-only review. Does not call precheck, place, modify, or cancel orders.',
      'Requires the executed strategy legs or saved plan metadata to evaluate a position as part of a named strategy.',
      'Stock reviews use entry cost/price rules; option reviews additionally use Greeks, theta, expiry, roll, and max-profit/max-risk rules when supplied.',
      'Returns decision support verdicts such as hold, review, consider_trim, consider_close, and roll_watch.',
    ],
    keywords: ['position follow-up', 'strategy monitor', 'stocks', 'options', 'roll', 'trim', 'close', 'theta', 'greeks'],
  },
  {
    id: 'saxo_list_accounts',
    title: 'List Accounts',
    description: "List the authenticated client's trading accounts.",
    risk: 'read',
    examples: [{}],
    identifierFormats: ['Optional ClientKey'],
    safetyNotes: ['Read-only.'],
    keywords: ['accounts', 'portfolio', 'client'],
  },
  {
    id: 'saxo_get_balance',
    title: 'Get Account Balance',
    description: 'Fetch the cash + margin balance for an account.',
    risk: 'read',
    examples: [{ accountKey: 'AccountKey...' }],
    identifierFormats: ['AccountKey'],
    safetyNotes: ['Read-only.'],
    keywords: ['balance', 'cash', 'margin'],
  },
  {
    id: 'saxo_list_positions',
    title: 'List Open Positions',
    description: 'List open positions for the authenticated client or a specific account.',
    risk: 'read',
    examples: [{}],
    identifierFormats: ['Optional AccountKey or ClientKey'],
    safetyNotes: ['Read-only.'],
    keywords: ['positions', 'open', 'portfolio'],
  },
  {
    id: 'saxo_list_closed_positions',
    title: 'List Closed Positions',
    description: 'List closed positions / trade history.',
    risk: 'read',
    examples: [{ fromDate: '2026-01-01' }],
    identifierFormats: ['Optional AccountKey, date range'],
    safetyNotes: ['Read-only.'],
    keywords: ['closed', 'history', 'pnl'],
  },
  {
    id: 'saxo_list_net_positions',
    title: 'List Net Positions (Aggregated)',
    description:
      'Positions aggregated per instrument (one row per Uic), not per fill. Right view for "what is my current exposure?" — no manual deduplication needed.',
    risk: 'read',
    examples: [{}, { accountKey: 'AccountKey...' }],
    identifierFormats: ['Optional AccountKey / ClientKey'],
    safetyNotes: ['Read-only.'],
    keywords: ['positions', 'net', 'aggregated', 'exposure'],
  },
  {
    id: 'saxo_list_activities',
    title: 'List Account Activities',
    description:
      'Account activity log: placed/modified/cancelled orders, trades, dividends, corporate actions. Pass fromDateTime/toDateTime to scope. Useful for audit trails and "what happened?" reasoning.',
    risk: 'read',
    examples: [{}, { fromDateTime: '2026-05-19T00:00:00Z' }],
    identifierFormats: ['Optional AccountKey, ISO 8601 date-time range, activity types'],
    safetyNotes: ['Read-only.'],
    keywords: ['activities', 'history', 'trades', 'audit', 'dividends', 'corporate-actions'],
  },
  {
    id: 'saxo_list_orders',
    title: 'List Orders',
    description: 'List working orders for the authenticated client or account.',
    risk: 'read',
    examples: [{ status: 'Working' }],
    identifierFormats: ['Optional AccountKey'],
    safetyNotes: ['Read-only.'],
    keywords: ['orders', 'working', 'pending'],
  },
  {
    id: 'saxo_get_order',
    title: 'Get Order',
    description: 'Fetch a specific order by OrderId.',
    risk: 'read',
    examples: [{ orderId: '12345678' }],
    identifierFormats: ['OrderId'],
    safetyNotes: ['Read-only.'],
    keywords: ['order', 'detail'],
  },
  {
    id: 'saxo_precheck_order',
    title: 'Precheck Order',
    description: 'Validate an order against Saxo (margin, prices, instrument rules) without placing it.',
    risk: 'write',
    examples: [
      {
        AccountKey: 'AccountKey...',
        Uic: 211,
        AssetType: 'Stock',
        BuySell: 'Buy',
        Amount: 1,
        OrderType: 'Market',
        OrderDuration: { DurationType: 'DayOrder' },
      },
    ],
    identifierFormats: ['Full Saxo order body'],
    safetyNotes: [
      'No execution but counted as a write tool — runs through policy + audit.',
    ],
    keywords: ['precheck', 'validate', 'dryrun'],
  },
  {
    id: 'saxo_place_order',
    title: 'Place Order',
    description:
      'Place a new order. On LIVE requires SAXO_ENABLE_LIVE_TRADING=true and a policy.json that sets allow_live_writes=true.',
    risk: 'write',
    examples: [
      {
        AccountKey: 'AccountKey...',
        Uic: 211,
        AssetType: 'Stock',
        BuySell: 'Buy',
        Amount: 1,
        OrderType: 'Market',
        OrderDuration: { DurationType: 'DayOrder' },
      },
    ],
    identifierFormats: ['Full Saxo order body'],
    safetyNotes: [
      'Defaults to SIM. LIVE writes are denied unless explicitly enabled.',
      'Policy may cap Amount, AssetType, AccountKey, Uic, and notional.',
    ],
    keywords: ['place', 'order', 'buy', 'sell', 'trade'],
  },
  {
    id: 'saxo_modify_order',
    title: 'Modify Order',
    description: 'Modify an existing working order (amount, price, duration).',
    risk: 'write',
    examples: [
      {
        OrderId: '12345678',
        AccountKey: 'AccountKey...',
        Uic: 211,
        AssetType: 'Stock',
        OrderPrice: 150.5,
      },
    ],
    identifierFormats: ['OrderId + AccountKey + Uic + AssetType'],
    safetyNotes: ['Same guards as saxo_place_order.'],
    keywords: ['modify', 'change', 'order'],
  },
  {
    id: 'saxo_cancel_order',
    title: 'Cancel Order',
    description: 'Cancel one or more working orders.',
    risk: 'write',
    examples: [{ orderIds: ['12345678'], accountKey: 'AccountKey...' }],
    identifierFormats: ['OrderId[]'],
    safetyNotes: ['LIVE writes require SAXO_ENABLE_LIVE_TRADING=true.'],
    keywords: ['cancel', 'order', 'delete'],
  },
  {
    id: 'saxo_precheck_multileg_order',
    title: 'Precheck Multi-Leg Option Order',
    description:
      'Validate a multi-leg option strategy (spread, condor, straddle, etc.) without placing it. OrderType must be Limit; OrderPrice is always positive — the absolute price you are willing to pay (debit) or receive (credit). Saxo infers direction from the legs.',
    risk: 'write',
    examples: [
      {
        AccountKey: 'AccountKey...',
        OrderType: 'Limit',
        OrderPrice: 1.08,
        OrderDuration: { DurationType: 'DayOrder' },
        Legs: [
          { Uic: 14853018, AssetType: 'StockOption', BuySell: 'Buy', Amount: 1, ToOpenClose: 'ToOpen' },
          { Uic: 14853056, AssetType: 'StockOption', BuySell: 'Sell', Amount: 1, ToOpenClose: 'ToOpen' },
        ],
      },
    ],
    identifierFormats: ['Multi-leg body with Legs[] (min 2, max 20)'],
    safetyNotes: ['Same guards as place_multileg_order. No execution.'],
    keywords: ['multileg', 'precheck', 'option', 'spread', 'validate'],
  },
  {
    id: 'saxo_place_multileg_order',
    title: 'Place Multi-Leg Option Order',
    description:
      'Place a multi-leg option strategy as one atomic order with a single positive limit price (debit = pay, credit = receive). All legs must share the same option root. OrderType must be Limit.',
    risk: 'write',
    examples: [
      {
        AccountKey: 'AccountKey...',
        OrderType: 'Limit',
        OrderPrice: 1.08,
        OrderDuration: { DurationType: 'GoodTillCancel' },
        Legs: [
          { Uic: 14853018, AssetType: 'StockOption', BuySell: 'Buy', Amount: 150, ToOpenClose: 'ToOpen' },
          { Uic: 14853056, AssetType: 'StockOption', BuySell: 'Sell', Amount: 150, ToOpenClose: 'ToOpen' },
        ],
      },
    ],
    identifierFormats: ['Multi-leg body with Legs[] (min 2, max 20)'],
    safetyNotes: [
      'LIVE writes require SAXO_ENABLE_LIVE_TRADING=true + policy.allow_live_writes.',
      'OrderPrice is always positive (debit = pay, credit = receive). Saxo rejects negative.',
    ],
    keywords: ['multileg', 'place', 'option', 'spread', 'straddle', 'condor', 'vertical'],
  },
  {
    id: 'saxo_modify_multileg_order',
    title: 'Modify Multi-Leg Option Order',
    description:
      'Modify a working multi-leg order. Only Amount (symmetric across legs) and OrderPrice can be changed.',
    risk: 'write',
    examples: [{ AccountKey: 'AccountKey...', MultiLegOrderId: '88608648', OrderPrice: 1.15 }],
    identifierFormats: ['MultiLegOrderId'],
    safetyNotes: ['Same LIVE guards as place_multileg_order.'],
    keywords: ['multileg', 'modify', 'change'],
  },
  {
    id: 'saxo_cancel_multileg_order',
    title: 'Cancel Multi-Leg Option Order',
    description: 'Cancel a working multi-leg order (cancels the whole strategy, not individual legs).',
    risk: 'write',
    examples: [{ multiLegOrderId: '88608648', accountKey: 'AccountKey...' }],
    identifierFormats: ['MultiLegOrderId'],
    safetyNotes: ['LIVE writes require SAXO_ENABLE_LIVE_TRADING=true.'],
    keywords: ['multileg', 'cancel', 'spread'],
  },
  {
    id: 'saxo_oauth_start',
    title: 'Start Saxo OAuth Login',
    description:
      'Begin a Saxo OAuth2 + PKCE login. Returns a ticketId, an authorize URL the user opens in their browser, and the loopback redirect URI. Requires SAXO_APP_KEY + SAXO_APP_SECRET in the MCP server environment.',
    risk: 'write',
    examples: [{ environment: 'sim' }],
    identifierFormats: ['environment: sim|live'],
    safetyNotes: [
      'Only listens on loopback (127.0.0.1).',
      'Tokens never leave the MCP server process unless writeToEnvFile is set.',
    ],
    keywords: ['oauth', 'login', 'token', 'pkce', 'authorize'],
  },
  {
    id: 'saxo_oauth_complete',
    title: 'Complete Saxo OAuth Login',
    description:
      'Finish a Saxo OAuth login started by saxo_oauth_start. Waits for the user to approve in the browser, exchanges the code for tokens, and updates the running MCP server. Optionally writes tokens to a .env file.',
    risk: 'write',
    examples: [{ ticketId: 'uuid', timeoutSeconds: 120 }],
    identifierFormats: ['ticketId from saxo_oauth_start'],
    safetyNotes: [
      'Tokens replace SAXO_ACCESS_TOKEN/SAXO_REFRESH_TOKEN in the running process.',
      'Persisting to .env is opt-in.',
    ],
    keywords: ['oauth', 'complete', 'callback', 'tokens'],
  },
  {
    id: 'saxo_oauth_cancel',
    title: 'Cancel Saxo OAuth Login',
    description: 'Cancel a pending OAuth login (closes the callback listener).',
    risk: 'write',
    examples: [{ ticketId: 'uuid' }],
    identifierFormats: ['ticketId from saxo_oauth_start'],
    safetyNotes: ['No persistent effect.'],
    keywords: ['oauth', 'cancel', 'abort'],
  },
];

export function searchCapabilities(query: string, limit = 20): SaxoCapability[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return SAXO_CAPABILITIES.slice(0, limit);
  }

  return SAXO_CAPABILITIES.map(capability => ({
    capability,
    score: scoreCapability(capability, normalized),
  }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id))
    .slice(0, limit)
    .map(item => item.capability);
}

function scoreCapability(capability: SaxoCapability, query: string): number {
  const haystack = [
    capability.id,
    capability.title,
    capability.description,
    ...capability.identifierFormats,
    ...capability.keywords,
  ]
    .join(' ')
    .toLowerCase();

  return query
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}
