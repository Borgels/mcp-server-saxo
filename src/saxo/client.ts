import { SaxoHttpError } from '../errors.js';
import { refreshAccessToken, type SaxoTokenSet } from './auth.js';
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
  private refreshToken?: string;
  private readonly appKey?: string;
  private readonly appSecret?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: SaxoClientOptions = {}) {
    this.environment = resolveEnvironment(
      options.environment !== undefined ? String(options.environment) : process.env.SAXO_ENVIRONMENT,
    );
    const endpoints = getEnvironmentEndpoints(this.environment);

    this.accessToken = options.accessToken ?? process.env.SAXO_ACCESS_TOKEN ?? undefined;
    this.refreshToken = options.refreshToken ?? process.env.SAXO_REFRESH_TOKEN ?? undefined;
    this.appKey = options.appKey ?? process.env.SAXO_APP_KEY ?? undefined;
    this.appSecret = options.appSecret ?? process.env.SAXO_APP_SECRET ?? undefined;

    this.baseUrl = trimTrailingSlash(
      options.baseUrl ?? process.env.SAXO_BASE_URL ?? endpoints.apiBase,
    );
    assertSafeBaseUrl(this.baseUrl);

    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.SAXO_TIMEOUT_MS ?? 30_000);
  }

  isLive(): boolean {
    return this.environment === 'live';
  }

  hasRefreshCredentials(): boolean {
    return Boolean(this.refreshToken && this.appKey && this.appSecret);
  }

  setTokens(tokens: SaxoTokenSet): void {
    this.accessToken = tokens.accessToken;
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken;
    }
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
    if (!this.refreshToken || !this.appKey || !this.appSecret) {
      throw new Error('Cannot refresh Saxo token: missing refresh token or app credentials.');
    }

    const tokens = await refreshAccessToken({
      refreshToken: this.refreshToken,
      appKey: this.appKey,
      appSecret: this.appSecret,
      environment: this.environment,
      fetchImpl: this.fetchImpl,
    });

    this.setTokens(tokens);
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
