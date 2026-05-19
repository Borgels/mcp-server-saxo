import { readFileSync } from 'node:fs';
import { SaxoPolicyDeniedError } from '../errors.js';
import type { SaxoEnvironment } from './environment.js';

const READ_ONLY_TOOLS = new Set([
  'saxo_capabilities',
  'saxo_session_me',
  'saxo_diagnostics',
  'saxo_search_instruments',
  'saxo_get_instrument_details',
  'saxo_list_exchanges',
  'saxo_get_infoprice',
  'saxo_get_infoprices_list',
  'saxo_get_chart',
  'saxo_list_accounts',
  'saxo_get_balance',
  'saxo_list_positions',
  'saxo_list_closed_positions',
  'saxo_list_orders',
  'saxo_get_order',
]);

const WRITE_TOOLS = new Set([
  'saxo_precheck_order',
  'saxo_place_order',
  'saxo_modify_order',
  'saxo_cancel_order',
]);

const OAUTH_TOOLS = new Set([
  'saxo_oauth_start',
  'saxo_oauth_complete',
  'saxo_oauth_cancel',
]);

export interface SaxoPolicy {
  allow_live_writes: boolean;
  require_precheck_on_live: boolean;
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

export function loadPolicy(path: string | undefined = process.env.SAXO_POLICY_PATH): SaxoPolicy {
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
  policy?: SaxoPolicy;
}

export interface OrderPolicyInput {
  AccountKey?: string;
  Uic?: number;
  AssetType?: string;
  Amount?: number;
  BuySell?: 'Buy' | 'Sell';
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
    if (typeof price === 'number' && input.Amount * price > policy.max_notional) {
      throw new SaxoPolicyDeniedError(
        'saxo_place_order',
        `Notional ${input.Amount * price} exceeds policy max_notional (${policy.max_notional}).`,
      );
    }
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

export function isLiveTradingEnabled(): boolean {
  return (process.env.SAXO_ENABLE_LIVE_TRADING ?? 'false').trim().toLowerCase() === 'true';
}
