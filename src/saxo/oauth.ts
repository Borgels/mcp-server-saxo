import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { exchangeCodeForTokens, type SaxoTokenSet } from './auth.js';
import { readEnv } from './env.js';
import {
  getEnvironmentEndpoints,
  resolveEnvironment,
  type SaxoEnvironment,
} from './environment.js';

export interface OauthFlowConfig {
  environment: SaxoEnvironment;
  appKey: string;
  /** Required for Saxo "Code" grant apps; omitted for "PKCE" grant apps. */
  appSecret?: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

export interface PendingOauthFlow {
  ticketId: string;
  authorizeUrl: string;
  redirectUri: string;
  environment: SaxoEnvironment;
  appKey: string;
  appSecret?: string;
  verifier: string;
  expectedState: string;
  createdAt: number;
  fetchImpl?: typeof fetch;
  codePromise: Promise<string>;
  resolveCode: (code: string) => void;
  rejectCode: (error: Error) => void;
  server: Server;
}

const flows = new Map<string, PendingOauthFlow>();

export function loadOauthConfigFromEnv(environment?: SaxoEnvironment | string): OauthFlowConfig {
  const env = resolveEnvironment(environment !== undefined ? String(environment) : readEnv('SAXO_ENVIRONMENT'));
  const appKey = readEnv('SAXO_APP_KEY');
  const appSecret = readEnv('SAXO_APP_SECRET');
  if (!appKey) {
    throw new Error('OAuth requires SAXO_APP_KEY in the MCP server environment.');
  }
  // SAXO_APP_SECRET is optional: confidential ("Code" grant) apps have
  // one; public ("PKCE" grant) apps don't. The flow detects the
  // difference and adjusts the token request accordingly.
  // Saxo's authorize endpoint rejects IP-literal redirects with
  // "Invalid value of redirect_uri parameter. It must be an absolute uri",
  // so the default uses the localhost hostname. The registered URL in the
  // Saxo app config must match exactly.
  const redirectUri = readEnv('SAXO_REDIRECT_URI') ?? 'http://localhost:8765/callback';
  return { environment: env, appKey, appSecret, redirectUri };
}

export function startOauthFlow(config: OauthFlowConfig): {
  ticketId: string;
  authorizeUrl: string;
  redirectUri: string;
  environment: SaxoEnvironment;
} {
  const redirect = new URL(config.redirectUri);
  if (!isLoopback(redirect.hostname)) {
    throw new Error(
      `SAXO_REDIRECT_URI must point to loopback (127.0.0.1/localhost). Got ${redirect.hostname}.`,
    );
  }

  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  const state = base64UrlEncode(randomBytes(16));
  const ticketId = randomUUID();

  const endpoints = getEnvironmentEndpoints(config.environment);
  const authorize = new URL(endpoints.authorize);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', config.appKey);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', state);

  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolveFn, rejectFn) => {
    resolveCode = resolveFn;
    rejectCode = rejectFn;
  });

  const server = createServer((req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', `http://${redirect.hostname}:${redirect.port || 80}`);
      if (requestUrl.pathname !== redirect.pathname) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const callbackState = requestUrl.searchParams.get('state');
      const error = requestUrl.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Saxo returned error: ${error}`);
        rejectCode(new Error(`Saxo authorize error: ${error}`));
        return;
      }

      if (!code || callbackState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing code or state mismatch');
        rejectCode(new Error('Missing authorization code or state mismatch.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body><h2>Saxo authorization complete.</h2><p>Return to the MCP client and call saxo_oauth_complete.</p></body></html>',
      );
      resolveCode(code);
    } catch (err) {
      rejectCode(err as Error);
    }
  });

  const port = Number(redirect.port || '80');
  server.listen(port, redirect.hostname);
  server.on('error', err => rejectCode(err));

  const flow: PendingOauthFlow = {
    ticketId,
    authorizeUrl: authorize.toString(),
    redirectUri: config.redirectUri,
    environment: config.environment,
    appKey: config.appKey,
    appSecret: config.appSecret,
    verifier,
    expectedState: state,
    createdAt: Date.now(),
    fetchImpl: config.fetchImpl,
    codePromise,
    resolveCode,
    rejectCode,
    server,
  };

  flows.set(ticketId, flow);

  codePromise
    .catch(() => {
      // Swallow unhandled rejection — the awaiter in completeOauthFlow will
      // observe it. This handler exists so that cancellation does not produce
      // an unhandled rejection when no awaiter is attached yet.
    })
    .finally(() => {
      server.close();
    });

  return {
    ticketId,
    authorizeUrl: flow.authorizeUrl,
    redirectUri: flow.redirectUri,
    environment: flow.environment,
  };
}

export async function completeOauthFlow(
  ticketId: string,
  timeoutMs = 120_000,
): Promise<{ tokens: SaxoTokenSet; environment: SaxoEnvironment }> {
  const flow = flows.get(ticketId);
  if (!flow) {
    throw new Error(`Unknown OAuth ticketId ${ticketId}. Call saxo_oauth_start first.`);
  }

  try {
    const code = await Promise.race([
      flow.codePromise,
      new Promise<never>((_resolve, rejectPromise) =>
        setTimeout(() => rejectPromise(new Error('Timed out waiting for Saxo callback.')), timeoutMs),
      ),
    ]);

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: flow.verifier,
      redirectUri: flow.redirectUri,
      appKey: flow.appKey,
      appSecret: flow.appSecret,
      environment: flow.environment,
      fetchImpl: flow.fetchImpl,
    });

    return { tokens, environment: flow.environment };
  } finally {
    flows.delete(ticketId);
    flow.server.close();
  }
}

export function cancelOauthFlow(ticketId: string): boolean {
  const flow = flows.get(ticketId);
  if (!flow) {
    return false;
  }
  flow.rejectCode(new Error('OAuth flow cancelled.'));
  flow.server.close();
  flows.delete(ticketId);
  return true;
}

export function getPendingTicketIds(): string[] {
  return Array.from(flows.keys());
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}
