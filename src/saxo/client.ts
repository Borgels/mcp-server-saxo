import { SaxoHttpError } from '../errors.js';
import { refreshAccessToken, type SaxoTokenSet } from './auth.js';
import { readEnv, readNumberEnv } from './env.js';
import {
  getEnvironmentEndpoints,
  resolveEnvironment,
  type SaxoEnvironment,
} from './environment.js';

export type QueryValue = string | number | boolean | null | undefined;
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface SaxoClientOptions {
  accessToken?: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
  environment?: SaxoEnvironment | string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class SaxoClient {
  readonly environment: SaxoEnvironment;
  private accessToken?: string;
  private accessTokenExpiresAt?: number;
  private refreshToken?: string;
  private readonly appKey?: string;
  private readonly appSecret?: string;
  readonly baseUrl: string;
  private readonly streamingBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private static readonly REFRESH_LEAD_MS = 60_000;

  constructor(options: SaxoClientOptions = {}) {
    this.environment = resolveEnvironment(
      options.environment !== undefined ? String(options.environment) : readEnv('SAXO_ENVIRONMENT'),
    );
    const endpoints = getEnvironmentEndpoints(this.environment);

    this.accessToken = options.accessToken ?? readEnv('SAXO_ACCESS_TOKEN');
    this.refreshToken = options.refreshToken ?? readEnv('SAXO_REFRESH_TOKEN');
    this.appKey = options.appKey ?? readEnv('SAXO_APP_KEY');
    this.appSecret = options.appSecret ?? readEnv('SAXO_APP_SECRET');
    this.accessTokenExpiresAt = parseExpiry(readEnv('SAXO_TOKEN_EXPIRES_AT'));
    if (this.accessTokenExpiresAt === undefined && this.accessToken) {
      this.accessTokenExpiresAt = expiryFromJwt(this.accessToken);
    }

    this.baseUrl = trimTrailingSlash(
      options.baseUrl ?? readEnv('SAXO_BASE_URL') ?? endpoints.apiBase,
    );
    assertSafeBaseUrl(this.baseUrl);

    // Streaming uses a dedicated host and is derived from the environment, not
    // from baseUrl (which may be overridden to a local mock for tests).
    this.streamingBase = trimTrailingSlash(endpoints.streamingBase);

    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? readNumberEnv('SAXO_TIMEOUT_MS', 30_000);
  }

  isLive(): boolean {
    return this.environment === 'live';
  }

  hasRefreshCredentials(): boolean {
    // PKCE-grant apps refresh with refresh_token + client_id (no secret).
    // Code-grant apps refresh with refresh_token + client_id + secret.
    // Both modes require refresh_token + appKey.
    return Boolean(this.refreshToken && this.appKey);
  }

  setTokens(tokens: SaxoTokenSet): void {
    this.accessToken = tokens.accessToken;
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken;
    }
    if (tokens.expiresAt) {
      this.accessTokenExpiresAt = tokens.expiresAt;
    } else {
      this.accessTokenExpiresAt = expiryFromJwt(tokens.accessToken);
    }
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /** Base URL of the streaming host for the current environment (no trailing slash). */
  getStreamingBase(): string {
    return this.streamingBase;
  }

  getAccessTokenExpiresAt(): number | undefined {
    return this.accessTokenExpiresAt;
  }

  /**
   * Resolve the authenticated session's ClientKey, caching the result.
   * Many `/port/v1/*` endpoints require ClientKey as a query parameter
   * even when AccountKey is supplied, and most callers (LLMs especially)
   * don't think to pass it explicitly. Functions that depend on it
   * should call this when the caller's input.clientKey is missing.
   */
  private cachedClientKey?: string;
  async resolveClientKey(): Promise<string> {
    if (this.cachedClientKey) {
      return this.cachedClientKey;
    }
    const me = await this.get<{ ClientKey?: string }>('/port/v1/users/me');
    if (!me.ClientKey) {
      throw new Error('Saxo /port/v1/users/me did not return a ClientKey.');
    }
    this.cachedClientKey = me.ClientKey;
    return this.cachedClientKey;
  }

  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', path, query);
  }

  post<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('POST', path, query, body);
  }

  patch<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('PATCH', path, query, body);
  }

  put<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('PUT', path, query, body);
  }

  delete<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('DELETE', path, query);
  }

  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    query?: Record<string, QueryValue>,
    body?: unknown,
  ): Promise<T> {
    if (!this.accessToken) {
      throw new Error(
        'Missing SAXO_ACCESS_TOKEN. Set it in the MCP server environment or run `npm run auth`.',
      );
    }

    await this.maybeProactiveRefresh();

    const response = await this.send(method, path, query, body);

    if (response.status === 401 && this.hasRefreshCredentials()) {
      await this.refreshTokens();
      const retried = await this.send(method, path, query, body);
      return this.handleResponse<T>(retried, this.buildUrl(path, query));
    }

    return this.handleResponse<T>(response, this.buildUrl(path, query));
  }

  private async send(
    method: HttpMethod,
    path: string,
    query?: Record<string, QueryValue>,
    body?: unknown,
  ): Promise<Response> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
    };

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return this.fetchImpl(url, init);
  }

  private async handleResponse<T>(response: Response, url: string): Promise<T> {
    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      throw new SaxoHttpError({
        status: response.status,
        url,
        payload: responseBody,
        retryAfter: response.headers.get('retry-after') ?? undefined,
        fallbackMessage: typeof responseBody === 'string' ? responseBody : undefined,
      });
    }

    return responseBody as T;
  }

  private async refreshTokens(): Promise<void> {
    if (!this.refreshToken || !this.appKey) {
      throw new Error('Cannot refresh Saxo token: missing refresh token or app key.');
    }
    // appSecret is optional — only required for "Code" grant (confidential
    // client). "PKCE" grant apps refresh without a secret.

    const tokens = await refreshAccessToken({
      refreshToken: this.refreshToken,
      appKey: this.appKey,
      appSecret: this.appSecret,
      environment: this.environment,
      fetchImpl: this.fetchImpl,
    });

    this.setTokens(tokens);
  }

  private async maybeProactiveRefresh(): Promise<void> {
    if (!this.hasRefreshCredentials()) {
      return;
    }
    if (this.accessTokenExpiresAt === undefined) {
      return;
    }
    if (this.accessTokenExpiresAt - Date.now() > SaxoClient.REFRESH_LEAD_MS) {
      return;
    }
    try {
      await this.refreshTokens();
    } catch (error) {
      // Surface the underlying request 401 if proactive refresh fails; do not
      // swallow this because the upcoming request would just fail anyway.
      throw new Error(`Proactive Saxo token refresh failed: ${(error as Error).message}`);
    }
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function assertSafeBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`SAXO_BASE_URL is not a valid URL: ${baseUrl}`);
  }

  if (parsed.protocol === 'https:') {
    return;
  }

  if (parsed.protocol === 'http:' && isLocalHost(parsed.hostname)) {
    return;
  }

  throw new Error(
    `Refusing to send the Saxo access token over ${parsed.protocol}//. Use https:// (loopback http:// is allowed for local mocks).`,
  );
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parseExpiry(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function expiryFromJwt(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    const exp = payload.exp;
    if (typeof exp === 'number' && Number.isFinite(exp)) {
      return exp * 1000;
    }
    if (typeof exp === 'string') {
      const parsed = Number.parseInt(exp, 10);
      if (Number.isFinite(parsed)) {
        return parsed * 1000;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
