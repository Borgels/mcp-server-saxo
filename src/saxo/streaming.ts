import type { SaxoClient } from './client.js';
import { NO_ACCESS_WARNING, quoteHasNoAccess, type SaxoQuote } from './prices.js';

/**
 * Minimal structural type of the parts of WebSocket we use. Defined locally so
 * the module does not depend on the DOM lib (tsconfig only includes ES2022).
 * The default implementation is the global WebSocket shipped with Node >=20.11.
 */
export interface MinimalWebSocket {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(): void;
}

export type WebSocketCtor = new (url: string) => MinimalWebSocket;

export interface StreamPricesInput {
  uic: number;
  assetType: string;
  accountKey?: string;
  /** Collection window in seconds. Default 5, clamped to 1..30. */
  maxSeconds?: number;
  /** Stop after this many ticks. Default 50, clamped to 1..500. */
  maxTicks?: number;
  /** Requested update rate in milliseconds. Default 1000. */
  refreshRate?: number;
  /** Price field groups. Default ['Quote']. */
  fieldGroups?: string[];
}

export interface StreamPricesDeps {
  webSocketImpl?: WebSocketCtor;
}

export interface StreamTick {
  /** ISO-8601 timestamp the tick was received. */
  t: string;
  quote: SaxoQuote;
}

export interface StreamPricesResult {
  uic: number;
  assetType: string;
  contextId: string;
  referenceId: string;
  durationMs: number;
  /** Whether the streaming WebSocket actually connected. */
  connected: boolean;
  ticks: StreamTick[];
  finalQuote?: SaxoQuote;
  controlMessages: string[];
  _warning?: string;
}

export interface SaxoStreamMessage {
  messageId: number;
  referenceId: string;
  /** Parsed JSON payload (format 0). Undefined for unsupported (protobuf) frames. */
  payload: unknown;
}

interface PriceSubscriptionSnapshot {
  Snapshot?: { Quote?: SaxoQuote; [key: string]: unknown };
  [key: string]: unknown;
}

const utf8 = new TextDecoder('utf-8');

/**
 * Parse one binary streaming frame (which may contain several concatenated
 * messages) per the Saxo plain-WebSocket layout (little-endian):
 *   [0..7]   message id (uint64)
 *   [8..9]   reserved
 *   [10]     reference id length (Srefid)
 *   [11..]   reference id (ASCII, Srefid bytes)
 *   [+0]     payload format (0 = JSON UTF-8, 1 = protobuf)
 *   [+1..+4] payload size (uint32)
 *   [+5..]   payload
 * Bounds are checked so a truncated/over-long size never reads past the buffer.
 */
export function parseSaxoFrames(buffer: ArrayBuffer): SaxoStreamMessage[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const total = buffer.byteLength;
  const messages: SaxoStreamMessage[] = [];
  let offset = 0;

  while (offset + 11 <= total) {
    const messageId = Number(view.getBigUint64(offset, true));
    const refIdSize = view.getUint8(offset + 10);
    const refIdStart = offset + 11;
    const refIdEnd = refIdStart + refIdSize;
    // Need refId + 1 format byte + 4 size bytes.
    if (refIdEnd + 5 > total) {
      break;
    }
    const referenceId = utf8.decode(bytes.subarray(refIdStart, refIdEnd));
    const payloadFormat = view.getUint8(refIdEnd);
    const payloadSize = view.getUint32(refIdEnd + 1, true);
    const payloadStart = refIdEnd + 5;
    const payloadEnd = payloadStart + payloadSize;
    if (payloadEnd > total) {
      break;
    }

    let payload: unknown;
    if (payloadFormat === 0) {
      const text = utf8.decode(bytes.subarray(payloadStart, payloadEnd));
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = undefined;
      }
    }

    messages.push({ messageId, referenceId, payload });
    offset = payloadEnd;
  }

  return messages;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function extractQuoteDelta(payload: unknown): SaxoQuote | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const obj = payload as Record<string, unknown>;
  const quote = obj.Quote;
  if (quote && typeof quote === 'object') {
    return quote as SaxoQuote;
  }
  return obj as SaxoQuote;
}

function streamConnectUrl(client: SaxoClient, contextId: string): string {
  // https -> wss for the streaming host.
  const base = client.getStreamingBase().replace(/^http/, 'ws');
  const url = new URL(`${base}/streamingws/connect`);
  url.searchParams.set('contextId', contextId);
  const token = client.getAccessToken();
  if (token) {
    // Saxo accepts the token as a query param when custom headers are
    // unavailable (browser-style WebSocket). Never log this URL.
    url.searchParams.set('authorization', `BEARER ${token}`);
  }
  return url.toString();
}

/**
 * Open a short-lived Saxo price subscription, collect real-time tick updates
 * over the streaming WebSocket for a bounded window, then tear the
 * subscription down. Designed for request/response callers (e.g. an MCP tool):
 * it always resolves with the collected tape and never leaves a subscription
 * dangling.
 */
export async function streamPrices(
  client: SaxoClient,
  input: StreamPricesInput,
  deps: StreamPricesDeps = {},
): Promise<StreamPricesResult> {
  const maxSeconds = clamp(input.maxSeconds, 1, 30, 5);
  const maxTicks = clamp(input.maxTicks, 1, 500, 50);
  const refreshRate = clamp(input.refreshRate, 100, 60_000, 1000);
  const fieldGroups = input.fieldGroups?.length ? input.fieldGroups : ['Quote'];

  const WebSocketImpl =
    deps.webSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!WebSocketImpl) {
    throw new Error('Global WebSocket is unavailable; Node >=20.11 is required for streaming.');
  }

  // Saxo restricts ContextId to a-z, A-Z, 0-9 and '-' (no underscores).
  const contextId = `mcp-saxo-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const referenceId = `px-${input.uic}`;
  const ticks: StreamTick[] = [];
  const controlMessages: string[] = [];
  const warnings: string[] = [];
  let merged: SaxoQuote = {};
  let connected = false;
  const start = Date.now();
  let created = false;

  try {
    const subscription = await client.post<PriceSubscriptionSnapshot>(
      '/trade/v1/prices/subscriptions',
      {
        Arguments: {
          AccountKey: input.accountKey,
          AssetType: input.assetType,
          FieldGroups: fieldGroups,
          Uic: input.uic,
        },
        ContextId: contextId,
        Format: 'application/json',
        ReferenceId: referenceId,
        RefreshRate: refreshRate,
      },
    );
    created = true;

    const snapshotQuote = subscription.Snapshot?.Quote;
    if (snapshotQuote) {
      merged = { ...snapshotQuote };
    }
    if (quoteHasNoAccess(snapshotQuote)) {
      warnings.push(NO_ACCESS_WARNING);
    }

    await new Promise<void>(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ws = new WebSocketImpl(streamConnectUrl(client, contextId));
      ws.binaryType = 'arraybuffer';

      const settle = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        // Detach handlers so late events cannot mutate the result after we
        // have resolved and moved on to teardown.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // ignore close errors
        }
        resolve();
      };

      timer = setTimeout(settle, maxSeconds * 1000);

      ws.onopen = () => {
        connected = true;
      };

      ws.onmessage = (event: { data: unknown }) => {
        if (settled) {
          return;
        }
        connected = true;
        if (!(event.data instanceof ArrayBuffer)) {
          return;
        }
        for (const message of parseSaxoFrames(event.data)) {
          if (message.referenceId.startsWith('_')) {
            controlMessages.push(message.referenceId);
            if (message.referenceId === '_disconnect' || message.referenceId === '_resetsubscriptions') {
              settle();
              return;
            }
            continue; // _heartbeat and other control messages
          }
          if (message.referenceId !== referenceId) {
            continue;
          }
          const delta = extractQuoteDelta(message.payload);
          if (!delta) {
            continue;
          }
          merged = { ...merged, ...delta };
          ticks.push({ t: new Date().toISOString(), quote: structuredClone(merged) });
          if (ticks.length >= maxTicks) {
            settle();
            return;
          }
        }
      };

      ws.onerror = settle;
      ws.onclose = settle;
    });
  } finally {
    if (created) {
      try {
        await client.delete(
          `/trade/v1/prices/subscriptions/${encodeURIComponent(contextId)}/${encodeURIComponent(referenceId)}`,
        );
      } catch {
        // Best-effort cleanup. Saxo also expires inactive subscriptions.
      }
    }
  }

  if (!connected) {
    warnings.push(
      'Streaming WebSocket did not connect (the streaming host may be unreachable or blocked by network policy). Returned the subscription snapshot only.',
    );
  } else if (ticks.length === 0) {
    warnings.push(
      'Connected but received no tick updates within the window (market may be closed/quiet or the feed is delayed). Returned the subscription snapshot only.',
    );
  }

  return {
    uic: input.uic,
    assetType: input.assetType,
    contextId,
    referenceId,
    durationMs: Date.now() - start,
    connected,
    ticks,
    finalQuote: Object.keys(merged).length > 0 ? merged : undefined,
    controlMessages,
    _warning: warnings.length > 0 ? warnings.join(' | ') : undefined,
  };
}
