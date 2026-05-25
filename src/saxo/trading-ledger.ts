import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readEnv } from './env.js';

const SCHEMA_VERSION = 1;

export interface TradingDbInput {
  dbPath?: string;
}

export interface StrategyLegInput {
  uic: number;
  assetType?: string;
  buySell: 'Buy' | 'Sell';
  amount: number;
  expiry?: string;
  putCall?: 'Put' | 'Call';
  strike?: number;
  contractSize?: number;
  settlementStyle?: string;
  exerciseStyle?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterStrategyInput extends TradingDbInput {
  strategyId?: string;
  accountKey?: string;
  name: string;
  thesisName?: string;
  symbol?: string;
  strategy?: string;
  status?: 'planned' | 'open' | 'trimmed' | 'closed' | 'watchlist';
  horizon?: string;
  conviction?: 'low' | 'medium' | 'high';
  openedAt?: string;
  closedAt?: string;
  rules?: Record<string, unknown>;
  notes?: string;
  legs?: StrategyLegInput[];
  raw?: unknown;
}

export interface StrategyRecord {
  strategyId: string;
  accountKey?: string;
  name: string;
  thesisName?: string;
  symbol?: string;
  strategy?: string;
  status: string;
  horizon?: string;
  conviction?: string;
  openedAt?: string;
  closedAt?: string;
  rules?: unknown;
  notes?: string;
  legs: StrategyLegInput[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ListStrategiesInput extends TradingDbInput {
  accountKey?: string;
  symbol?: string;
  status?: string;
  limit?: number;
}

export interface GetStrategyInput extends TradingDbInput {
  strategyId: string;
}

export interface OrderLedgerInput extends TradingDbInput {
  environment: string;
  tool: string;
  eventType: 'place' | 'modify' | 'cancel';
  accountKey?: string;
  strategyId?: string;
  ledgerNote?: string;
  request: unknown;
  result: unknown;
  timestamp?: string;
}

export interface AccountSnapshotLedgerInput extends TradingDbInput {
  report: {
    generatedAt: string;
    tradingDate: string;
    environment: string;
    account?: { accountKey?: string; accountId?: string; currency?: string };
    balance?: Record<string, unknown>;
    positionSummary?: Record<string, unknown>;
    positions?: Array<Record<string, unknown>>;
  };
}

export interface ImportTradingHistoryInput extends TradingDbInput {
  paths?: string[];
  cwd?: string;
  limit?: number;
}

export interface ImportTradingHistoryResult {
  dbPath: string;
  scanned: number;
  imported: number;
  skipped: number;
  artifacts: Array<{
    path: string;
    classification: string;
    status: 'imported' | 'skipped' | 'error';
    message?: string;
  }>;
}

export interface TradingLedgerReportInput extends TradingDbInput {
  accountKey?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface TradingLedgerReport {
  dbPath: string;
  generatedAt: string;
  strategies: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    open: StrategyRecord[];
  };
  orderEvents: {
    total: number;
    recent: Array<Record<string, unknown>>;
    byStrategy: Array<Record<string, unknown>>;
  };
  accountSnapshots: {
    total: number;
    latest?: Record<string, unknown>;
    daily: Array<Record<string, unknown>>;
  };
  importedArtifacts: {
    total: number;
    byClassification: Array<{ classification: string; count: number }>;
  };
}

export function getTradingDbPath(inputPath?: string): string {
  const value = inputPath ?? readEnv('SAXO_TRADING_DB_PATH') ?? './saxo-trading.sqlite';
  return value === ':memory:' ? value : resolve(value);
}

export function registerStrategy(input: RegisterStrategyInput): StrategyRecord {
  const now = new Date().toISOString();
  const strategyId = input.strategyId ?? randomUUID();
  return withDb(input.dbPath, db => {
    run(db.prepare(`
      INSERT INTO strategies (
        strategy_id, account_key, name, thesis_name, symbol, strategy, status,
        horizon, conviction, opened_at, closed_at, rules_json, notes, raw_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(strategy_id) DO UPDATE SET
        account_key=excluded.account_key,
        name=excluded.name,
        thesis_name=excluded.thesis_name,
        symbol=excluded.symbol,
        strategy=excluded.strategy,
        status=excluded.status,
        horizon=excluded.horizon,
        conviction=excluded.conviction,
        opened_at=excluded.opened_at,
        closed_at=excluded.closed_at,
        rules_json=excluded.rules_json,
        notes=excluded.notes,
        raw_json=excluded.raw_json,
        updated_at=excluded.updated_at
    `),
      strategyId,
      input.accountKey,
      input.name,
      input.thesisName,
      input.symbol,
      input.strategy,
      input.status ?? 'open',
      input.horizon,
      input.conviction,
      input.openedAt,
      input.closedAt,
      stringify(input.rules),
      input.notes,
      stringify(input.raw ?? input),
      now,
      now,
    );

    run(db.prepare('DELETE FROM strategy_legs WHERE strategy_id = ?'), strategyId);
    for (const [index, leg] of (input.legs ?? []).entries()) {
      run(db.prepare(`
        INSERT INTO strategy_legs (
          strategy_id, leg_index, uic, asset_type, buy_sell, amount, expiry, put_call, strike,
          contract_size, settlement_style, exercise_style, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
        strategyId,
        index,
        leg.uic,
        leg.assetType,
        leg.buySell,
        leg.amount,
        leg.expiry,
        leg.putCall,
        leg.strike,
        leg.contractSize,
        leg.settlementStyle,
        leg.exerciseStyle,
        stringify(leg.metadata),
      );
    }

    return getStrategyFromDb(db, strategyId)!;
  });
}

export function listStrategies(input: ListStrategiesInput = {}): StrategyRecord[] {
  return withDb(input.dbPath, db => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (input.accountKey) {
      clauses.push('account_key = ?');
      params.push(input.accountKey);
    }
    if (input.symbol) {
      clauses.push('symbol = ?');
      params.push(input.symbol);
    }
    if (input.status) {
      clauses.push('status = ?');
      params.push(input.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const rows = db.prepare(`
      SELECT * FROM strategies ${where}
      ORDER BY COALESCE(opened_at, created_at) DESC
      LIMIT ${limit}
    `).all(...params) as StrategyRow[];
    return rows.map(row => strategyFromRow(db, row));
  });
}

export function getStrategy(input: GetStrategyInput): StrategyRecord | undefined {
  return withDb(input.dbPath, db => getStrategyFromDb(db, input.strategyId));
}

export function recordOrderEvent(input: OrderLedgerInput): void {
  withDb(input.dbPath, db => {
    const eventId = randomUUID();
    const timestamp = input.timestamp ?? new Date().toISOString();
    const request = input.request as Record<string, unknown>;
    const result = input.result as Record<string, unknown>;
    const orderId = stringField(result, 'OrderId') ?? stringField(result, 'OrderID') ?? stringField(request, 'OrderId');
    const multiLegOrderId =
      stringField(result, 'MultiLegOrderId') ??
      stringField(result, 'MultiLegOrderID') ??
      stringField(request, 'MultiLegOrderId');
    const externalReference = stringField(request, 'ExternalReference');

    run(db.prepare(`
      INSERT INTO order_events (
        event_id, timestamp, environment, tool, event_type, account_key,
        strategy_id, order_id, multi_leg_order_id, external_reference,
        ledger_note, request_json, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
      eventId,
      timestamp,
      input.environment,
      input.tool,
      input.eventType,
      input.accountKey ?? stringField(request, 'AccountKey') ?? stringField(request, 'accountKey'),
      input.strategyId,
      orderId,
      multiLegOrderId,
      externalReference,
      input.ledgerNote,
      stringify(input.request),
      stringify(input.result),
    );

    for (const [index, leg] of extractOrderLegs(request).entries()) {
      run(db.prepare(`
        INSERT INTO order_legs (
          event_id, leg_index, uic, asset_type, buy_sell, amount, to_open_close
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `), eventId, index, leg.uic, leg.assetType, leg.buySell, leg.amount, leg.toOpenClose);
    }
  });
}

export function recordAccountSnapshot(input: AccountSnapshotLedgerInput): void {
  withDb(input.dbPath, db => {
    const snapshotId = randomUUID();
    const report = input.report;
    const balance = report.balance ?? {};
    run(db.prepare(`
      INSERT INTO account_snapshots (
        snapshot_id, generated_at, trading_date, environment, account_key, account_id, currency,
        total_value, cash_available_for_trading, cash_balance, option_premiums_market_value,
        unrealized_positions_value, margin_utilization_pct, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
      snapshotId,
      report.generatedAt,
      report.tradingDate,
      report.environment,
      report.account?.accountKey,
      report.account?.accountId,
      report.account?.currency,
      numberField(balance, 'totalValue'),
      numberField(balance, 'cashAvailableForTrading'),
      numberField(balance, 'cashBalance'),
      numberField(balance, 'optionPremiumsMarketValue'),
      numberField(balance, 'unrealizedPositionsValue'),
      numberField(balance, 'marginUtilizationPct'),
      stringify(report),
    );

    for (const position of report.positions ?? []) {
      run(db.prepare(`
        INSERT INTO position_snapshots (
          snapshot_id, position_key, uic, asset_type, symbol, underlying_symbol, buy_sell,
          amount, signed_amount, market_value, unrealized_pnl, expiry, put_call, strike, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
        snapshotId,
        stringField(position, 'key'),
        numberField(position, 'uic'),
        stringField(position, 'assetType'),
        stringField(position, 'symbol'),
        stringField(position, 'underlyingSymbol'),
        stringField(position, 'buySell'),
        numberField(position, 'amount'),
        numberField(position, 'signedAmount'),
        numberField(position, 'marketValue'),
        numberField(position, 'unrealizedPnl'),
        stringField(position, 'expiry'),
        stringField(position, 'putCall'),
        numberField(position, 'strike'),
        stringify(position),
      );
    }
  });
}

export function importTradingHistory(input: ImportTradingHistoryInput = {}): ImportTradingHistoryResult {
  const cwd = resolve(input.cwd ?? process.cwd());
  const paths = expandImportPaths(input.paths ?? defaultImportGlobs(), cwd).slice(0, input.limit ?? 1000);
  const artifacts: ImportTradingHistoryResult['artifacts'] = [];
  let imported = 0;
  let skipped = 0;

  withDb(input.dbPath, db => {
    for (const path of paths) {
      try {
        const text = readFileSync(path, 'utf8');
        const hash = createHash('sha256').update(text).digest('hex');
        const existing = db.prepare('SELECT artifact_id FROM imported_artifacts WHERE source_path = ? AND sha256 = ?')
          .get(path, hash) as { artifact_id?: string } | undefined;
        const parsed = JSON.parse(text) as unknown;
        const classification = classifyArtifact(path, parsed);
        if (existing) {
          skipped += 1;
          artifacts.push({ path, classification, status: 'skipped' });
          continue;
        }

        run(db.prepare(`
          INSERT INTO imported_artifacts (
            artifact_id, source_path, sha256, classification, imported_at, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `), randomUUID(), path, hash, classification, new Date().toISOString(), text);
        importStructuredArtifact(db, parsed, classification, path);
        imported += 1;
        artifacts.push({ path, classification, status: 'imported' });
      } catch (error) {
        artifacts.push({ path, classification: 'unknown', status: 'error', message: (error as Error).message });
      }
    }
  });

  return {
    dbPath: getTradingDbPath(input.dbPath),
    scanned: paths.length,
    imported,
    skipped,
    artifacts,
  };
}

export function tradingLedgerReport(input: TradingLedgerReportInput = {}): TradingLedgerReport {
  return withDb(input.dbPath, db => {
    const accountClause = input.accountKey ? 'WHERE account_key = ?' : '';
    const accountParams = input.accountKey ? [input.accountKey] : [];
    const dateClauses: string[] = [];
    const dateParams: unknown[] = [];
    if (input.accountKey) {
      dateClauses.push('account_key = ?');
      dateParams.push(input.accountKey);
    }
    if (input.fromDate) {
      dateClauses.push('trading_date >= ?');
      dateParams.push(input.fromDate);
    }
    if (input.toDate) {
      dateClauses.push('trading_date <= ?');
      dateParams.push(input.toDate);
    }
    const snapshotWhere = dateClauses.length ? `WHERE ${dateClauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(input.limit ?? 25, 200));

    const strategyTotal = count(db, `SELECT COUNT(*) AS count FROM strategies ${accountClause}`, accountParams);
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) AS count FROM strategies ${accountClause}
      GROUP BY status ORDER BY count DESC
    `).all(...accountParams) as Array<{ status: string; count: number }>;
    const open = listStrategies({ dbPath: input.dbPath, accountKey: input.accountKey, status: 'open', limit });

    const eventClauses = [...dateClauses.map(clause => clause.replace('trading_date', "substr(timestamp, 1, 10)"))];
    const eventWhere = eventClauses.length ? `WHERE ${eventClauses.join(' AND ')}` : '';
    const eventTotal = count(db, `SELECT COUNT(*) AS count FROM order_events ${eventWhere}`, dateParams);
    const recent = db.prepare(`
      SELECT timestamp, tool, event_type AS eventType, account_key AS accountKey,
        strategy_id AS strategyId, order_id AS orderId, multi_leg_order_id AS multiLegOrderId,
        external_reference AS externalReference, ledger_note AS ledgerNote
      FROM order_events ${eventWhere}
      ORDER BY timestamp DESC LIMIT ${limit}
    `).all(...dateParams) as Array<Record<string, unknown>>;
    const byStrategy = db.prepare(`
      SELECT COALESCE(strategy_id, 'unassigned') AS strategyId, COUNT(*) AS events
      FROM order_events ${eventWhere}
      GROUP BY COALESCE(strategy_id, 'unassigned')
      ORDER BY events DESC
    `).all(...dateParams) as Array<Record<string, unknown>>;

    const snapshotTotal = count(db, `SELECT COUNT(*) AS count FROM account_snapshots ${snapshotWhere}`, dateParams);
    const latest = db.prepare(`
      SELECT generated_at AS generatedAt, trading_date AS tradingDate, account_key AS accountKey,
        total_value AS totalValue, cash_available_for_trading AS cashAvailableForTrading,
        option_premiums_market_value AS optionPremiumsMarketValue,
        unrealized_positions_value AS unrealizedPositionsValue
      FROM account_snapshots ${snapshotWhere}
      ORDER BY generated_at DESC LIMIT 1
    `).get(...dateParams) as Record<string, unknown> | undefined;
    const daily = db.prepare(`
      SELECT trading_date AS tradingDate, MAX(generated_at) AS generatedAt,
        total_value AS totalValue, cash_available_for_trading AS cashAvailableForTrading,
        option_premiums_market_value AS optionPremiumsMarketValue,
        unrealized_positions_value AS unrealizedPositionsValue
      FROM account_snapshots ${snapshotWhere}
      GROUP BY trading_date
      ORDER BY trading_date DESC
      LIMIT ${limit}
    `).all(...dateParams) as Array<Record<string, unknown>>;

    const artifactTotal = count(db, 'SELECT COUNT(*) AS count FROM imported_artifacts', []);
    const byClassification = db.prepare(`
      SELECT classification, COUNT(*) AS count
      FROM imported_artifacts
      GROUP BY classification
      ORDER BY count DESC
    `).all() as Array<{ classification: string; count: number }>;

    return {
      dbPath: getTradingDbPath(input.dbPath),
      generatedAt: new Date().toISOString(),
      strategies: { total: strategyTotal, byStatus, open },
      orderEvents: { total: eventTotal, recent, byStrategy },
      accountSnapshots: { total: snapshotTotal, latest, daily },
      importedArtifacts: { total: artifactTotal, byClassification },
    };
  });
}

function withDb<T>(dbPath: string | undefined, fn: (db: any) => T): T {
  const resolved = getTradingDbPath(dbPath);
  if (resolved !== ':memory:') {
    mkdirSync(dirname(resolved), { recursive: true });
  }
  const db = new DatabaseSync(resolved);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return fn(db);
  } finally {
    db.close();
  }
}

function migrate(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      strategy_id TEXT PRIMARY KEY,
      account_key TEXT,
      name TEXT NOT NULL,
      thesis_name TEXT,
      symbol TEXT,
      strategy TEXT,
      status TEXT NOT NULL,
      horizon TEXT,
      conviction TEXT,
      opened_at TEXT,
      closed_at TEXT,
      rules_json TEXT,
      notes TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS strategy_legs (
      strategy_id TEXT NOT NULL,
      leg_index INTEGER NOT NULL,
      uic INTEGER NOT NULL,
      asset_type TEXT,
      buy_sell TEXT NOT NULL,
      amount REAL NOT NULL,
      expiry TEXT,
      put_call TEXT,
      strike REAL,
      contract_size REAL,
      settlement_style TEXT,
      exercise_style TEXT,
      metadata_json TEXT,
      PRIMARY KEY (strategy_id, leg_index),
      FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS order_events (
      event_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      environment TEXT NOT NULL,
      tool TEXT NOT NULL,
      event_type TEXT NOT NULL,
      account_key TEXT,
      strategy_id TEXT,
      order_id TEXT,
      multi_leg_order_id TEXT,
      external_reference TEXT,
      ledger_note TEXT,
      request_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_legs (
      event_id TEXT NOT NULL,
      leg_index INTEGER NOT NULL,
      uic INTEGER,
      asset_type TEXT,
      buy_sell TEXT,
      amount REAL,
      to_open_close TEXT,
      PRIMARY KEY (event_id, leg_index),
      FOREIGN KEY (event_id) REFERENCES order_events(event_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS account_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      trading_date TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_key TEXT,
      account_id TEXT,
      currency TEXT,
      total_value REAL,
      cash_available_for_trading REAL,
      cash_balance REAL,
      option_premiums_market_value REAL,
      unrealized_positions_value REAL,
      margin_utilization_pct REAL,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS position_snapshots (
      snapshot_id TEXT NOT NULL,
      position_key TEXT,
      uic INTEGER,
      asset_type TEXT,
      symbol TEXT,
      underlying_symbol TEXT,
      buy_sell TEXT,
      amount REAL,
      signed_amount REAL,
      market_value REAL,
      unrealized_pnl REAL,
      expiry TEXT,
      put_call TEXT,
      strike REAL,
      raw_json TEXT NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES account_snapshots(snapshot_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS imported_artifacts (
      artifact_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      classification TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      UNIQUE(source_path, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_strategies_symbol ON strategies(symbol);
    CREATE INDEX IF NOT EXISTS idx_order_events_strategy ON order_events(strategy_id);
    CREATE INDEX IF NOT EXISTS idx_account_snapshots_date ON account_snapshots(trading_date);
  `);
  addColumnIfMissing(db, 'strategy_legs', 'contract_size', 'REAL');
  addColumnIfMissing(db, 'strategy_legs', 'settlement_style', 'TEXT');
  addColumnIfMissing(db, 'strategy_legs', 'exercise_style', 'TEXT');
  addColumnIfMissing(db, 'strategy_legs', 'metadata_json', 'TEXT');
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function addColumnIfMissing(db: any, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!rows.some(row => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

interface StrategyRow {
  strategy_id: string;
  account_key?: string;
  name: string;
  thesis_name?: string;
  symbol?: string;
  strategy?: string;
  status: string;
  horizon?: string;
  conviction?: string;
  opened_at?: string;
  closed_at?: string;
  rules_json?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

function getStrategyFromDb(db: any, strategyId: string): StrategyRecord | undefined {
  const row = db.prepare('SELECT * FROM strategies WHERE strategy_id = ?').get(strategyId) as StrategyRow | undefined;
  return row ? strategyFromRow(db, row) : undefined;
}

function strategyFromRow(db: any, row: StrategyRow): StrategyRecord {
  const legs = db.prepare(`
    SELECT
      uic,
      asset_type AS assetType,
      buy_sell AS buySell,
      amount,
      expiry,
      put_call AS putCall,
      strike,
      contract_size AS contractSize,
      settlement_style AS settlementStyle,
      exercise_style AS exerciseStyle,
      metadata_json AS metadata
    FROM strategy_legs WHERE strategy_id = ? ORDER BY leg_index
  `).all(row.strategy_id) as StrategyLegInput[];
  for (const leg of legs) {
    if (typeof leg.metadata === 'string') {
      leg.metadata = parseJson(leg.metadata) as Record<string, unknown> | undefined;
    }
  }
  return {
    strategyId: row.strategy_id,
    accountKey: row.account_key,
    name: row.name,
    thesisName: row.thesis_name,
    symbol: row.symbol,
    strategy: row.strategy,
    status: row.status,
    horizon: row.horizon,
    conviction: row.conviction,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    rules: parseJson(row.rules_json),
    notes: row.notes,
    legs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function importStructuredArtifact(db: any, parsed: unknown, classification: string, path: string): void {
  if (!isRecord(parsed)) {
    return;
  }
  if (classification === 'account_status') {
    recordAccountSnapshotInDb(db, parsed as AccountSnapshotLedgerInput['report']);
    return;
  }
  const strategies = Array.isArray(parsed.strategyPositions) ? parsed.strategyPositions : undefined;
  if (strategies) {
    for (const [index, strategy] of strategies.entries()) {
      if (!isRecord(strategy) || typeof strategy.name !== 'string') {
        continue;
      }
      const strategyId = stableStrategyId(parsed, strategy, path, index);
      upsertImportedStrategy(db, parsed, strategy, strategyId);
    }
  }
}

function recordAccountSnapshotInDb(db: any, report: AccountSnapshotLedgerInput['report']): void {
  const snapshotId = randomUUID();
  const balance = report.balance ?? {};
  run(db.prepare(`
    INSERT INTO account_snapshots (
      snapshot_id, generated_at, trading_date, environment, account_key, account_id, currency,
      total_value, cash_available_for_trading, cash_balance, option_premiums_market_value,
      unrealized_positions_value, margin_utilization_pct, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
    snapshotId,
    report.generatedAt,
    report.tradingDate,
    report.environment,
    report.account?.accountKey,
    report.account?.accountId,
    report.account?.currency,
    numberField(balance, 'totalValue'),
    numberField(balance, 'cashAvailableForTrading'),
    numberField(balance, 'cashBalance'),
    numberField(balance, 'optionPremiumsMarketValue'),
    numberField(balance, 'unrealizedPositionsValue'),
    numberField(balance, 'marginUtilizationPct'),
    stringify(report),
  );
}

function upsertImportedStrategy(
  db: any,
  root: Record<string, unknown>,
  strategy: Record<string, unknown>,
  strategyId: string,
): void {
  const now = new Date().toISOString();
  run(db.prepare(`
    INSERT INTO strategies (
      strategy_id, account_key, name, thesis_name, symbol, strategy, status,
      opened_at, rules_json, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(strategy_id) DO UPDATE SET
      account_key=excluded.account_key,
      name=excluded.name,
      thesis_name=excluded.thesis_name,
      symbol=excluded.symbol,
      strategy=excluded.strategy,
      status=excluded.status,
      opened_at=excluded.opened_at,
      rules_json=excluded.rules_json,
      raw_json=excluded.raw_json,
      updated_at=excluded.updated_at
  `),
    strategyId,
    stringField(root, 'accountKey'),
    stringField(strategy, 'name') ?? strategyId,
    stringField(strategy, 'thesisName'),
    stringField(strategy, 'symbol'),
    stringField(strategy, 'strategy'),
    'open',
    stringField(strategy, 'openedAt'),
    stringify(strategy.rules),
    stringify(strategy),
    now,
    now,
  );
  run(db.prepare('DELETE FROM strategy_legs WHERE strategy_id = ?'), strategyId);
  const legs = Array.isArray(strategy.legs) ? strategy.legs : [];
  for (const [index, leg] of legs.entries()) {
    if (!isRecord(leg)) {
      continue;
    }
    run(db.prepare(`
      INSERT INTO strategy_legs (
        strategy_id, leg_index, uic, asset_type, buy_sell, amount, expiry, put_call, strike,
        contract_size, settlement_style, exercise_style, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
      strategyId,
      index,
      numberField(leg, 'uic'),
      stringField(leg, 'assetType'),
      stringField(leg, 'buySell'),
      numberField(leg, 'amount'),
      stringField(leg, 'expiry'),
      stringField(leg, 'putCall'),
      numberField(leg, 'strike'),
      numberField(leg, 'contractSize'),
      stringField(leg, 'settlementStyle'),
      stringField(leg, 'exerciseStyle'),
      stringify(isRecord(leg.metadata) ? leg.metadata : undefined),
    );
  }
}

function classifyArtifact(path: string, parsed: unknown): string {
  const lower = path.toLowerCase();
  if (isRecord(parsed) && parsed.balance && parsed.positionSummary && parsed.tradingDate) {
    return 'account_status';
  }
  if (isRecord(parsed) && Array.isArray(parsed.strategyPositions)) {
    return 'strategy_snapshot';
  }
  if (lower.includes('review')) {
    return 'strategy_review';
  }
  if (lower.includes('precheck')) {
    return 'order_precheck';
  }
  if (lower.includes('order') || lower.includes('place')) {
    return 'order_artifact';
  }
  if (lower.includes('screen') || lower.includes('plan')) {
    return 'research_artifact';
  }
  return 'unknown_json';
}

function defaultImportGlobs(): string[] {
  return [
    'live-options-actual-strategy*.json',
    'live-options-review*.json',
    'live-options-*order*.json',
    'account-status/account-status*.json',
  ];
}

function expandImportPaths(patterns: string[], cwd: string): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    const absolute = resolve(cwd, pattern);
    if (!pattern.includes('*')) {
      if (existsSync(absolute) && statSync(absolute).isFile()) {
        found.add(absolute);
      }
      continue;
    }
    const slash = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'));
    const dir = slash >= 0 ? absolute.slice(0, slash) : cwd;
    const basename = slash >= 0 ? absolute.slice(slash + 1) : absolute;
    const regex = globToRegex(basename);
    if (!existsSync(dir)) {
      continue;
    }
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (regex.test(entry) && statSync(path).isFile()) {
        found.add(path);
      }
    }
  }
  return [...found].sort();
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function stableStrategyId(root: Record<string, unknown>, strategy: Record<string, unknown>, path: string, index: number): string {
  const parts = [
    stringField(root, 'accountKey'),
    stringField(strategy, 'name'),
    stringField(strategy, 'symbol'),
    stringField(strategy, 'openedAt'),
    path,
    String(index),
  ].filter(Boolean).join('|');
  return createHash('sha1').update(parts).digest('hex');
}

function extractOrderLegs(request: Record<string, unknown>): Array<{
  uic?: number;
  assetType?: string;
  buySell?: string;
  amount?: number;
  toOpenClose?: string;
}> {
  if (Array.isArray(request.Legs)) {
    return request.Legs.filter(isRecord).map(leg => ({
      uic: numberField(leg, 'Uic'),
      assetType: stringField(leg, 'AssetType'),
      buySell: stringField(leg, 'BuySell'),
      amount: numberField(leg, 'Amount'),
      toOpenClose: stringField(leg, 'ToOpenClose'),
    }));
  }
  return [{
    uic: numberField(request, 'Uic'),
    assetType: stringField(request, 'AssetType'),
    buySell: stringField(request, 'BuySell'),
    amount: numberField(request, 'Amount'),
    toOpenClose: stringField(request, 'ToOpenClose'),
  }];
}

function count(db: any, sql: string, params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count?: number } | undefined;
  return typeof row?.count === 'number' ? row.count : 0;
}

function run(statement: { run: (...values: unknown[]) => unknown }, ...values: unknown[]): void {
  statement.run(...values.map(value => value === undefined ? null : value));
}

function stringify(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function parseJson(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const raw = value[field];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
