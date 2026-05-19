import { getEnvironmentEndpoints, type SaxoEnvironment } from './environment.js';

export interface SaxoTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

// Build the token-endpoint POST body + headers. Supports both confidential
// clients (Saxo "Code" grant — sends HTTP Basic Auth with the app secret)
// and public clients (Saxo "PKCE" grant — sends client_id in the body, no
// Authorization header, per RFC 6749 §2.3.1).
function buildTokenRequest(
  base: URLSearchParams,
  appKey: string,
  appSecret: string | undefined,
): { headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (appSecret) {
    const credentials = Buffer.from(`${appKey}:${appSecret}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  } else {
    base.set('client_id', appKey);
  }
  return { headers, body: base.toString() };
}

export interface RefreshAccessTokenInput {
  refreshToken: string;
  appKey: string;
  /**
   * App secret. Required for "Code" grant apps (confidential client).
   * Omit for "PKCE" grant apps (public client) — the refresh request
   * authenticates by including client_id in the body instead.
   */
  appSecret?: string;
  environment: SaxoEnvironment;
  fetchImpl?: typeof fetch;
}

export async function refreshAccessToken(input: RefreshAccessTokenInput): Promise<SaxoTokenSet> {
  const endpoints = getEnvironmentEndpoints(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
  const { headers, body } = buildTokenRequest(params, input.appKey, input.appSecret);

  const response = await fetchImpl(endpoints.token, { method: 'POST', headers, body });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Saxo token refresh failed with HTTP ${response.status}: ${text || 'no body'}`);
  }

  const data = parseJson(text);
  const accessToken = stringField(data, 'access_token');
  if (!accessToken) {
    throw new Error('Saxo token endpoint did not return access_token.');
  }

  const expiresIn = numberField(data, 'expires_in');
  return {
    accessToken,
    refreshToken: stringField(data, 'refresh_token') ?? input.refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

export interface ExchangeCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  appKey: string;
  /**
   * App secret. Required for "Code" grant, omitted for "PKCE" grant.
   * See RefreshAccessTokenInput.appSecret.
   */
  appSecret?: string;
  environment: SaxoEnvironment;
  fetchImpl?: typeof fetch;
}

export async function exchangeCodeForTokens(input: ExchangeCodeInput): Promise<SaxoTokenSet> {
  const endpoints = getEnvironmentEndpoints(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const { headers, body } = buildTokenRequest(params, input.appKey, input.appSecret);

  const response = await fetchImpl(endpoints.token, { method: 'POST', headers, body });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Saxo token exchange failed with HTTP ${response.status}: ${text || 'no body'}`);
  }

  const data = parseJson(text);
  const accessToken = stringField(data, 'access_token');
  if (!accessToken) {
    throw new Error('Saxo token endpoint did not return access_token.');
  }

  const expiresIn = numberField(data, 'expires_in');
  return {
    accessToken,
    refreshToken: stringField(data, 'refresh_token'),
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Saxo token endpoint returned non-JSON body: ${text}`);
  }
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
