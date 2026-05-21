import { readFileSync } from 'node:fs';
import { SaxoPolicyDeniedError } from '../errors.js';
import { readBoolEnv, readEnv } from './env.js';
import type { SaxoEnvironment } from './environment.js';

const READ_ONLY_TOOLS = new Set([
  'saxo_capabilities',
  'saxo_session_me',
  'saxo_diagnostics',
  'saxo_search_instruments',
  'saxo_get_instrument_details',
  'saxo_list_exchanges',
  'saxo_get_option_chain',
  'saxo_list_option_expiries',
  'saxo_list_standard_option_expiries',
  'saxo_find_option_leg',
  'saxo_get_infoprice',
  'saxo_get_infoprices_list',
  'saxo_get_chart',
  'saxo_feature_availability',
  'saxo_screen_market',
  'saxo_compute_spread_quote',
  'saxo_estimate_vertical_spread',
  'saxo_plan_option_strategy',
  'saxo_screen_option_strategies',
  'saxo_screen_stock_strategies',
  'saxo_plan_portfolio_strategy',
  'saxo_review_strategy_positions',
  'saxo_list_accounts',
  'saxo_get_balance',
  'saxo_list_positions',
  'saxo_list_net_positions',
  'saxo_list_closed_positions',
  'saxo_list_activities',
  'saxo_list_orders',
  'saxo_get_order',
  'saxo_list_price_alerts',
  'saxo_get_price_alert',
  'saxo_get_price_alert_user_settings',
]);

const WRITE_TOOLS = new Set([
  'saxo_precheck_order',
  'saxo_place_order',
  'saxo_modify_order',
  'saxo_cancel_order',
  'saxo_precheck_multileg_order',
  'saxo_place_multileg_order',
  'saxo_modify_multileg_order',
  'saxo_cancel_multileg_order',
]);

const ALERT_WRITE_TOOLS = new Set([
  'saxo_create_price_alert',
  'saxo_update_price_alert',
  'saxo_delete_price_alerts',
  'saxo_update_price_alert_user_settings',
]);

const OAUTH_TOOLS = new Set([
  'saxo_oauth_login',
  'saxo_oauth_start',
  'saxo_oauth_complete',
  'saxo_oauth_cancel',
]);

export interface SaxoPolicy {
  allow_live_writes: boolean;
  allow_live_alert_writes?: boolean;
  require_precheck_on_live: boolean;
  allow_short_option_legs?: boolean;
  allowed_asset_types?: string[];
  allowed_account_keys?: string[];
  denied_uics?: number[];
  max_order_amount?: Record<string, number>;
  max_notional?: number;
}

export const DEFAULT_POLICY: SaxoPolicy = {
  allow_live_writes: false,
  require_precheck_on_live: true,
};

let cachedPolicy: SaxoPolicy | undefined;

export function loadPolicy(path: string | undefined = readEnv('SAXO_POLICY_PATH')): SaxoPolicy {
  if (!path) {
    return DEFAULT_POLICY;
  }

  if (cachedPolicy) {
    return cachedPolicy;
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read SAXO_POLICY_PATH=${path}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Saxo policy file ${path} is not valid JSON: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Saxo policy file ${path} must contain a JSON object.`);
  }

  cachedPolicy = { ...DEFAULT_POLICY, ...(parsed as Partial<SaxoPolicy>) };
  return cachedPolicy;
}

export function resetPolicyCache(): void {
  cachedPolicy = undefined;
}

export interface ToolPolicyContext {
  tool: string;
  environment: SaxoEnvironment;
  liveTradingEnabled: boolean;
  liveAlertWritesEnabled?: boolean;
  policy?: SaxoPolicy;
}

export interface OrderPolicyInput {
  AccountKey?: string;
  Uic?: number;
  AssetType?: string;
  Amount?: number;
  BuySell?: 'Buy' | 'Sell';
  ToOpenClose?: 'ToOpen' | 'ToClose';
  OrderType?: string;
  OrderPrice?: number;
  StopPrice?: number;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
}

export function checkToolAllowed(context: ToolPolicyContext): PolicyDecision {
  const { tool, environment, liveTradingEnabled } = context;

  if (READ_ONLY_TOOLS.has(tool)) {
    return { allowed: true, reason: 'read-only Saxo tool' };
  }

  if (OAUTH_TOOLS.has(tool)) {
    return { allowed: true, reason: 'OAuth credential management tool' };
  }

  if (ALERT_WRITE_TOOLS.has(tool)) {
    if (environment === 'live') {
      if (!context.liveAlertWritesEnabled) {
        return {
          allowed: false,
          reason: 'LIVE price alert writes are disabled. Set SAXO_ENABLE_LIVE_ALERT_WRITES=true to opt in.',
        };
      }
      const policy = context.policy ?? DEFAULT_POLICY;
      if (!policy.allow_live_alert_writes) {
        return {
          allowed: false,
          reason: 'policy.json does not allow live price alert writes (allow_live_alert_writes=false).',
        };
      }
    }

    return { allowed: true, reason: 'price alert write tool authorised for environment' };
  }

  if (!WRITE_TOOLS.has(tool)) {
    return { allowed: false, reason: `tool is not allowlisted: ${tool}` };
  }

  if (environment === 'live') {
    if (!liveTradingEnabled) {
      return {
        allowed: false,
        reason: 'LIVE writes are disabled. Set SAXO_ENABLE_LIVE_TRADING=true to opt in.',
      };
    }

    const policy = context.policy ?? DEFAULT_POLICY;
    if (!policy.allow_live_writes) {
      return {
        allowed: false,
        reason: 'policy.json does not allow live writes (allow_live_writes=false).',
      };
    }
  }

  return { allowed: true, reason: 'write tool authorised for environment' };
}

export function checkOrder(input: OrderPolicyInput, policy: SaxoPolicy): void {
  if (input.AccountKey && policy.allowed_account_keys?.length) {
    if (!policy.allowed_account_keys.includes(input.AccountKey)) {
      throw new SaxoPolicyDeniedError(
        'saxo_place_order',
        `AccountKey ${input.AccountKey} is not in policy.allowed_account_keys.`,
      );
    }
  }

  if (input.AssetType && policy.allowed_asset_types?.length) {
    if (!policy.allowed_asset_types.includes(input.AssetType)) {
      throw new SaxoPolicyDeniedError(
        'saxo_place_order',
        `AssetType ${input.AssetType} is not in policy.allowed_asset_types.`,
      );
    }
  }

  if (input.Uic !== undefined && policy.denied_uics?.length) {
    if (policy.denied_uics.includes(input.Uic)) {
      throw new SaxoPolicyDeniedError('saxo_place_order', `Uic ${input.Uic} is in policy.denied_uics.`);
    }
  }

  if (typeof input.Amount === 'number' && policy.max_order_amount) {
    const limit = resolveAmountLimit(input.AssetType, policy.max_order_amount);
    if (limit !== undefined && input.Amount > limit) {
      throw new SaxoPolicyDeniedError(
        'saxo_place_order',
        `Amount ${input.Amount} exceeds policy max_order_amount (${limit}) for ${input.AssetType ?? 'default'}.`,
      );
    }
  }

  if (typeof policy.max_notional === 'number' && typeof input.Amount === 'number') {
    const price = input.OrderPrice ?? input.StopPrice;
    if (typeof price === 'number') {
      const multiplier = contractMultiplier(input.AssetType);
      const notional = input.Amount * price * multiplier;
      if (notional > policy.max_notional) {
        throw new SaxoPolicyDeniedError(
          'saxo_place_order',
          `Notional ${notional} (Amount × OrderPrice × multiplier ${multiplier}) exceeds policy max_notional (${policy.max_notional}).`,
        );
      }
    }
  }
}

export function contractMultiplier(assetType: string | undefined): number {
  if (!assetType) {
    return 1;
  }
  switch (assetType) {
    case 'StockOption':
    case 'IndexOption':
    case 'StockIndexOption':
    case 'FuturesOption':
      return 100;
    default:
      return 1;
  }
}

function resolveAmountLimit(
  assetType: string | undefined,
  limits: Record<string, number>,
): number | undefined {
  if (assetType && typeof limits[assetType] === 'number') {
    return limits[assetType];
  }

  return typeof limits.default === 'number' ? limits.default : undefined;
}

export interface MultiLegPolicyLeg {
  Uic?: number;
  AssetType?: string;
  Amount?: number;
  BuySell?: 'Buy' | 'Sell';
  ToOpenClose?: 'ToOpen' | 'ToClose';
}

export interface MultiLegPolicyInput {
  AccountKey?: string;
  OrderPrice?: number;
  Legs: MultiLegPolicyLeg[];
}

export function checkMultiLegOrder(input: MultiLegPolicyInput, policy: SaxoPolicy): void {
  if (input.AccountKey && policy.allowed_account_keys?.length) {
    if (!policy.allowed_account_keys.includes(input.AccountKey)) {
      throw new SaxoPolicyDeniedError(
        'saxo_place_multileg_order',
        `AccountKey ${input.AccountKey} is not in policy.allowed_account_keys.`,
      );
    }
  }

  let maxLegAmount = 0;
  for (let i = 0; i < input.Legs.length; i += 1) {
    const leg = input.Legs[i];
    if (!leg) {
      continue;
    }

    if (leg.AssetType && policy.allowed_asset_types?.length) {
      if (!policy.allowed_asset_types.includes(leg.AssetType)) {
        throw new SaxoPolicyDeniedError(
          'saxo_place_multileg_order',
          `Leg ${i} AssetType ${leg.AssetType} is not in policy.allowed_asset_types.`,
        );
      }
    }

    if (
      policy.allow_short_option_legs === false &&
      isOptionAssetType(leg.AssetType) &&
      leg.BuySell === 'Sell' &&
      leg.ToOpenClose !== 'ToClose'
    ) {
      throw new SaxoPolicyDeniedError(
        'saxo_place_multileg_order',
        `Leg ${i} opens a short ${leg.AssetType} position, but policy.allow_short_option_legs=false.`,
      );
    }

    if (leg.Uic !== undefined && policy.denied_uics?.length) {
      if (policy.denied_uics.includes(leg.Uic)) {
        throw new SaxoPolicyDeniedError(
          'saxo_place_multileg_order',
          `Leg ${i} Uic ${leg.Uic} is in policy.denied_uics.`,
        );
      }
    }

    if (typeof leg.Amount === 'number' && policy.max_order_amount) {
      const limit = resolveAmountLimit(leg.AssetType, policy.max_order_amount);
      if (limit !== undefined && leg.Amount > limit) {
        throw new SaxoPolicyDeniedError(
          'saxo_place_multileg_order',
          `Leg ${i} Amount ${leg.Amount} exceeds policy max_order_amount (${limit}) for ${leg.AssetType ?? 'default'}.`,
        );
      }
    }

    if (typeof leg.Amount === 'number' && leg.Amount > maxLegAmount) {
      maxLegAmount = leg.Amount;
    }
  }

  if (typeof policy.max_notional === 'number' && typeof input.OrderPrice === 'number' && maxLegAmount > 0) {
    // OrderPrice is the per-contract net debit/credit. True notional risk is
    // OrderPrice * largestLegAmount * contractMultiplier (100 for US equity
    // options). We use the largest leg's AssetType for the multiplier; if
    // unset we fall back to the option default of 100 to err toward blocking
    // oversized trades rather than letting them through.
    const largestLeg = input.Legs.reduce<MultiLegPolicyLeg | undefined>((best, leg) => {
      if (typeof leg.Amount !== 'number') {
        return best;
      }
      if (!best || (typeof best.Amount === 'number' && leg.Amount > best.Amount)) {
        return leg;
      }
      return best;
    }, undefined);
    const multiplier = contractMultiplier(largestLeg?.AssetType ?? 'StockOption');
    const notional = Math.abs(input.OrderPrice) * maxLegAmount * multiplier;
    if (notional > policy.max_notional) {
      throw new SaxoPolicyDeniedError(
        'saxo_place_multileg_order',
        `Notional ${notional} (|OrderPrice| × largest leg Amount × multiplier ${multiplier}) exceeds policy max_notional (${policy.max_notional}).`,
      );
    }
  }
}

function isOptionAssetType(assetType: string | undefined): boolean {
  return assetType === 'StockOption' ||
    assetType === 'IndexOption' ||
    assetType === 'StockIndexOption' ||
    assetType === 'FuturesOption';
}

export function isLiveTradingEnabled(): boolean {
  return readBoolEnv('SAXO_ENABLE_LIVE_TRADING', false);
}

export function isLiveAlertWritesEnabled(): boolean {
  return readBoolEnv('SAXO_ENABLE_LIVE_ALERT_WRITES', false);
}
