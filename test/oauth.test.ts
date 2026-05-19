import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelOauthFlow,
  completeOauthFlow,
  loadOauthConfigFromEnv,
  startOauthFlow,
} from '../src/saxo/oauth.js';

const ENV_KEYS = ['SAXO_APP_KEY', 'SAXO_APP_SECRET', 'SAXO_REDIRECT_URI', 'SAXO_ENVIRONMENT'];
const savedEnv: Record<string, string | undefined> = {};

describe('Saxo OAuth flow', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.SAXO_APP_KEY = 'app-key';
    process.env.SAXO_APP_SECRET = 'app-secret';
    process.env.SAXO_REDIRECT_URI = 'http://127.0.0.1:0/callback';
    process.env.SAXO_ENVIRONMENT = 'sim';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('rejects non-loopback redirect URIs', () => {
    process.env.SAXO_REDIRECT_URI = 'https://evil.example/callback';
    expect(() => startOauthFlow(loadOauthConfigFromEnv())).toThrow(/loopback/);
  });

  it('requires SAXO_APP_KEY and SAXO_APP_SECRET', () => {
    delete process.env.SAXO_APP_KEY;
    expect(() => loadOauthConfigFromEnv()).toThrow(/SAXO_APP_KEY/);
  });

  it('produces an authorize URL with PKCE challenge and state', () => {
    const flow = startOauthFlow(loadOauthConfigFromEnv());
    try {
      const url = new URL(flow.authorizeUrl);
      expect(url.hostname).toBe('sim.logonvalidation.net');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('app-key');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(flow.environment).toBe('sim');
    } finally {
      cancelOauthFlow(flow.ticketId);
    }
  });

  it('rejects an unknown ticketId on complete', async () => {
    await expect(completeOauthFlow('does-not-exist')).rejects.toThrow(/Unknown OAuth ticketId/);
  });
});
