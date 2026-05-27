import type { SaxoClient } from './client.js';
import { readBoolEnv, readEnv } from './env.js';
import { getEnvironmentEndpoints } from './environment.js';
import WebSocket from 'ws';

export interface SaxoSessionInfo {
  ClientKey?: string;
  UserKey?: string;
  UserId?: string;
  Name?: string;
  Culture?: string;
  Language?: string;
  MarketDataViaOpenApiTermsAccepted?: boolean;
  LegalAssetTypes?: string[];
  LastLoginTime?: string;
  LastLoginStatus?: string;
  Active?: boolean;
  [key: string]: unknown;
}

export interface SaxoFeatureAvailability {
  Feature: 'News' | 'GainersLosers' | 'Calendar' | 'Chart' | string;
  Available: boolean;
  [key: string]: unknown;
}

export function getSessionMe(client: SaxoClient): Promise<SaxoSessionInfo> {
  return client.get<SaxoSessionInfo>('/port/v1/users/me');
}

export interface SaxoSessionCapabilities {
  AuthenticationLevel?: string;
  DataLevel?: string;
  TradeLevel?: string;
  [key: string]: unknown;
}

export type SaxoTradeLevel = 'OrdersOnly' | 'FullTradingAndChat';

export interface SessionCapabilitiesResult {
  capabilities: SaxoSessionCapabilities;
  lastKnown: LastKnownSessionCapabilities;
}

export interface SetSessionTradeLevelResult extends SessionCapabilitiesResult {
  requestedTradeLevel: SaxoTradeLevel;
  confirmed: true;
  warnings: string[];
}

export interface LastKnownSessionCapabilities {
  capabilities?: SaxoSessionCapabilities;
  source?: 'rest' | 'subscription_snapshot' | 'stream';
  updatedAt?: string;
  monitor: SessionCapabilityMonitorStatus;
}

export interface SessionCapabilityMonitorStatus {
  status: 'not_started' | 'starting' | 'connecting' | 'connected' | 'closed' | 'error';
  contextId?: string;
  referenceId?: string;
  lastEventAt?: string;
  lastError?: string;
}

export async function getSessionCapabilities(client: SaxoClient): Promise<SaxoSessionCapabilities> {
  const capabilities = await client.get<SaxoSessionCapabilities>('/root/v1/sessions/capabilities');
  getSessionCapabilityMonitor(client).recordCapabilities(capabilities, 'rest');
  return capabilities;
}

export async function getSessionCapabilitiesTool(client: SaxoClient): Promise<SessionCapabilitiesResult> {
  const capabilities = await getSessionCapabilities(client);
  try {
    await ensureSessionCapabilityMonitor(client);
  } catch {
    // The direct capabilities read remains useful even if the streaming
    // monitor cannot be established in this process.
  }
  return {
    capabilities,
    lastKnown: getLastKnownSessionCapabilities(client),
  };
}

export async function setSessionTradeLevel(
  client: SaxoClient,
  tradeLevel: SaxoTradeLevel,
  options: { confirmTimeoutMs?: number } = {},
): Promise<SetSessionTradeLevelResult> {
  const warnings: string[] = [];
  try {
    await ensureSessionCapabilityMonitor(client);
  } catch (error) {
    warnings.push(`Session capability event monitor could not be started: ${(error as Error).message}`);
  }

  await client.patch<null>('/root/v1/sessions/capabilities', { TradeLevel: tradeLevel });

  const timeoutMs = options.confirmTimeoutMs ?? 10_000;
  const startedAt = Date.now();
  let delayMs = 250;
  let latest: SaxoSessionCapabilities | undefined;
  while (Date.now() - startedAt <= timeoutMs) {
    latest = await getSessionCapabilities(client);
    if (latest.TradeLevel === tradeLevel) {
      return {
        requestedTradeLevel: tradeLevel,
        confirmed: true,
        capabilities: latest,
        lastKnown: getLastKnownSessionCapabilities(client),
        warnings,
      };
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 1_000);
  }

  throw new Error(
    `Saxo session TradeLevel=${tradeLevel} was not confirmed within ${timeoutMs}ms. ` +
      `Current TradeLevel=${latest?.TradeLevel ?? 'unknown'}.`,
  );
}

export interface SaxoDiagnostics {
  environment: string;
  baseUrl: string;
  liveTradingEnabled: boolean;
  policyPath?: string;
  auditLogPath?: string;
  session: {
    name?: string;
    userId?: string;
    clientKey?: string;
    userKey?: string;
    active?: boolean;
    marketDataViaOpenApiTermsAccepted?: boolean;
  };
  capabilities: {
    authenticationLevel?: string;
    dataLevel?: string;
    tradeLevel?: string;
    source?: string;
    lastUpdatedAt?: string;
    realtimeMarketDataExpected: boolean;
    monitor: SessionCapabilityMonitorStatus;
  };
  token: {
    decodedFromJwt: boolean;
    expiresAt?: string;
    expiresInSeconds?: number;
    issuer?: string;
    refreshAvailable: boolean;
  };
  warnings: string[];
}

export async function getDiagnostics(client: SaxoClient): Promise<SaxoDiagnostics> {
  const warnings: string[] = [];

  let session: SaxoSessionInfo | undefined;
  try {
    session = await getSessionMe(client);
  } catch (error) {
    warnings.push(`Failed to fetch /port/v1/users/me: ${(error as Error).message}`);
  }

  let capabilities: SaxoSessionCapabilities | undefined;
  try {
    capabilities = await getSessionCapabilities(client);
  } catch (error) {
    warnings.push(`Failed to fetch /root/v1/sessions/capabilities: ${(error as Error).message}`);
  }

  const tokenInfo = inspectAccessToken(client.getAccessToken());

  if (session?.MarketDataViaOpenApiTermsAccepted === false) {
    warnings.push(
      'MarketDataViaOpenApiTermsAccepted=false: live bid/ask quotes via /trade/v1/infoprices will return PriceType*=NoAccess. Accept the per-exchange OpenAPI market-data terms in the Saxo platform (this is a separate consent from the 24h token terms).',
    );
  }

  try {
    await ensureSessionCapabilityMonitor(client);
  } catch {
    // A REST capabilities snapshot still lets diagnostics report the current
    // state; the monitor status below carries the streaming failure details.
  }
  const lastKnown = getLastKnownSessionCapabilities(client);
  const effectiveCapabilities = lastKnown.capabilities ?? capabilities;

  if (effectiveCapabilities?.TradeLevel !== 'FullTradingAndChat') {
    warnings.push(
      `TradeLevel=${effectiveCapabilities?.TradeLevel ?? 'unknown'} (not FullTradingAndChat). ` +
        'Saxo will only deliver delayed market data to third-party OpenAPI sessions at OrdersOnly. ' +
        'Use saxo_set_session_trade_level with tradeLevel=FullTradingAndChat when real-time subscriptions should be used.',
    );
  }

  if (lastKnown.monitor.status === 'error') {
    warnings.push(
      `Session capability event monitor is not active: ${lastKnown.monitor.lastError ?? 'unknown error'}. ` +
        'Silent TradeLevel downgrades may not be detected until the next REST capabilities check.',
    );
  }

  if (tokenInfo.expiresInSeconds !== undefined && tokenInfo.expiresInSeconds < 600) {
    warnings.push(
      `Access token expires in ${tokenInfo.expiresInSeconds}s. Refresh soon or generate a new token.`,
    );
  }

  if (client.isLive()) {
    const liveEnabled = readBoolEnv('SAXO_ENABLE_LIVE_TRADING', false);
    if (!liveEnabled) {
      warnings.push('Environment=live but SAXO_ENABLE_LIVE_TRADING=false — order write tools will be denied.');
    }
  }

  return {
    environment: client.environment,
    baseUrl: client.baseUrl,
    liveTradingEnabled: readBoolEnv('SAXO_ENABLE_LIVE_TRADING', false),
    policyPath: readEnv('SAXO_POLICY_PATH'),
    auditLogPath: readEnv('SAXO_AUDIT_LOG'),
    session: {
      name: session?.Name,
      userId: session?.UserId,
      clientKey: session?.ClientKey,
      userKey: session?.UserKey,
      active: session?.Active,
      marketDataViaOpenApiTermsAccepted: session?.MarketDataViaOpenApiTermsAccepted,
    },
    capabilities: {
      authenticationLevel: effectiveCapabilities?.AuthenticationLevel,
      dataLevel: effectiveCapabilities?.DataLevel,
      tradeLevel: effectiveCapabilities?.TradeLevel,
      source: lastKnown.source,
      lastUpdatedAt: lastKnown.updatedAt,
      realtimeMarketDataExpected: effectiveCapabilities?.TradeLevel === 'FullTradingAndChat',
      monitor: lastKnown.monitor,
    },
    token: {
      decodedFromJwt: tokenInfo.decoded,
      expiresAt: tokenInfo.expiresAt,
      expiresInSeconds: tokenInfo.expiresInSeconds,
      issuer: tokenInfo.issuer,
      refreshAvailable: client.hasRefreshCredentials(),
    },
    warnings,
  };
}

interface TokenInfo {
  decoded: boolean;
  expiresAt?: string;
  expiresInSeconds?: number;
  issuer?: string;
}

export function inspectAccessToken(token: string | undefined): TokenInfo {
  if (!token) {
    return { decoded: false };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { decoded: false };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as Record<string, unknown>;

    const expRaw = payload.exp;
    let exp: number | undefined;
    if (typeof expRaw === 'number') {
      exp = expRaw;
    } else if (typeof expRaw === 'string') {
      const parsed = Number.parseInt(expRaw, 10);
      if (Number.isFinite(parsed)) {
        exp = parsed;
      }
    }

    const issuer = typeof payload.iss === 'string' ? payload.iss : undefined;

    if (exp === undefined) {
      return { decoded: true, issuer };
    }

    const expiresAtMs = exp * 1000;
    return {
      decoded: true,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInSeconds: Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
      issuer,
    };
  } catch {
    return { decoded: false };
  }
}

export function getFeatureAvailability(client: SaxoClient): Promise<SaxoFeatureAvailability[]> {
  return client.get<SaxoFeatureAvailability[]>('/root/v1/features/availability');
}

interface SessionEventSubscriptionResponse {
  ContextId?: string;
  ReferenceId?: string;
  Snapshot?: SaxoSessionCapabilities;
  [key: string]: unknown;
}

interface SaxoStreamMessage {
  referenceId: string;
  payloadFormat: number;
  payload: unknown;
}

class SessionCapabilityMonitor {
  private readonly referenceId = 'session-capabilities';
  private contextId?: string;
  private socket?: WebSocket;
  private startPromise?: Promise<void>;
  private capabilities?: SaxoSessionCapabilities;
  private source?: LastKnownSessionCapabilities['source'];
  private updatedAt?: string;
  private status: SessionCapabilityMonitorStatus['status'] = 'not_started';
  private lastError?: string;
  private lastEventAt?: string;

  constructor(private readonly client: SaxoClient) {}

  async ensureStarted(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting' || this.status === 'starting') {
      return this.startPromise;
    }

    this.startPromise = this.start();
    return this.startPromise;
  }

  recordCapabilities(
    capabilities: SaxoSessionCapabilities,
    source: NonNullable<LastKnownSessionCapabilities['source']>,
  ): void {
    this.capabilities = { ...this.capabilities, ...capabilities };
    this.source = source;
    this.updatedAt = new Date().toISOString();
  }

  snapshot(): LastKnownSessionCapabilities {
    return {
      capabilities: this.capabilities,
      source: this.source,
      updatedAt: this.updatedAt,
      monitor: {
        status: this.status,
        contextId: this.contextId,
        referenceId: this.referenceId,
        lastEventAt: this.lastEventAt,
        lastError: this.lastError,
      },
    };
  }

  private async start(): Promise<void> {
    this.status = 'starting';
    this.lastError = undefined;
    this.contextId = createContextId();

    try {
      const response = await this.client.post<SessionEventSubscriptionResponse>(
        '/root/v1/sessions/events/subscriptions/active',
        {
          ContextId: this.contextId,
          ReferenceId: this.referenceId,
          RefreshRate: 1000,
        },
      );

      if (response.Snapshot) {
        this.recordCapabilities(response.Snapshot, 'subscription_snapshot');
      }

      this.connectWebSocket();
    } catch (error) {
      this.status = 'error';
      this.lastError = (error as Error).message;
      throw error;
    }
  }

  private connectWebSocket(): void {
    const token = this.client.getAccessToken();
    if (!token || !this.contextId) {
      this.status = 'error';
      this.lastError = 'Missing access token or streaming context id.';
      return;
    }

    const url = new URL(`${getEnvironmentEndpoints(this.client.environment).streamingWs}/connect`);
    url.searchParams.set('contextId', this.contextId);

    this.status = 'connecting';
    const socket = new WebSocket(url, {
      headers: { Authorization: `BEARER ${token}` },
    });
    this.socket = socket;

    socket.on('open', () => {
      this.status = 'connected';
      this.lastError = undefined;
      (socket as unknown as { _socket?: { unref?: () => void } })._socket?.unref?.();
    });

    socket.on('message', data => {
      try {
        for (const message of parseSaxoStreamMessages(toBuffer(data))) {
          this.handleStreamMessage(message);
        }
      } catch (error) {
        this.lastError = `Failed to parse Saxo stream message: ${(error as Error).message}`;
      }
    });

    socket.on('close', () => {
      if (this.status !== 'error') {
        this.status = 'closed';
      }
    });

    socket.on('error', error => {
      this.status = 'error';
      this.lastError = error.message;
    });
  }

  private handleStreamMessage(message: SaxoStreamMessage): void {
    if (message.referenceId !== this.referenceId || message.payloadFormat !== 0) {
      return;
    }

    const updates = Array.isArray(message.payload) ? message.payload : [message.payload];
    for (const update of updates) {
      if (typeof update !== 'object' || update === null) {
        continue;
      }
      const record = update as { Data?: SaxoSessionCapabilities };
      if (record.Data) {
        this.recordCapabilities(record.Data, 'stream');
        this.lastEventAt = new Date().toISOString();
      }
    }
  }
}

const monitors = new WeakMap<SaxoClient, SessionCapabilityMonitor>();

function getSessionCapabilityMonitor(client: SaxoClient): SessionCapabilityMonitor {
  let monitor = monitors.get(client);
  if (!monitor) {
    monitor = new SessionCapabilityMonitor(client);
    monitors.set(client, monitor);
  }
  return monitor;
}

export function getLastKnownSessionCapabilities(client: SaxoClient): LastKnownSessionCapabilities {
  return getSessionCapabilityMonitor(client).snapshot();
}

export function ensureSessionCapabilityMonitor(client: SaxoClient): Promise<void> {
  return getSessionCapabilityMonitor(client).ensureStarted();
}

export function parseSaxoStreamMessages(buffer: Buffer): SaxoStreamMessage[] {
  const messages: SaxoStreamMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 16) {
      throw new Error('message header is incomplete');
    }

    offset += 8; // message id
    offset += 2; // reserved
    const referenceIdSize = buffer.readUInt8(offset);
    offset += 1;

    if (buffer.length - offset < referenceIdSize + 5) {
      throw new Error('message reference id or payload header is incomplete');
    }

    const referenceId = buffer.toString('ascii', offset, offset + referenceIdSize);
    offset += referenceIdSize;
    const payloadFormat = buffer.readUInt8(offset);
    offset += 1;
    const payloadSize = buffer.readUInt32LE(offset);
    offset += 4;

    if (buffer.length - offset < payloadSize) {
      throw new Error('message payload is incomplete');
    }

    const payloadBuffer = buffer.subarray(offset, offset + payloadSize);
    offset += payloadSize;

    let payload: unknown = payloadBuffer;
    if (payloadFormat === 0) {
      const text = payloadBuffer.toString('utf8');
      payload = text ? JSON.parse(text) as unknown : null;
    }

    messages.push({ referenceId, payloadFormat, payload });
  }

  return messages;
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function createContextId(): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `mcp-saxo-${Date.now().toString(36)}-${suffix}`.slice(0, 50);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
