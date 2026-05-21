export type MarketContextProvider = 'auto' | 'none' | 'alpha_vantage';
export type MarketSentiment = 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';

export interface MarketNewsContext {
  source: 'alpha_vantage' | 'external';
  provider: 'alpha_vantage' | 'external' | string;
  symbol: string;
  generatedAt: string;
  lookbackDays: number;
  headlineCount: number;
  sentiment: MarketSentiment;
  sentimentScore?: number;
  latestPublishedAt?: string;
  catalystTags: string[];
  riskNotes: string[];
  summary?: string;
  headlines: Array<{
    title: string;
    source?: string;
    url?: string;
    publishedAt?: string;
    sentiment?: MarketSentiment;
    sentimentScore?: number;
    relevanceScore?: number;
  }>;
  earnings?: {
    reportDate?: string;
    fiscalDateEnding?: string;
    estimate?: number;
    currency?: string;
    daysUntil?: number;
  };
}

export interface MarketFundamentalsContext {
  source: 'alpha_vantage';
  provider: 'alpha_vantage';
  symbol: string;
  generatedAt: string;
  marketCapitalization?: number;
  marketCapBucket?: 'mega' | 'large' | 'mid' | 'small' | 'micro' | 'unknown';
  sector?: string;
  industry?: string;
  peRatio?: number;
  beta?: number;
  dividendYield?: number;
  profitMargin?: number;
  revenueTtm?: number;
  eps?: number;
  analystTargetPrice?: number;
  sharesOutstanding?: number;
  summary?: string;
  riskNotes: string[];
}

export interface MarketContextInput {
  provider?: MarketContextProvider;
  symbol: string;
  now?: Date;
  lookbackDays?: number;
  newsLimit?: number;
  earningsHorizon?: '3month' | '6month' | '12month';
  alphaVantageApiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface MarketFundamentalsInput {
  provider?: MarketContextProvider;
  symbol: string;
  now?: Date;
  alphaVantageApiKey?: string;
  fetchImpl?: typeof fetch;
}

let marketContextFetchImpl: typeof fetch | undefined;
let alphaVantageRequestGate: Promise<void> = Promise.resolve();
let alphaVantageLastRequestAt = 0;
const ALPHA_VANTAGE_MIN_INTERVAL_MS = 1100;

export function setMarketContextFetchImpl(fetchImpl: typeof fetch | undefined): void {
  marketContextFetchImpl = fetchImpl;
}

interface AlphaNewsResponse {
  feed?: AlphaNewsItem[];
  Information?: string;
  Note?: string;
  ErrorMessage?: string;
}

interface AlphaNewsItem {
  title?: string;
  url?: string;
  time_published?: string;
  summary?: string;
  source?: string;
  overall_sentiment_score?: number;
  overall_sentiment_label?: string;
  topics?: Array<{ topic?: string; relevance_score?: string }>;
  ticker_sentiment?: Array<{
    ticker?: string;
    relevance_score?: string;
    ticker_sentiment_score?: string;
    ticker_sentiment_label?: string;
  }>;
}

interface AlphaEarningsRow {
  symbol?: string;
  reportDate?: string;
  fiscalDateEnding?: string;
  estimate?: string;
  currency?: string;
}

interface AlphaOverviewResponse {
  Symbol?: string;
  AssetType?: string;
  Name?: string;
  Description?: string;
  Exchange?: string;
  Currency?: string;
  Country?: string;
  Sector?: string;
  Industry?: string;
  MarketCapitalization?: string;
  PERatio?: string;
  Beta?: string;
  DividendYield?: string;
  ProfitMargin?: string;
  RevenueTTM?: string;
  EPS?: string;
  AnalystTargetPrice?: string;
  SharesOutstanding?: string;
  Information?: string;
  Note?: string;
  ErrorMessage?: string;
}

export async function getMarketNewsContext(input: MarketContextInput): Promise<MarketNewsContext | undefined> {
  const configuredApiKey = input.alphaVantageApiKey ?? readEnv('ALPHA_VANTAGE_API_KEY');
  const provider = resolveProvider(input.provider, configuredApiKey);
  if (provider === 'none') {
    return undefined;
  }

  const apiKey = configuredApiKey;
  if (!apiKey) {
    return undefined;
  }

  const now = input.now ?? new Date();
  const lookbackDays = clampInt(input.lookbackDays ?? 7, 1, 30);
  const newsLimit = clampInt(input.newsLimit ?? 20, 1, 50);
  const fetchImpl = input.fetchImpl ?? marketContextFetchImpl ?? fetch;
  const symbol = displaySymbol(input.symbol);

  const newsResult = await settle(() => fetchAlphaNews(fetchImpl, {
    apiKey,
    limit: newsLimit,
    symbol,
    timeFrom: formatAlphaTime(new Date(now.getTime() - lookbackDays * 86_400_000)),
  }));
  const earningsResult = await settle(() => fetchAlphaEarnings(fetchImpl, {
    apiKey,
    horizon: input.earningsHorizon ?? '3month',
    symbol,
  }));
  if (newsResult.status === 'rejected' && earningsResult.status === 'rejected') {
    throw new Error(
      [
        `Alpha Vantage NEWS_SENTIMENT unavailable: ${formatError(newsResult.reason)}`,
        `Alpha Vantage EARNINGS_CALENDAR unavailable: ${formatError(earningsResult.reason)}`,
      ].join(' '),
    );
  }
  const newsResponse = newsResult.status === 'fulfilled' ? newsResult.value : { feed: [] };
  const earningsRows = earningsResult.status === 'fulfilled' ? earningsResult.value : [];

  const headlines = (newsResponse.feed ?? [])
    .map(item => toHeadline(symbol, item))
    .filter((item): item is NonNullable<ReturnType<typeof toHeadline>> => item !== undefined)
    .slice(0, newsLimit);
  const earnings = nearestEarnings(symbol, earningsRows, now);
  const sentimentScore = weightedSentimentScore(headlines);
  const sentiment = classifySentiment(sentimentScore, headlines);
  const catalystTags = collectCatalystTags(newsResponse.feed ?? [], earnings);
  const riskNotes = marketRiskNotes({
    earningsError: earningsResult.status === 'rejected' ? formatError(earningsResult.reason) : undefined,
    earnings,
    newsError: newsResult.status === 'rejected' ? formatError(newsResult.reason) : undefined,
    headlines,
    latestPublishedAt: headlines[0]?.publishedAt,
    lookbackDays,
    now,
    sentiment,
  });

  return {
    source: 'alpha_vantage',
    provider: 'alpha_vantage',
    symbol,
    generatedAt: now.toISOString(),
    lookbackDays,
    headlineCount: headlines.length,
    sentiment,
    sentimentScore: round(sentimentScore),
    latestPublishedAt: headlines[0]?.publishedAt,
    catalystTags,
    riskNotes,
    summary: marketSummary(symbol, sentiment, sentimentScore, headlines.length, earnings, catalystTags),
    headlines,
    earnings,
  };
}

export async function getMarketFundamentalsContext(
  input: MarketFundamentalsInput,
): Promise<MarketFundamentalsContext | undefined> {
  const configuredApiKey = input.alphaVantageApiKey ?? readEnv('ALPHA_VANTAGE_API_KEY');
  const provider = resolveProvider(input.provider, configuredApiKey);
  if (provider === 'none') {
    return undefined;
  }

  const apiKey = configuredApiKey;
  if (!apiKey) {
    return undefined;
  }

  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? marketContextFetchImpl ?? fetch;
  const symbol = displaySymbol(input.symbol);
  const overview = await fetchAlphaOverview(fetchImpl, { apiKey, symbol });
  const marketCapitalization = parseOptionalNumber(overview.MarketCapitalization);
  const peRatio = parseOptionalNumber(overview.PERatio);
  const beta = parseOptionalNumber(overview.Beta);
  const dividendYield = parseOptionalNumber(overview.DividendYield);
  const profitMargin = parseOptionalNumber(overview.ProfitMargin);
  const revenueTtm = parseOptionalNumber(overview.RevenueTTM);
  const eps = parseOptionalNumber(overview.EPS);
  const analystTargetPrice = parseOptionalNumber(overview.AnalystTargetPrice);
  const sharesOutstanding = parseOptionalNumber(overview.SharesOutstanding);
  const riskNotes = fundamentalsRiskNotes({
    beta,
    marketCapitalization,
    peRatio,
    profitMargin,
    sector: overview.Sector,
  });

  return {
    source: 'alpha_vantage',
    provider: 'alpha_vantage',
    symbol,
    generatedAt: now.toISOString(),
    marketCapitalization,
    marketCapBucket: marketCapBucket(marketCapitalization),
    sector: cleanOptionalString(overview.Sector),
    industry: cleanOptionalString(overview.Industry),
    peRatio,
    beta,
    dividendYield,
    profitMargin,
    revenueTtm,
    eps,
    analystTargetPrice,
    sharesOutstanding,
    summary: fundamentalsSummary(symbol, {
      beta,
      marketCapitalization,
      marketCapBucket: marketCapBucket(marketCapitalization),
      peRatio,
      sector: overview.Sector,
    }),
    riskNotes,
  };
}

function resolveProvider(provider: MarketContextProvider | undefined, apiKey: string | undefined): MarketContextProvider {
  if (provider === 'none') {
    return 'none';
  }
  if (provider === 'alpha_vantage') {
    return 'alpha_vantage';
  }
  return apiKey ? 'alpha_vantage' : 'none';
}

async function fetchAlphaNews(
  fetchImpl: typeof fetch,
  input: { apiKey: string; limit: number; symbol: string; timeFrom: string },
): Promise<AlphaNewsResponse> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'NEWS_SENTIMENT');
  url.searchParams.set('tickers', input.symbol);
  url.searchParams.set('time_from', input.timeFrom);
  url.searchParams.set('sort', 'LATEST');
  url.searchParams.set('limit', String(input.limit));
  url.searchParams.set('apikey', input.apiKey);
  const response = await fetchAlphaVantage(fetchImpl, url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Alpha Vantage NEWS_SENTIMENT failed with HTTP ${response.status}.`);
  }
  const data = await response.json() as AlphaNewsResponse;
  assertAlphaResponseOk(data, 'NEWS_SENTIMENT');
  return data;
}

async function fetchAlphaEarnings(
  fetchImpl: typeof fetch,
  input: { apiKey: string; horizon: '3month' | '6month' | '12month'; symbol: string },
): Promise<AlphaEarningsRow[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'EARNINGS_CALENDAR');
  url.searchParams.set('symbol', input.symbol);
  url.searchParams.set('horizon', input.horizon);
  url.searchParams.set('apikey', input.apiKey);
  const response = await fetchAlphaVantage(fetchImpl, url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Alpha Vantage EARNINGS_CALENDAR failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  if (/^\s*(Information|Note|Error Message)/i.test(text)) {
    throw new Error(`Alpha Vantage EARNINGS_CALENDAR returned ${text.slice(0, 160)}.`);
  }
  const parsedRows = parseCsv(text);
  const invalidMessage = alphaVantageCsvMessage(parsedRows, text);
  if (invalidMessage) {
    throw new Error(`Alpha Vantage EARNINGS_CALENDAR returned ${invalidMessage}`);
  }
  return parsedRows
    .map(row => ({
      symbol: row.symbol,
      reportDate: row.reportDate,
      fiscalDateEnding: row.fiscalDateEnding,
      estimate: row.estimate,
      currency: row.currency,
    }))
    .filter(isValidEarningsRow);
}

async function fetchAlphaOverview(
  fetchImpl: typeof fetch,
  input: { apiKey: string; symbol: string },
): Promise<AlphaOverviewResponse> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'OVERVIEW');
  url.searchParams.set('symbol', input.symbol);
  url.searchParams.set('apikey', input.apiKey);
  const response = await fetchAlphaVantage(fetchImpl, url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Alpha Vantage OVERVIEW failed with HTTP ${response.status}.`);
  }
  const data = await response.json() as AlphaOverviewResponse;
  assertAlphaResponseOk(data, 'OVERVIEW');
  if (!data.Symbol && !data.MarketCapitalization && !data.Name) {
    throw new Error('Alpha Vantage OVERVIEW returned no company overview fields.');
  }
  return data;
}

async function settle<T>(
  call: () => Promise<T>,
): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await call() };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

async function fetchAlphaVantage(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const run = alphaVantageRequestGate.then(async () => {
    const elapsed = Date.now() - alphaVantageLastRequestAt;
    if (elapsed < ALPHA_VANTAGE_MIN_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, ALPHA_VANTAGE_MIN_INTERVAL_MS - elapsed));
    }
    alphaVantageLastRequestAt = Date.now();
    return fetchImpl(url, init);
  });
  alphaVantageRequestGate = run.then(() => undefined, () => undefined);
  return run;
}

function assertAlphaResponseOk(data: AlphaNewsResponse, endpoint: string): void {
  const message = data.ErrorMessage ?? data.Information ?? data.Note;
  if (message) {
    throw new Error(`Alpha Vantage ${endpoint} returned ${redactSensitiveText(message)}`);
  }
}

function alphaVantageCsvMessage(rows: Array<Record<string, string>>, rawText: string): string | undefined {
  if (/Thank you for using Alpha Vantage|premium plans|rate limit|API requests/i.test(rawText)) {
    return redactSensitiveText(rawText.replace(/\s+/g, ' ')).slice(0, 240);
  }
  const first = rows[0];
  if (!first) {
    return undefined;
  }
  const joined = Object.values(first).join('');
  if (/^Information/i.test(joined) || /^ThankyouforusingAlphaVantage/i.test(joined)) {
    return redactSensitiveText(joined).slice(0, 240);
  }
  return undefined;
}

function toHeadline(symbol: string, item: AlphaNewsItem): MarketNewsContext['headlines'][number] | undefined {
  if (!item.title?.trim()) {
    return undefined;
  }
  const tickerSentiment = item.ticker_sentiment?.find(entry => displaySymbol(entry.ticker ?? '') === symbol);
  const sentimentScore = parseOptionalNumber(tickerSentiment?.ticker_sentiment_score)
    ?? item.overall_sentiment_score;
  return {
    title: item.title.trim(),
    source: item.source,
    url: item.url,
    publishedAt: parseAlphaPublishedAt(item.time_published),
    sentiment: classifySentiment(sentimentScore, []),
    sentimentScore: round(sentimentScore),
    relevanceScore: parseOptionalNumber(tickerSentiment?.relevance_score),
  };
}

function nearestEarnings(
  symbol: string,
  rows: AlphaEarningsRow[],
  now: Date,
): MarketNewsContext['earnings'] | undefined {
  const candidates = rows
    .filter(row => displaySymbol(row.symbol ?? '') === symbol && row.reportDate)
    .map(row => {
      const reportDate = row.reportDate;
      const daysUntil = reportDate ? Math.ceil((Date.parse(`${reportDate}T00:00:00.000Z`) - now.getTime()) / 86_400_000) : undefined;
      return {
        reportDate,
        fiscalDateEnding: row.fiscalDateEnding,
        estimate: parseOptionalNumber(row.estimate),
        currency: row.currency,
        daysUntil,
      };
    })
    .filter(row => row.daysUntil === undefined || row.daysUntil >= -1)
    .sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));
  return candidates[0];
}

function isValidEarningsRow(row: AlphaEarningsRow): boolean {
  return (
    Boolean(row.symbol && /^[A-Z][A-Z0-9.-]{0,14}$/i.test(row.symbol)) &&
    Boolean(row.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(row.reportDate))
  );
}

function weightedSentimentScore(headlines: MarketNewsContext['headlines']): number | undefined {
  const scored = headlines.filter(item => typeof item.sentimentScore === 'number');
  if (!scored.length) {
    return undefined;
  }
  const totalWeight = scored.reduce((sum, item) => sum + (item.relevanceScore ?? 1), 0);
  if (totalWeight <= 0) {
    return undefined;
  }
  return scored.reduce((sum, item) => sum + (item.sentimentScore ?? 0) * (item.relevanceScore ?? 1), 0) / totalWeight;
}

function classifySentiment(score: number | undefined, headlines: MarketNewsContext['headlines']): MarketSentiment {
  if (score === undefined || !Number.isFinite(score)) {
    return headlines.length ? 'unknown' : 'neutral';
  }
  if (headlines.length >= 3) {
    const positive = headlines.filter(item => (item.sentimentScore ?? 0) > 0.15).length;
    const negative = headlines.filter(item => (item.sentimentScore ?? 0) < -0.15).length;
    if (positive >= 1 && negative >= 1 && Math.abs(score) < 0.2) {
      return 'mixed';
    }
  }
  if (score >= 0.15) {
    return 'bullish';
  }
  if (score <= -0.15) {
    return 'bearish';
  }
  return 'neutral';
}

function collectCatalystTags(
  feed: AlphaNewsItem[],
  earnings: MarketNewsContext['earnings'],
): string[] {
  const tags = new Set<string>();
  if (earnings?.reportDate) {
    tags.add('earnings');
  }
  for (const item of feed) {
    const text = `${item.title ?? ''} ${item.summary ?? ''}`.toLowerCase();
    for (const topic of item.topics ?? []) {
      if (topic.topic) {
        tags.add(topic.topic.toLowerCase().replace(/\s+/g, '_'));
      }
    }
    if (/\b(upgrade|downgrade|price target|analyst)\b/.test(text)) tags.add('analyst');
    if (/\b(earnings|eps|revenue|guidance|outlook)\b/.test(text)) tags.add('earnings');
    if (/\b(sec|lawsuit|probe|investigation|regulator|doj|ftc)\b/.test(text)) tags.add('regulatory_legal');
    if (/\b(acquisition|merger|takeover|buyout|deal)\b/.test(text)) tags.add('m_and_a');
    if (/\b(product|launch|approval|trial|shipment)\b/.test(text)) tags.add('product');
  }
  return Array.from(tags).sort();
}

function marketRiskNotes(input: {
  earningsError?: string;
  earnings: MarketNewsContext['earnings'];
  headlines: MarketNewsContext['headlines'];
  latestPublishedAt?: string;
  lookbackDays: number;
  newsError?: string;
  now: Date;
  sentiment: MarketSentiment;
}): string[] {
  const notes: string[] = [];
  if (input.newsError) {
    notes.push(`Alpha Vantage news was unavailable: ${input.newsError}`);
  }
  if (input.earningsError) {
    notes.push(`Alpha Vantage earnings calendar was unavailable: ${input.earningsError}`);
  }
  if (input.earnings?.daysUntil !== undefined && input.earnings.daysUntil >= 0 && input.earnings.daysUntil <= 10) {
    notes.push(`Earnings are within ${input.earnings.daysUntil} days; prefer defined-risk structures or skip through the event.`);
  }
  if (!input.headlines.length) {
    notes.push(`No Alpha Vantage headlines found in the last ${input.lookbackDays} days.`);
  }
  if (input.latestPublishedAt && input.now.getTime() - Date.parse(input.latestPublishedAt) > 3 * 86_400_000) {
    notes.push('Latest headline is older than 3 days; news context may be stale.');
  }
  if (input.sentiment === 'mixed') {
    notes.push('Recent headlines have mixed sentiment; avoid over-weighting directional news.');
  }
  return notes;
}

function marketSummary(
  symbol: string,
  sentiment: MarketSentiment,
  score: number | undefined,
  headlineCount: number,
  earnings: MarketNewsContext['earnings'],
  catalystTags: string[],
): string {
  return [
    `${symbol} Alpha Vantage news sentiment is ${sentiment}`,
    score === undefined ? undefined : `(score ${round(score)})`,
    `from ${headlineCount} headlines.`,
    earnings?.reportDate ? `Next earnings date ${earnings.reportDate}${earnings.daysUntil === undefined ? '' : ` (${earnings.daysUntil} days)`}.` : undefined,
    catalystTags.length ? `Catalysts: ${catalystTags.slice(0, 8).join(', ')}.` : undefined,
  ].filter(Boolean).join(' ');
}

function fundamentalsSummary(
  symbol: string,
  input: {
    beta?: number;
    marketCapitalization?: number;
    marketCapBucket?: MarketFundamentalsContext['marketCapBucket'];
    peRatio?: number;
    sector?: string;
  },
): string {
  return [
    `${symbol} Alpha Vantage fundamentals`,
    input.marketCapBucket && input.marketCapBucket !== 'unknown' ? `market-cap bucket ${input.marketCapBucket}` : undefined,
    input.marketCapitalization !== undefined ? `(${formatLargeNumber(input.marketCapitalization)})` : undefined,
    input.sector ? `sector ${input.sector}` : undefined,
    input.peRatio !== undefined ? `P/E ${round(input.peRatio)}` : undefined,
    input.beta !== undefined ? `beta ${round(input.beta)}` : undefined,
  ].filter(Boolean).join(' ') + '.';
}

function fundamentalsRiskNotes(input: {
  beta?: number;
  marketCapitalization?: number;
  peRatio?: number;
  profitMargin?: number;
  sector?: string;
}): string[] {
  const notes: string[] = [];
  if (input.marketCapitalization !== undefined && input.marketCapitalization < 2_000_000_000) {
    notes.push('Small-cap market capitalization; expect higher gap/liquidity risk and smaller sizing.');
  }
  if ((input.beta ?? 0) >= 1.8) {
    notes.push('High beta from Alpha Vantage overview; reduce concentration for core portfolio use.');
  }
  if ((input.peRatio ?? 0) >= 80) {
    notes.push('High P/E from Alpha Vantage overview; valuation risk should be explicitly justified.');
  }
  if (input.profitMargin !== undefined && input.profitMargin < 0) {
    notes.push('Negative profit margin in Alpha Vantage overview; treat as speculative unless thesis supports it.');
  }
  return notes;
}

function marketCapBucket(value: number | undefined): MarketFundamentalsContext['marketCapBucket'] {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 'unknown';
  if (value >= 200_000_000_000) return 'mega';
  if (value >= 10_000_000_000) return 'large';
  if (value >= 2_000_000_000) return 'mid';
  if (value >= 300_000_000) return 'small';
  return 'micro';
}

function cleanOptionalString(value: string | undefined): string | undefined {
  return value && value !== 'None' ? value : undefined;
}

function formatLargeNumber(value: number): string {
  if (value >= 1_000_000_000_000) return `$${round(value / 1_000_000_000_000)}T`;
  if (value >= 1_000_000_000) return `$${round(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `$${round(value / 1_000_000)}M`;
  return `$${round(value)}`;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsvRows(text.trim());
  const headers = rows[0]?.map(header => header.trim());
  if (!headers?.length) {
    return [];
  }
  return rows.slice(1).map(row => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? '';
    });
    return record;
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function formatAlphaTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function parseAlphaPublishedAt(value: string | undefined): string | undefined {
  if (!value || !/^\d{8}T\d{4}/.test(value)) {
    return undefined;
  }
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(9, 11);
  const minute = value.slice(11, 13);
  return `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
}

function displaySymbol(symbol: string): string {
  return symbol.trim().split(':')[0]?.split('/')[0]?.toUpperCase() ?? symbol.trim().toUpperCase();
}

function parseOptionalNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function round(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

function formatError(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/(api key (?:as|is)\s+)[A-Z0-9]{8,}/gi, '$1[REDACTED]')
    .replace(/(apikey=)[A-Z0-9]{8,}/gi, '$1[REDACTED]');
}
import { readEnv } from './env.js';
