import { describe, expect, it, vi } from 'vitest';
import { SaxoClient } from '../src/saxo/client.js';
import {
  parseSaxoFrames,
  streamPrices,
  type MinimalWebSocket,
  type StreamPricesInput,
} from '../src/saxo/streaming.js';

describe('parseSaxoFrames', () => {
  it('parses multiple concatenated messages from one buffer', () => {
    const buffer = buildFrames([
      buildFrame('px_211', { Quote: { Bid: 1 } }, 10),
      buildFrame('_heartbeat', [{ Heartbeats: [] }], 11),
    ]);

    const messages = parseSaxoFrames(buffer);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ messageId: 10, referenceId: 'px_211' });
    expect(messages[0]?.payload).toEqual({ Quote: { Bid: 1 } });
    expect(messages[1]?.referenceId).toBe('_heartbeat');
  });

  it('stops cleanly on a truncated buffer instead of over-reading', () => {
    const full = new Uint8Array(buildFrames([buildFrame('px_1', { Quote: { Bid: 1 } })]));
    const truncated = full.slice(0, full.length - 3).buffer;
    expect(parseSaxoFrames(truncated)).toHaveLength(0);
  });
});

describe('streamPrices', () => {
  it('merges deltas onto the snapshot and stops at maxTicks, then deletes the subscription', async () => {
    const { client, fetchMock } = makeClient();
    const sockets: FakeWebSocket[] = [];

    const promise = streamPrices(
      client,
      { uic: 211, assetType: 'Stock', maxTicks: 2 },
      { webSocketImpl: makeWebSocketImpl(sockets) },
    );

    const ws = await waitForSocket(sockets);
    ws.emit(buildFrames([buildFrame('px-211', { Quote: { Bid: 1.5 } })]));
    ws.emit(buildFrames([buildFrame('px-211', { Quote: { Ask: 2.5 } })]));

    const result = await promise;

    expect(result.ticks).toHaveLength(2);
    expect(result.ticks[0]?.quote).toMatchObject({ Bid: 1.5, Ask: 2 });
    expect(result.finalQuote).toMatchObject({ Bid: 1.5, Ask: 2.5 });
    expect(deleteCalled(fetchMock)).toBe(true);
  });

  it('ignores foreign reference ids and records heartbeats without producing ticks', async () => {
    const { client } = makeClient();
    const sockets: FakeWebSocket[] = [];

    const promise = streamPrices(
      client,
      { uic: 211, assetType: 'Stock', maxTicks: 1 },
      { webSocketImpl: makeWebSocketImpl(sockets) },
    );

    const ws = await waitForSocket(sockets);
    ws.emit(buildFrames([buildFrame('_heartbeat', [{}])]));
    ws.emit(buildFrames([buildFrame('px-999', { Quote: { Bid: 9 } })])); // foreign refId
    ws.emit(buildFrames([buildFrame('px-211', { Quote: { Bid: 1.1 } })]));

    const result = await promise;

    expect(result.controlMessages).toContain('_heartbeat');
    expect(result.ticks).toHaveLength(1);
    expect(result.ticks[0]?.quote.Bid).toBe(1.1);
  });

  it('resolves early on _disconnect', async () => {
    const { client } = makeClient();
    const sockets: FakeWebSocket[] = [];

    const promise = streamPrices(
      client,
      { uic: 211, assetType: 'Stock' },
      { webSocketImpl: makeWebSocketImpl(sockets) },
    );

    const ws = await waitForSocket(sockets);
    ws.emit(buildFrames([buildFrame('_disconnect', {})]));

    const result = await promise;
    expect(result.controlMessages).toContain('_disconnect');
    expect(result.ticks).toHaveLength(0);
  });

  it('still tears down the subscription when the socket errors', async () => {
    const { client, fetchMock } = makeClient();
    const sockets: FakeWebSocket[] = [];

    const promise = streamPrices(
      client,
      { uic: 211, assetType: 'Stock' },
      { webSocketImpl: makeWebSocketImpl(sockets) },
    );

    const ws = await waitForSocket(sockets);
    ws.onerror?.(new Error('boom'));

    await promise;
    expect(deleteCalled(fetchMock)).toBe(true);
  });

  it('surfaces a NoAccess warning from the snapshot', async () => {
    const { client } = makeClient({
      Snapshot: { Quote: { PriceTypeBid: 'NoAccess', PriceTypeAsk: 'NoAccess' } },
    });
    const sockets: FakeWebSocket[] = [];

    const promise = streamPrices(
      client,
      { uic: 211, assetType: 'Stock' },
      { webSocketImpl: makeWebSocketImpl(sockets) },
    );

    const ws = await waitForSocket(sockets);
    ws.emit(buildFrames([buildFrame('_disconnect', {})]));

    const result = await promise;
    expect(result._warning).toMatch(/NoAccess/);
  });
});

// ---- helpers -------------------------------------------------------------

class FakeWebSocket implements MinimalWebSocket {
  binaryType = 'blob';
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {}

  emit(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }

  close(): void {
    this.closed = true;
  }
}

function makeWebSocketImpl(sink: FakeWebSocket[]): new (url: string) => FakeWebSocket {
  return class extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      sink.push(this);
    }
  };
}

async function waitForSocket(sockets: FakeWebSocket[]): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
  return sockets[0]!;
}

function makeClient(snapshot: unknown = { Snapshot: { Quote: { Bid: 1, Ask: 2 } } }): {
  client: SaxoClient;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
} {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      return jsonResponse(snapshot, 201);
    }
    return jsonResponse({}, 200);
  });
  const client = new SaxoClient({
    environment: 'sim',
    accessToken: 'tok',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

function deleteCalled(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): boolean {
  return fetchMock.mock.calls.some(([, init]) => (init?.method ?? 'GET') === 'DELETE');
}

function buildFrame(refId: string, payload: unknown, messageId = 1): Uint8Array {
  const refBytes = new TextEncoder().encode(refId);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const total = 8 + 2 + 1 + refBytes.length + 1 + 4 + payloadBytes.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;
  view.setBigUint64(o, BigInt(messageId), true);
  o += 8;
  o += 2; // reserved
  view.setUint8(o, refBytes.length);
  o += 1;
  bytes.set(refBytes, o);
  o += refBytes.length;
  view.setUint8(o, 0); // JSON payload format
  o += 1;
  view.setUint32(o, payloadBytes.length, true);
  o += 4;
  bytes.set(payloadBytes, o);
  return bytes;
}

function buildFrames(frames: Uint8Array[]): ArrayBuffer {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out.buffer;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
