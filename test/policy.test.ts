import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SaxoPolicyDeniedError } from '../src/errors.js';
import {
  checkOrder,
  checkToolAllowed,
  DEFAULT_POLICY,
  isLiveTradingEnabled,
  resetPolicyCache,
  type SaxoPolicy,
} from '../src/saxo/policy.js';

const ENV_KEYS = ['SAXO_ENABLE_LIVE_TRADING', 'SAXO_POLICY_PATH'];
const savedEnv: Record<string, string | undefined> = {};

describe('Saxo policy', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    resetPolicyCache();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    resetPolicyCache();
  });

  it('allows read-only tools on both SIM and LIVE', () => {
    expect(
      checkToolAllowed({
        tool: 'saxo_search_instruments',
        environment: 'sim',
        liveTradingEnabled: false,
      }),
    ).toMatchObject({ allowed: true });

    expect(
      checkToolAllowed({
        tool: 'saxo_search_instruments',
        environment: 'live',
        liveTradingEnabled: false,
      }),
    ).toMatchObject({ allowed: true });
  });

  it('allows write tools on SIM regardless of SAXO_ENABLE_LIVE_TRADING', () => {
    expect(
      checkToolAllowed({
        tool: 'saxo_place_order',
        environment: 'sim',
        liveTradingEnabled: false,
      }),
    ).toMatchObject({ allowed: true });
  });

  it('denies write tools on LIVE when SAXO_ENABLE_LIVE_TRADING is false', () => {
    const decision = checkToolAllowed({
      tool: 'saxo_place_order',
      environment: 'live',
      liveTradingEnabled: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/SAXO_ENABLE_LIVE_TRADING/);
  });

  it('denies write tools on LIVE when policy.allow_live_writes=false even with env flag', () => {
    const decision = checkToolAllowed({
      tool: 'saxo_place_order',
      environment: 'live',
      liveTradingEnabled: true,
      policy: { ...DEFAULT_POLICY, allow_live_writes: false },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/policy.json/);
  });

  it('allows write tools on LIVE when both flag and policy permit it', () => {
    const decision = checkToolAllowed({
      tool: 'saxo_place_order',
      environment: 'live',
      liveTradingEnabled: true,
      policy: { ...DEFAULT_POLICY, allow_live_writes: true },
    });
    expect(decision.allowed).toBe(true);
  });

  it('denies unknown tools', () => {
    const decision = checkToolAllowed({
      tool: 'saxo_drop_database',
      environment: 'sim',
      liveTradingEnabled: false,
    });
    expect(decision.allowed).toBe(false);
  });

  it('reads SAXO_ENABLE_LIVE_TRADING with strict boolean parsing', () => {
    expect(isLiveTradingEnabled()).toBe(false);
    process.env.SAXO_ENABLE_LIVE_TRADING = 'true';
    expect(isLiveTradingEnabled()).toBe(true);
    process.env.SAXO_ENABLE_LIVE_TRADING = 'TRUE';
    expect(isLiveTradingEnabled()).toBe(true);
    process.env.SAXO_ENABLE_LIVE_TRADING = '1';
    expect(isLiveTradingEnabled()).toBe(false);
  });
});

describe('Saxo policy.checkOrder', () => {
  it('rejects AccountKeys outside allowed_account_keys', () => {
    const policy: SaxoPolicy = {
      ...DEFAULT_POLICY,
      allowed_account_keys: ['AllowedKey'],
    };
    expect(() => checkOrder({ AccountKey: 'OtherKey' }, policy)).toThrow(SaxoPolicyDeniedError);
    expect(() => checkOrder({ AccountKey: 'AllowedKey' }, policy)).not.toThrow();
  });

  it('rejects AssetTypes outside allowed_asset_types', () => {
    const policy: SaxoPolicy = {
      ...DEFAULT_POLICY,
      allowed_asset_types: ['FxSpot'],
    };
    expect(() => checkOrder({ AssetType: 'CfdOnFutures' }, policy)).toThrow(SaxoPolicyDeniedError);
    expect(() => checkOrder({ AssetType: 'FxSpot' }, policy)).not.toThrow();
  });

  it('rejects Uics in denied_uics', () => {
    const policy: SaxoPolicy = { ...DEFAULT_POLICY, denied_uics: [211] };
    expect(() => checkOrder({ Uic: 211 }, policy)).toThrow(SaxoPolicyDeniedError);
    expect(() => checkOrder({ Uic: 16 }, policy)).not.toThrow();
  });

  it('enforces per-AssetType max_order_amount with default fallback', () => {
    const policy: SaxoPolicy = {
      ...DEFAULT_POLICY,
      max_order_amount: { default: 1000, FxSpot: 50000 },
    };
    expect(() => checkOrder({ AssetType: 'Stock', Amount: 1500 }, policy)).toThrow(SaxoPolicyDeniedError);
    expect(() => checkOrder({ AssetType: 'Stock', Amount: 500 }, policy)).not.toThrow();
    expect(() => checkOrder({ AssetType: 'FxSpot', Amount: 60000 }, policy)).toThrow(SaxoPolicyDeniedError);
    expect(() => checkOrder({ AssetType: 'FxSpot', Amount: 40000 }, policy)).not.toThrow();
  });

  it('enforces max_notional when both Amount and price are present', () => {
    const policy: SaxoPolicy = { ...DEFAULT_POLICY, max_notional: 1000 };
    expect(() => checkOrder({ Amount: 100, OrderPrice: 20 }, policy)).toThrow(SaxoPolicyDeniedError);
    expect(() => checkOrder({ Amount: 10, OrderPrice: 20 }, policy)).not.toThrow();
    expect(() => checkOrder({ Amount: 100 }, policy)).not.toThrow();
  });
});
