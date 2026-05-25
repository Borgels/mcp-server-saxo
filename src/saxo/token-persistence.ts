import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { SaxoTokenSet } from './auth.js';
import { readBoolEnv, readEnv } from './env.js';
import type { SaxoEnvironment } from './environment.js';
import { upsertEnvFile } from './env-file.js';

export interface StoredSaxoTokens {
  environment: SaxoEnvironment;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  updatedAt: string;
}

export interface TokenPersistenceResult {
  envFilePath?: string;
  tokenStorePath?: string;
  storage: 'memory' | 'env_file' | 'token_store' | 'env_file+token_store';
}

export function loadStoredTokens(
  tokenStorePathInput: string | undefined = readEnv('SAXO_TOKEN_STORE_PATH'),
  expectedEnvironment?: SaxoEnvironment,
): StoredSaxoTokens | undefined {
  if (!tokenStorePathInput) {
    return undefined;
  }
  const tokenStorePath = resolve(process.cwd(), tokenStorePathInput);
  if (!existsSync(tokenStorePath)) {
    return undefined;
  }
  try {
    const raw = readFileSyncUtf8(tokenStorePath);
    const parsed = JSON.parse(raw) as Partial<StoredSaxoTokens>;
    if (!parsed.accessToken || !parsed.environment) {
      return undefined;
    }
    if (expectedEnvironment && parsed.environment !== expectedEnvironment) {
      return undefined;
    }
    return {
      environment: parsed.environment,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      tokenExpiresAt: parsed.tokenExpiresAt,
      refreshTokenExpiresAt: parsed.refreshTokenExpiresAt,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return undefined;
  }
}

export async function persistOauthTokens(input: {
  environment: SaxoEnvironment | string;
  tokens: SaxoTokenSet;
  envFilePath?: string;
  tokenStorePath?: string;
  writeToEnvFile?: boolean;
  writeToTokenStore?: boolean;
}): Promise<TokenPersistenceResult> {
  const envFilePath = input.writeToEnvFile
    ? resolve(process.cwd(), input.envFilePath ?? '.env')
    : undefined;
  const tokenStorePath = input.writeToTokenStore
    ? resolve(process.cwd(), input.tokenStorePath ?? readEnv('SAXO_TOKEN_STORE_PATH') ?? '.saxo-tokens.json')
    : undefined;

  if (envFilePath) {
    await upsertEnvFile(envFilePath, tokenEnvEntries(input.environment, input.tokens));
  }
  if (tokenStorePath) {
    await writeTokenStore(tokenStorePath, input.environment, input.tokens);
  }

  return {
    envFilePath,
    tokenStorePath,
    storage: storageLabel(Boolean(envFilePath), Boolean(tokenStorePath)),
  };
}

export async function persistTokensFromRuntimeConfig(
  environment: SaxoEnvironment,
  tokens: SaxoTokenSet,
): Promise<TokenPersistenceResult> {
  const tokenStorePath = readEnv('SAXO_TOKEN_STORE_PATH');
  const writeEnvFile = readBoolEnv('SAXO_PERSIST_TOKENS_ON_REFRESH', false);
  const envFilePath = writeEnvFile ? readEnv('SAXO_TOKEN_ENV_FILE_PATH') ?? '.env' : undefined;
  return persistOauthTokens({
    environment,
    tokens,
    envFilePath,
    tokenStorePath,
    writeToEnvFile: Boolean(envFilePath),
    writeToTokenStore: Boolean(tokenStorePath),
  });
}

export function tokenEnvEntries(environment: SaxoEnvironment | string, tokens: SaxoTokenSet): Record<string, string> {
  const entries: Record<string, string> = {
    SAXO_ENVIRONMENT: environment,
    SAXO_ACCESS_TOKEN: tokens.accessToken,
  };
  if (tokens.refreshToken) {
    entries.SAXO_REFRESH_TOKEN = tokens.refreshToken;
  }
  if (tokens.expiresAt) {
    entries.SAXO_TOKEN_EXPIRES_AT = new Date(tokens.expiresAt).toISOString();
  }
  if (tokens.refreshTokenExpiresAt) {
    entries.SAXO_REFRESH_TOKEN_EXPIRES_AT = new Date(tokens.refreshTokenExpiresAt).toISOString();
  }
  return entries;
}

export function tokenSetFromStore(store: StoredSaxoTokens): SaxoTokenSet {
  return {
    accessToken: store.accessToken,
    refreshToken: store.refreshToken,
    expiresAt: parseExpiry(store.tokenExpiresAt),
    refreshTokenExpiresAt: parseExpiry(store.refreshTokenExpiresAt),
  };
}

async function writeTokenStore(
  tokenStorePath: string,
  environment: SaxoEnvironment | string,
  tokens: SaxoTokenSet,
): Promise<void> {
  const payload: StoredSaxoTokens = {
    environment: environment as SaxoEnvironment,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : undefined,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ? new Date(tokens.refreshTokenExpiresAt).toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(tokenStorePath), { recursive: true });
  await writeFile(tokenStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function storageLabel(envFile: boolean, tokenStore: boolean): TokenPersistenceResult['storage'] {
  if (envFile && tokenStore) return 'env_file+token_store';
  if (envFile) return 'env_file';
  if (tokenStore) return 'token_store';
  return 'memory';
}

function parseExpiry(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function readFileSyncUtf8(path: string): string {
  // Keep the public load helper synchronous so SaxoClient construction remains
  // synchronous for MCP server startup.
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
