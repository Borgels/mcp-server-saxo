import type { SaxoClient } from './client.js';
import { readBoolEnv, readEnv } from './env.js';

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

export function getSessionCapabilities(client: SaxoClient): Promise<SaxoSessionCapabilities> {
  return client.get<SaxoSessionCapabilities>('/root/v1/sessions/capabilities');
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
  };
  token: {
    decodedFromJwt: boolean;
    expiresAt?: string;
    expiresInSeconds?: number;
    issuer?: string;
    refreshAvailable: boolean;
    refreshTokenExpiresAt?: string;
    refreshTokenExpiresInSeconds?: number;
    persistence: {
      tokenStoreConfigured: boolean;
      tokenStorePath?: string;
      persistTokensOnRefresh: boolean;
      tokenEnvFilePath?: string;
    };
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
  const refreshTokenExpiresAt = client.getRefreshTokenExpiresAt();
  const refreshTokenExpiresInSeconds = secondsUntil(refreshTokenExpiresAt);
  const tokenStorePath = readEnv('SAXO_TOKEN_STORE_PATH');
  const persistTokensOnRefresh = readBoolEnv('SAXO_PERSIST_TOKENS_ON_REFRESH', false);
  const tokenEnvFilePath = readEnv('SAXO_TOKEN_ENV_FILE_PATH');

  if (session?.MarketDataViaOpenApiTermsAccepted === false) {
    warnings.push(
      'MarketDataViaOpenApiTermsAccepted=false: live bid/ask quotes via /trade/v1/infoprices will return PriceType*=NoAccess. Accept the per-exchange OpenAPI market-data terms in the Saxo platform (this is a separate consent from the 24h token terms).',
    );
  }

  if (capabilities?.DataLevel && capabilities.DataLevel !== 'Realtime') {
    warnings.push(
      `DataLevel=${capabilities.DataLevel} (not Realtime). Quotes will be marked DelayedByMinutes — typically 15min on SIM. Acceptable for testing; not suitable for tight-spread execution.`,
    );
  }

  if (tokenInfo.expiresInSeconds !== undefined && tokenInfo.expiresInSeconds < 600) {
    warnings.push(
      `Access token expires in ${tokenInfo.expiresInSeconds}s. Refresh soon or generate a new token.`,
    );
  }

  if (!client.hasRefreshCredentials()) {
    warnings.push('No Saxo refresh credentials are configured; the access token cannot be extended automatically.');
  }

  if (refreshTokenExpiresInSeconds !== undefined && refreshTokenExpiresInSeconds < 7 * 24 * 60 * 60) {
    warnings.push(
      `Refresh token expires in ${refreshTokenExpiresInSeconds}s. Re-run Saxo OAuth before it expires.`,
    );
  }

  if (client.hasRefreshCredentials() && !tokenStorePath && !persistTokensOnRefresh) {
    warnings.push(
      'Token refresh is available, but refreshed tokens are not persisted. Configure SAXO_TOKEN_STORE_PATH or set SAXO_PERSIST_TOKENS_ON_REFRESH=true to survive MCP restarts.',
    );
  }

  if (client.isLive()) {
    const liveEnabled = readBoolEnv('SAXO_ENABLE_LIVE_TRADING', false);
    if (!liveEnabled) {
      warnings.push('Environment=live but SAXO_ENABLE_LIVE_TRADING=false — all write tools will be denied.');
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
      authenticationLevel: capabilities?.AuthenticationLevel,
      dataLevel: capabilities?.DataLevel,
      tradeLevel: capabilities?.TradeLevel,
    },
    token: {
      decodedFromJwt: tokenInfo.decoded,
      expiresAt: tokenInfo.expiresAt,
      expiresInSeconds: tokenInfo.expiresInSeconds,
      issuer: tokenInfo.issuer,
      refreshAvailable: client.hasRefreshCredentials(),
      refreshTokenExpiresAt: refreshTokenExpiresAt ? new Date(refreshTokenExpiresAt).toISOString() : undefined,
      refreshTokenExpiresInSeconds,
      persistence: {
        tokenStoreConfigured: Boolean(tokenStorePath),
        tokenStorePath,
        persistTokensOnRefresh,
        tokenEnvFilePath,
      },
    },
    warnings,
  };
}

function secondsUntil(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Math.max(0, Math.floor((value - Date.now()) / 1000));
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
