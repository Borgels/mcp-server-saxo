import { getEnvironmentEndpoints, type SaxoEnvironment } from './environment.js';

export interface SaxoTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface RefreshAccessTokenInput {
  refreshToken: string;
  appKey: string;
  appSecret: string;
  environment: SaxoEnvironment;
  fetchImpl?: typeof fetch;
}

export async function refreshAccessToken(input: RefreshAccessTokenInput): Promise<SaxoTokenSet> {
  const endpoints = getEnvironmentEndpoints(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });

  const credentials = Buffer.from(`${input.appKey}:${input.appSecret}`, 'utf8').toString('base64');

  const response = await fetchImpl(endpoints.token, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

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
  appSecret: string;
  environment: SaxoEnvironment;
  fetchImpl?: typeof fetch;
}

export async function exchangeCodeForTokens(input: ExchangeCodeInput): Promise<SaxoTokenSet> {
  const endpoints = getEnvironmentEndpoints(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });

  const credentials = Buffer.from(`${input.appKey}:${input.appSecret}`, 'utf8').toString('base64');

  const response = await fetchImpl(endpoints.token, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

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
