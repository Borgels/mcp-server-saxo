import type { SaxoClient } from './client.js';

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

  if (client.isLive()) {
    const liveEnabled = (process.env.SAXO_ENABLE_LIVE_TRADING ?? 'false').trim().toLowerCase() === 'true';
    if (!liveEnabled) {
      warnings.push('Environment=live but SAXO_ENABLE_LIVE_TRADING=false — all write tools will be denied.');
    }
  }

  return {
    environment: client.environment,
    baseUrl: client.baseUrl,
    liveTradingEnabled:
      (process.env.SAXO_ENABLE_LIVE_TRADING ?? 'false').trim().toLowerCase() === 'true',
    policyPath: process.env.SAXO_POLICY_PATH || undefined,
    auditLogPath: process.env.SAXO_AUDIT_LOG || undefined,
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
