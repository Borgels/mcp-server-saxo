import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SaxoHttpError } from '../errors.js';
import type { SaxoClient } from './client.js';
import { readEnv } from './env.js';
import { getBalance, listAccounts, listNetPositions, listOrders, listPositions } from './portfolio.js';
import { recordAccountSnapshot } from './trading-ledger.js';

export interface AccountStatusReportInput {
  accountKey?: string;
  clientKey?: string;
  outputDir?: string;
  writeSnapshot?: boolean;
  compareWith?: string;
  historyLimit?: number;
  timezone?: string;
  includeRaw?: boolean;
  probeHistoricalEndpoints?: boolean;
  dbPath?: string;
}

export interface AccountStatusReport {
  generatedAt: string;
  tradingDate: string;
  environment: string;
  filters: {
    accountKey?: string;
    clientKey?: string;
    outputDir: string;
    writeSnapshot: boolean;
    compareWith?: string;
  };
  endpointStatus: EndpointStatus[];
  account?: AccountSummary;
  balance?: BalanceSummary;
  positionSummary: PositionSummary;
  positions: NormalizedPosition[];
  orders: {
    workingCount?: number;
    allCount?: number;
  };
  delta?: SnapshotDelta;
  dailyHistory: DailyHistoryEntry[];
  snapshotPath?: string;
  dbPath?: string;
  raw?: {
    session?: unknown;
    accounts?: unknown;
    balance?: unknown;
    positions?: unknown;
    netPositions?: unknown;
    workingOrders?: unknown;
    allOrders?: unknown;
  };
  warnings: string[];
}

interface EndpointStatus {
  endpoint: string;
  ok: boolean;
  status?: number;
  message?: string;
  count?: number;
}

interface AccountSummary {
  accountId?: string;
  accountKey?: string;
  clientKey?: string;
  currency?: string;
  accountType?: string;
  accountSubType?: string;
}

interface BalanceSummary {
  currency?: string;
  cashAvailableForTrading?: number;
  cashBalance?: number;
  totalValue?: number;
  netPositionsValue?: number;
  optionPremiumsMarketValue?: number;
  unrealizedPositionsValue?: number;
  marginUtilizationPct?: number;
  marginAvailableForTrading?: number;
  collateralAvailable?: number;
}

interface PositionSummary {
  count: number;
  totalMarketValue?: number;
  totalUnrealizedPnl?: number;
  bySymbol: PositionAggregate[];
  byUnderlying: PositionAggregate[];
  byAssetType: PositionAggregate[];
}

interface PositionAggregate {
  key: string;
  count: number;
  amount?: number;
  marketValue?: number;
  unrealizedPnl?: number;
}

interface NormalizedPosition {
  key: string;
  positionId?: string;
  netPositionId?: string;
  uic?: number;
  assetType?: string;
  symbol?: string;
  underlyingSymbol?: string;
  description?: string;
  buySell?: string;
  amount?: number;
  signedAmount?: number;
  marketValue?: number;
  unrealizedPnl?: number;
  currentPrice?: number;
  averageOpenPrice?: number;
  expiry?: string;
  putCall?: string;
  strike?: number;
  raw?: unknown;
}

interface SnapshotDelta {
  comparedWith: {
    path: string;
    generatedAt?: string;
    tradingDate?: string;
  };
  balance: Record<string, number>;
  positionSummary: {
    totalMarketValue?: number;
    totalUnrealizedPnl?: number;
  };
  positions: PositionDelta[];
}

interface PositionDelta {
  key: string;
  symbol?: string;
  assetType?: string;
  amount?: number;
  signedAmount?: number;
  marketValue?: number;
  unrealizedPnl?: number;
  previousAmount?: number;
  currentAmount?: number;
}

interface DailyHistoryEntry {
  tradingDate: string;
  generatedAt: string;
  snapshotPath?: string;
  totalValue?: number;
  cashAvailableForTrading?: number;
  optionPremiumsMarketValue?: number;
  totalPositionMarketValue?: number;
  totalUnrealizedPnl?: number;
  workingOrdersCount?: number;
}

export async function accountStatusReport(
  client: SaxoClient,
  input: AccountStatusReportInput = {},
  now = new Date(),
): Promise<AccountStatusReport> {
  const generatedAt = now.toISOString();
  const timezone = input.timezone ?? readEnv('SAXO_ACCOUNT_STATUS_TIMEZONE') ?? 'Europe/Paris';
  const tradingDate = formatTradingDate(now, timezone);
  const outputDir = resolve(input.outputDir ?? readEnv('SAXO_ACCOUNT_STATUS_DIR') ?? process.cwd());
  const writeSnapshot = input.writeSnapshot ?? true;
  const endpointStatus: EndpointStatus[] = [];
  const warnings: string[] = [];

  const session = await capture(endpointStatus, 'GET /port/v1/users/me', () =>
    client.get('/port/v1/users/me'),
  );
  const accounts = await capture(endpointStatus, 'GET /port/v1/accounts/me', () =>
    listAccounts(client, { clientKey: input.clientKey, includeSubAccounts: true }),
  );

  const clientKey = input.clientKey ?? stringField(session, 'ClientKey') ?? firstDataString(accounts, 'ClientKey');
  const account = pickAccount(accounts, input.accountKey);
  const accountKey = input.accountKey ?? stringField(account, 'AccountKey') ?? stringField(session, 'DefaultAccountKey');

  const balance = await capture(endpointStatus, 'GET /port/v1/balances', () =>
    getBalance(client, { accountKey, clientKey }),
  );
  const positions = await capture(endpointStatus, 'GET /port/v1/positions', () =>
    listPositions(client, {
      accountKey,
      clientKey,
      fieldGroups: ['PositionBase', 'PositionView', 'DisplayAndFormat'],
      top: 500,
    }),
  );
  const netPositions = await capture(endpointStatus, 'GET /port/v1/netpositions', () =>
    listNetPositions(client, {
      accountKey,
      clientKey,
      top: 500,
    }),
  );
  const workingOrders = await capture(endpointStatus, 'GET /port/v1/orders?Status=Working', () =>
    listOrders(client, { accountKey, clientKey, status: 'Working', top: 500 }),
  );
  const allOrders = await capture(endpointStatus, 'GET /port/v1/orders?Status=All', () =>
    listOrders(client, { accountKey, clientKey, status: 'All', top: 500 }),
  );

  if (input.probeHistoricalEndpoints) {
    const fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate = generatedAt.slice(0, 10);
    await capture(endpointStatus, 'GET /port/v1/closedpositions', () =>
      client.get('/port/v1/closedpositions', { ClientKey: clientKey, AccountKey: accountKey, FromDate: fromDate, ToDate: toDate }),
    );
    await capture(endpointStatus, 'GET /port/v1/activities', () =>
      client.get('/port/v1/activities', { ClientKey: clientKey, AccountKey: accountKey, FromDateTime: `${fromDate}T00:00:00Z`, ToDateTime: generatedAt, $top: 100 }),
    );
  }

  const normalizedPositions = normalizePositions(
    netPositions ?? positions,
    Boolean(input.includeRaw),
    buildDisplayByUic(positions),
  );
  const balanceSummary = normalizeBalance(balance);
  const positionSummary = summarizePositions(normalizedPositions);
  const orders = {
    workingCount: dataArray(workingOrders)?.length,
    allCount: dataArray(allOrders)?.length,
  };

  const previousPath = input.compareWith ?? findLatestSnapshot(outputDir);
  let delta: SnapshotDelta | undefined;
  if (previousPath) {
    const previous = readSnapshot(previousPath, warnings);
    if (previous) {
      delta = compareSnapshots(previous, {
        generatedAt,
        tradingDate,
        balance: balanceSummary,
        positionSummary,
        positions: normalizedPositions,
      }, previousPath);
    }
  }

  let report: AccountStatusReport = {
    generatedAt,
    tradingDate,
    environment: client.environment,
    filters: {
      accountKey,
      clientKey,
      outputDir,
      writeSnapshot,
      compareWith: previousPath,
    },
    endpointStatus,
    account: normalizeAccount(account, accountKey, clientKey),
    balance: balanceSummary,
    positionSummary,
    positions: normalizedPositions,
    orders,
    delta,
    dailyHistory: [],
    warnings,
  };

  if (input.includeRaw) {
    report.raw = { session, accounts, balance, positions, netPositions, workingOrders, allOrders };
  }

  if (writeSnapshot) {
    mkdirSync(outputDir, { recursive: true });
    const snapshotPath = join(outputDir, `account-status-${tradingDate}-${safeTimestamp(generatedAt)}.json`);
    report.snapshotPath = snapshotPath;
    writeFileSync(snapshotPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  report = {
    ...report,
    dailyHistory: loadDailyHistory(outputDir, input.historyLimit ?? 10, report),
  };

  if (report.snapshotPath) {
    writeFileSync(report.snapshotPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  try {
    recordAccountSnapshot({
      dbPath: input.dbPath,
      report: report as unknown as Parameters<typeof recordAccountSnapshot>[0]['report'],
    });
    report.dbPath = input.dbPath ?? readEnv('SAXO_TRADING_DB_PATH') ?? './saxo-trading.sqlite';
  } catch (error) {
    report.warnings.push(`Could not write account snapshot to SQLite ledger: ${(error as Error).message}`);
  }

  return report;
}

async function capture<T>(
  endpointStatus: EndpointStatus[],
  endpoint: string,
  call: () => Promise<T>,
): Promise<T | undefined> {
  try {
    const result = await call();
    endpointStatus.push({
      endpoint,
      ok: true,
      count: dataArray(result)?.length,
    });
    return result;
  } catch (error) {
    endpointStatus.push({
      endpoint,
      ok: false,
      status: error instanceof SaxoHttpError ? error.status : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function normalizeAccount(account: unknown, accountKey?: string, clientKey?: string): AccountSummary | undefined {
  if (!account && !accountKey && !clientKey) {
    return undefined;
  }
  return {
    accountId: stringField(account, 'AccountId'),
    accountKey: accountKey ?? stringField(account, 'AccountKey'),
    clientKey: clientKey ?? stringField(account, 'ClientKey'),
    currency: stringField(account, 'Currency'),
    accountType: stringField(account, 'AccountType'),
    accountSubType: stringField(account, 'AccountSubType'),
  };
}

function normalizeBalance(balance: unknown): BalanceSummary | undefined {
  if (!isRecord(balance)) {
    return undefined;
  }
  return {
    currency: stringField(balance, 'Currency'),
    cashAvailableForTrading: numberField(balance, 'CashAvailableForTrading'),
    cashBalance: numberField(balance, 'CashBalance'),
    totalValue: numberField(balance, 'TotalValue'),
    netPositionsValue: numberField(balance, 'NetPositionsValue'),
    optionPremiumsMarketValue: numberField(balance, 'OptionPremiumsMarketValue'),
    unrealizedPositionsValue: numberField(balance, 'UnrealizedPositionsValue'),
    marginUtilizationPct: numberField(balance, 'MarginUtilizationPct') ?? numberField(balance, 'MarginAndCollateralUtilizationPct'),
    marginAvailableForTrading: numberField(balance, 'MarginAvailableForTrading'),
    collateralAvailable: numberField(balance, 'CollateralAvailable'),
  };
}

function normalizePositions(
  payload: unknown,
  includeRaw: boolean,
  displayByUic = new Map<number, Record<string, unknown>>(),
): NormalizedPosition[] {
  return (dataArray(payload) ?? []).map((row, index) => normalizePosition(row, index, includeRaw, displayByUic));
}

function normalizePosition(
  row: unknown,
  index: number,
  includeRaw: boolean,
  displayByUic: Map<number, Record<string, unknown>>,
): NormalizedPosition {
  const positionBase = recordField(row, 'PositionBase') ?? recordField(row, 'NetPositionBase');
  const positionView = recordField(row, 'PositionView') ?? recordField(row, 'NetPositionView');
  const uic = numberField(positionBase, 'Uic') ?? numberField(row, 'Uic');
  const display = recordField(row, 'DisplayAndFormat') ?? (uic === undefined ? undefined : displayByUic.get(uic));
  const optionsData = recordField(positionBase, 'OptionsData');
  const assetType = stringField(positionBase, 'AssetType') ?? stringField(row, 'AssetType');
  const buySell = stringField(positionBase, 'BuySell') ?? stringField(positionBase, 'OpeningDirection') ?? stringField(row, 'BuySell');
  const amount = numberField(positionBase, 'Amount') ?? numberField(row, 'Amount');
  const symbol = normalizeSymbol(stringField(display, 'Symbol') ?? stringField(row, 'Symbol'));
  const underlyingSymbol = inferUnderlyingSymbol(symbol);
  const signedAmount = signedAmountFrom(amount, buySell);
  const key = [uic ?? `row-${index}`, assetType ?? 'Unknown', symbol ?? 'Unknown'].join('|');

  return {
    key,
    positionId: stringField(row, 'PositionId'),
    netPositionId: stringField(row, 'NetPositionId'),
    uic,
    assetType,
    symbol,
    underlyingSymbol,
    description: stringField(display, 'Description') ?? stringField(display, 'InstrumentDescription'),
    buySell,
    amount,
    signedAmount,
    marketValue: numberField(positionView, 'MarketValue') ?? numberField(row, 'MarketValue'),
    unrealizedPnl:
      numberField(positionView, 'ProfitLossOnTrade') ??
      numberField(positionView, 'UnrealizedProfitLoss') ??
      numberField(positionView, 'ProfitLoss') ??
      numberField(row, 'UnrealizedProfitLoss'),
    currentPrice:
      numberField(positionView, 'CurrentPrice') ??
      numberField(positionView, 'UnderlyingCurrentPrice') ??
      numberField(row, 'CurrentPrice'),
    averageOpenPrice: numberField(positionBase, 'OpenPrice') ?? numberField(positionBase, 'Price') ?? numberField(row, 'OpenPrice'),
    expiry: stringField(optionsData, 'ExpiryDate') ?? stringField(positionBase, 'ExpiryDate') ?? stringField(row, 'ExpiryDate'),
    putCall: stringField(optionsData, 'PutCall') ?? stringField(positionBase, 'PutCall') ?? stringField(row, 'PutCall'),
    strike: numberField(optionsData, 'Strike') ?? numberField(positionBase, 'Strike') ?? numberField(row, 'Strike'),
    raw: includeRaw ? row : undefined,
  };
}

function buildDisplayByUic(positions: unknown): Map<number, Record<string, unknown>> {
  const displayByUic = new Map<number, Record<string, unknown>>();
  for (const row of dataArray(positions) ?? []) {
    const positionBase = recordField(row, 'PositionBase');
    const display = recordField(row, 'DisplayAndFormat');
    const uic = numberField(positionBase, 'Uic');
    if (uic !== undefined && display) {
      displayByUic.set(uic, display);
    }
  }
  return displayByUic;
}

function summarizePositions(positions: NormalizedPosition[]): PositionSummary {
  return {
    count: positions.length,
    totalMarketValue: sumDefined(positions.map(position => position.marketValue)),
    totalUnrealizedPnl: sumDefined(positions.map(position => position.unrealizedPnl)),
    bySymbol: aggregatePositions(positions, position => position.symbol ?? 'Unknown'),
    byUnderlying: aggregatePositions(positions, position => position.underlyingSymbol ?? position.symbol ?? 'Unknown'),
    byAssetType: aggregatePositions(positions, position => position.assetType ?? 'Unknown'),
  };
}

function aggregatePositions(
  positions: NormalizedPosition[],
  keyFor: (position: NormalizedPosition) => string,
): PositionAggregate[] {
  const aggregates = new Map<string, PositionAggregate>();
  for (const position of positions) {
    const key = keyFor(position);
    const current = aggregates.get(key) ?? { key, count: 0 };
    current.count += 1;
    current.amount = addOptional(current.amount, position.signedAmount);
    current.marketValue = addOptional(current.marketValue, position.marketValue);
    current.unrealizedPnl = addOptional(current.unrealizedPnl, position.unrealizedPnl);
    aggregates.set(key, current);
  }
  return [...aggregates.values()].sort((a, b) => Math.abs(b.marketValue ?? 0) - Math.abs(a.marketValue ?? 0));
}

function compareSnapshots(
  previous: Partial<AccountStatusReport>,
  current: {
    generatedAt: string;
    tradingDate: string;
    balance?: BalanceSummary;
    positionSummary: PositionSummary;
    positions: NormalizedPosition[];
  },
  previousPath: string,
): SnapshotDelta {
  const fields: Array<keyof BalanceSummary> = [
    'cashAvailableForTrading',
    'cashBalance',
    'totalValue',
    'netPositionsValue',
    'optionPremiumsMarketValue',
    'unrealizedPositionsValue',
    'marginAvailableForTrading',
  ];
  const balance: Record<string, number> = {};
  for (const field of fields) {
    const delta = diff(numberValue(current.balance?.[field]), numberValue(previous.balance?.[field]));
    if (delta !== undefined) {
      balance[field] = delta;
    }
  }

  const previousPositions = new Map((previous.positions ?? []).map(position => [position.key, position]));
  const currentPositions = new Map(current.positions.map(position => [position.key, position]));
  const keys = new Set([...previousPositions.keys(), ...currentPositions.keys()]);
  const positions: PositionDelta[] = [];
  for (const key of keys) {
    const before = previousPositions.get(key);
    const after = currentPositions.get(key);
    const positionDelta: PositionDelta = {
      key,
      symbol: after?.symbol ?? before?.symbol,
      assetType: after?.assetType ?? before?.assetType,
      amount: diff(after?.amount, before?.amount),
      signedAmount: diff(after?.signedAmount, before?.signedAmount),
      marketValue: diff(after?.marketValue, before?.marketValue),
      unrealizedPnl: diff(after?.unrealizedPnl, before?.unrealizedPnl),
      previousAmount: before?.signedAmount,
      currentAmount: after?.signedAmount,
    };
    if (
      positionDelta.amount !== undefined ||
      positionDelta.signedAmount !== undefined ||
      positionDelta.marketValue !== undefined ||
      positionDelta.unrealizedPnl !== undefined
    ) {
      positions.push(positionDelta);
    }
  }

  return {
    comparedWith: {
      path: previousPath,
      generatedAt: previous.generatedAt,
      tradingDate: previous.tradingDate,
    },
    balance,
    positionSummary: {
      totalMarketValue: diff(current.positionSummary.totalMarketValue, previous.positionSummary?.totalMarketValue),
      totalUnrealizedPnl: diff(current.positionSummary.totalUnrealizedPnl, previous.positionSummary?.totalUnrealizedPnl),
    },
    positions: positions.sort((a, b) => Math.abs(b.marketValue ?? 0) - Math.abs(a.marketValue ?? 0)),
  };
}

function loadDailyHistory(outputDir: string, limit: number, current: AccountStatusReport): DailyHistoryEntry[] {
  const snapshots = readSnapshotFiles(outputDir)
    .map(path => ({ path, snapshot: readSnapshot(path, []) }))
    .filter((item): item is { path: string; snapshot: Partial<AccountStatusReport> } => Boolean(item.snapshot));
  if (current.snapshotPath && !snapshots.some(item => item.path === current.snapshotPath)) {
    snapshots.push({ path: current.snapshotPath, snapshot: current });
  }

  const latestByDate = new Map<string, { path: string; snapshot: Partial<AccountStatusReport> }>();
  for (const item of snapshots) {
    const tradingDate = item.snapshot.tradingDate;
    if (!tradingDate) {
      continue;
    }
    const existing = latestByDate.get(tradingDate);
    if (!existing || String(item.snapshot.generatedAt ?? '') > String(existing.snapshot.generatedAt ?? '')) {
      latestByDate.set(tradingDate, item);
    }
  }

  return [...latestByDate.values()]
    .sort((a, b) => String(a.snapshot.tradingDate).localeCompare(String(b.snapshot.tradingDate)))
    .slice(-limit)
    .map(item => ({
      tradingDate: String(item.snapshot.tradingDate),
      generatedAt: String(item.snapshot.generatedAt ?? ''),
      snapshotPath: item.path,
      totalValue: item.snapshot.balance?.totalValue,
      cashAvailableForTrading: item.snapshot.balance?.cashAvailableForTrading,
      optionPremiumsMarketValue: item.snapshot.balance?.optionPremiumsMarketValue,
      totalPositionMarketValue: item.snapshot.positionSummary?.totalMarketValue,
      totalUnrealizedPnl: item.snapshot.positionSummary?.totalUnrealizedPnl,
      workingOrdersCount: item.snapshot.orders?.workingCount,
    }));
}

function findLatestSnapshot(outputDir: string): string | undefined {
  const snapshots = readSnapshotFiles(outputDir);
  return snapshots.at(-1);
}

function readSnapshotFiles(outputDir: string): string[] {
  try {
    return readdirSync(outputDir)
      .filter(name => /^account-status-\d{4}-\d{2}-\d{2}-.*\.json$/.test(name))
      .sort()
      .map(name => join(outputDir, name));
  } catch {
    return [];
  }
}

function readSnapshot(path: string, warnings: string[]): Partial<AccountStatusReport> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<AccountStatusReport>;
  } catch (error) {
    warnings.push(`Could not read account status snapshot ${path}: ${(error as Error).message}`);
    return undefined;
  }
}

function pickAccount(accounts: unknown, accountKey?: string): unknown {
  const accountsData = dataArray(accounts) ?? [];
  if (!accountKey) {
    return accountsData[0];
  }
  return accountsData.find(account => stringField(account, 'AccountKey') === accountKey) ?? accountsData[0];
}

function dataArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return Array.isArray(value.Data) ? value.Data : undefined;
}

function firstDataString(value: unknown, field: string): string | undefined {
  const first = dataArray(value)?.[0];
  return stringField(first, field);
}

function recordField(value: unknown, field: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[field];
  return isRecord(nested) ? nested : undefined;
}

function stringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value[field];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function numberField(value: unknown, field: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return numberValue(value[field]);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSymbol(symbol: string | undefined): string | undefined {
  return symbol?.split(':')[0]?.trim() || undefined;
}

function inferUnderlyingSymbol(symbol: string | undefined): string | undefined {
  if (!symbol) {
    return undefined;
  }
  const slashIndex = symbol.indexOf('/');
  if (slashIndex > 0) {
    return symbol.slice(0, slashIndex);
  }
  return symbol;
}

function signedAmountFrom(amount: number | undefined, buySell: string | undefined): number | undefined {
  if (amount === undefined) {
    return undefined;
  }
  return buySell === 'Sell' ? -Math.abs(amount) : Math.abs(amount);
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  if (numbers.length === 0) {
    return undefined;
  }
  return round(numbers.reduce((sum, value) => sum + value, 0));
}

function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return round(a + b);
}

function diff(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined) {
    return undefined;
  }
  return round(a - b);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatTradingDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}
