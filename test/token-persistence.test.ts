import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadStoredTokens,
  persistOauthTokens,
  tokenEnvEntries,
} from '../src/saxo/token-persistence.js';

let tempDir: string | undefined;

describe('Saxo token persistence', () => {
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('persists and reloads token-store JSON including refresh expiry', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'saxo-token-persist-'));
    const tokenStorePath = join(tempDir, 'tokens.json');
    const expiresAt = Date.parse('2030-01-01T00:00:00.000Z');
    const refreshTokenExpiresAt = Date.parse('2030-02-01T00:00:00.000Z');

    const result = await persistOauthTokens({
      environment: 'live',
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt,
        refreshTokenExpiresAt,
      },
      writeToTokenStore: true,
      tokenStorePath,
    });

    expect(result.storage).toBe('token_store');
    const stored = loadStoredTokens(tokenStorePath, 'live');
    expect(stored).toMatchObject({
      environment: 'live',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: '2030-01-01T00:00:00.000Z',
      refreshTokenExpiresAt: '2030-02-01T00:00:00.000Z',
    });
    await expect(readFile(tokenStorePath, 'utf8')).resolves.toContain('"refreshTokenExpiresAt"');
  });

  it('builds env entries for both access and refresh token expiry', () => {
    expect(
      tokenEnvEntries('sim', {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.parse('2030-01-01T00:00:00.000Z'),
        refreshTokenExpiresAt: Date.parse('2030-02-01T00:00:00.000Z'),
      }),
    ).toMatchObject({
      SAXO_ENVIRONMENT: 'sim',
      SAXO_ACCESS_TOKEN: 'access-token',
      SAXO_REFRESH_TOKEN: 'refresh-token',
      SAXO_TOKEN_EXPIRES_AT: '2030-01-01T00:00:00.000Z',
      SAXO_REFRESH_TOKEN_EXPIRES_AT: '2030-02-01T00:00:00.000Z',
    });
  });
});
