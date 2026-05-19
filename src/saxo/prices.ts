import type { SaxoClient } from './client.js';
import { contractMultiplier } from './policy.js';

export interface InfoPriceInput {
  uic: number;
  assetType: string;
  accountKey?: string;
  amount?: number;
  fieldGroups?: string[];
}

export interface SaxoQuote {
  Amount?: number;
  Ask?: number;
  Bid?: number;
  Mid?: number;
  AskSize?: number;
  BidSize?: number;
  PriceTypeAsk?: string;
  PriceTypeBid?: string;
  ErrorCode?: string;
  [key: string]: unknown;
}

export interface InfoPriceResponse {
  Uic?: number;
  AssetType?: string;
  Quote?: SaxoQuote;
  PriceInfo?: Record<string, unknown>;
  PriceInfoDetails?: Record<string, unknown>;
  DisplayAndFormat?: Record<string, unknown>;
  _warning?: string;
  [key: string]: unknown;
}

const NO_ACCESS_WARNING =
  'PriceType*=NoAccess. Live quotes via OpenAPI require the per-exchange market-data terms (separate from the 24h token consent). Accept them in the Saxo platform under Settings → Live Data Subscriptions or developer.saxo.';

export async function getInfoPrice(client: SaxoClient, input: InfoPriceInput): Promise<InfoPriceResponse> {
  const response = await client.get<InfoPriceResponse>('/trade/v1/infoprices', {
    Uic: input.uic,
    AssetType: input.assetType,
    AccountKey: input.accountKey,
    Amount: input.amount,
    FieldGroups: input.fieldGroups?.join(','),
  });
  return annotateInfoPrice(response);
}

export interface InfoPriceListInput {
  uics: number[];
  assetType: string;
  accountKey?: string;
  fieldGroups?: string[];
}

export interface InfoPriceListResponse {
  Data?: InfoPriceResponse[];
  _warning?: string;
  [key: string]: unknown;
}

export async function getInfoPricesList(
  client: SaxoClient,
  input: InfoPriceListInput,
): Promise<InfoPriceListResponse> {
  const response = await client.get<InfoPriceListResponse>('/trade/v1/infoprices/list', {
    Uics: input.uics.join(','),
    AssetType: input.assetType,
    AccountKey: input.accountKey,
    FieldGroups: input.fieldGroups?.join(','),
  });
  if (response.Data) {
    response.Data = response.Data.map(annotateInfoPrice);
    if (response.Data.some(d => d._warning)) {
      response._warning = NO_ACCESS_WARNING;
    }
  }
  return response;
}

function annotateInfoPrice(response: InfoPriceResponse): InfoPriceResponse {
  const quote = response.Quote;
  if (quote && (quote.PriceTypeAsk === 'NoAccess' || quote.PriceTypeBid === 'NoAccess')) {
    return { ...response, _warning: NO_ACCESS_WARNING };
  }
  return response;
}

export interface GetChartInput {
  uic: number;
  assetType: string;
  horizon: number;
  count?: number;
  mode?: 'From' | 'UpTo';
  time?: string;
  fieldGroups?: string[];
}

export function getChart(client: SaxoClient, input: GetChartInput): Promise<unknown> {
  return client.get('/chart/v3/charts', {
    Uic: input.uic,
    AssetType: input.assetType,
    Horizon: input.horizon,
    Count: input.count,
    Mode: input.mode,
    Time: input.time,
    FieldGroups: input.fieldGroups?.join(','),
  });
}

// ---- Spread helpers ------------------------------------------------------

export interface SpreadLegInput {
  uic: number;
  assetType: string;
  buySell: 'Buy' | 'Sell';
  amount: number;
}

export interface SpreadQuoteInput {
  legs: SpreadLegInput[];
  accountKey?: string;
}

export interface SpreadLegQuote {
  uic: number;
  assetType: string;
  buySell: 'Buy' | 'Sell';
  amount: number;
  bid?: number;
  ask?: number;
  mid?: number;
  bidSize?: number;
  askSize?: number;
  warning?: string;
}

export interface SpreadQuoteResult {
  legs: SpreadLegQuote[];
  /** Net debit if positive, net credit if negative. */
  midDebit?: number;
  /** Worst-case debit assuming you pay ask on buys and receive bid on sells. */
  worstCaseDebit?: number;
  /** Best-case debit assuming you receive ask on sells and pay bid on buys (rare). */
  bestCaseDebit?: number;
  /** Sum of per-leg bid-ask widths weighted by amount, in price units. */
  bidAskWidth?: number;
  warnings: string[];
}

export async function computeSpreadQuote(
  client: SaxoClient,
  input: SpreadQuoteInput,
): Promise<SpreadQuoteResult> {
  const legs: SpreadLegQuote[] = [];
  const warnings: string[] = [];

  for (const leg of input.legs) {
    const price = await getInfoPrice(client, {
      uic: leg.uic,
      assetType: leg.assetType,
      accountKey: input.accountKey,
      fieldGroups: ['Quote'],
    });
    const quote = price.Quote ?? {};
    const bid = numericQuote(quote.Bid);
    const ask = numericQuote(quote.Ask);
    const mid = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined;
    const result: SpreadLegQuote = {
      uic: leg.uic,
      assetType: leg.assetType,
      buySell: leg.buySell,
      amount: leg.amount,
      bid,
      ask,
      mid,
      bidSize: numericQuote(quote.BidSize),
      askSize: numericQuote(quote.AskSize),
    };
    if (price._warning) {
      result.warning = price._warning;
      warnings.push(`Leg uic=${leg.uic}: ${price._warning}`);
    }
    legs.push(result);
  }

  return {
    legs,
    midDebit: aggregate(legs, l => l.mid),
    worstCaseDebit: aggregate(legs, l => (l.buySell === 'Buy' ? l.ask : l.bid)),
    bestCaseDebit: aggregate(legs, l => (l.buySell === 'Buy' ? l.bid : l.ask)),
    bidAskWidth: aggregate(legs, l => (l.bid !== undefined && l.ask !== undefined ? l.ask - l.bid : undefined)),
    warnings,
  };
}

function aggregate(
  legs: SpreadLegQuote[],
  pick: (leg: SpreadLegQuote) => number | undefined,
): number | undefined {
  let total = 0;
  for (const leg of legs) {
    const value = pick(leg);
    if (value === undefined) {
      return undefined;
    }
    total += value * (leg.buySell === 'Buy' ? 1 : -1);
  }
  return total;
}

function numericQuote(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    return undefined;
  }
  return value;
}

// ---- Vertical spread risk math ------------------------------------------

export interface VerticalSpreadInput {
  side: 'BullCall' | 'BearCall' | 'BullPut' | 'BearPut';
  longStrike: number;
  shortStrike: number;
  debit: number;
  contracts: number;
  assetType?: string;
}

export interface VerticalSpreadEstimate {
  side: VerticalSpreadInput['side'];
  longStrike: number;
  shortStrike: number;
  debit: number;
  contracts: number;
  multiplier: number;
  maxLossPerContract: number;
  maxGainPerContract: number;
  maxLoss: number;
  maxGain: number;
  breakeven: number;
  riskRewardRatio?: number;
  notes: string[];
}

export function estimateVerticalSpread(input: VerticalSpreadInput): VerticalSpreadEstimate {
  const multiplier = contractMultiplier(input.assetType ?? 'StockOption');
  const width = Math.abs(input.shortStrike - input.longStrike);
  const notes: string[] = [];
  const debit = input.debit;
  const contracts = input.contracts;

  let maxLossPerContract = 0;
  let maxGainPerContract = 0;
  let breakeven = 0;

  switch (input.side) {
    case 'BullCall':
      if (input.shortStrike <= input.longStrike) {
        notes.push('Bull call spread requires shortStrike > longStrike.');
      }
      maxLossPerContract = debit;
      maxGainPerContract = width - debit;
      breakeven = input.longStrike + debit;
      break;
    case 'BearPut':
      if (input.shortStrike >= input.longStrike) {
        notes.push('Bear put spread requires shortStrike < longStrike.');
      }
      maxLossPerContract = debit;
      maxGainPerContract = width - debit;
      breakeven = input.longStrike - debit;
      break;
    case 'BearCall':
      // Credit spread — debit is negative or zero.
      if (debit > 0) {
        notes.push('Bear call spread is a credit spread; expected negative debit (credit received).');
      }
      maxGainPerContract = Math.abs(debit);
      maxLossPerContract = width - Math.abs(debit);
      breakeven = input.shortStrike + Math.abs(debit);
      break;
    case 'BullPut':
      if (debit > 0) {
        notes.push('Bull put spread is a credit spread; expected negative debit (credit received).');
      }
      maxGainPerContract = Math.abs(debit);
      maxLossPerContract = width - Math.abs(debit);
      breakeven = input.shortStrike - Math.abs(debit);
      break;
  }

  const maxLoss = maxLossPerContract * multiplier * contracts;
  const maxGain = maxGainPerContract * multiplier * contracts;
  const riskRewardRatio = maxLossPerContract > 0 ? maxGainPerContract / maxLossPerContract : undefined;

  return {
    side: input.side,
    longStrike: input.longStrike,
    shortStrike: input.shortStrike,
    debit,
    contracts,
    multiplier,
    maxLossPerContract,
    maxGainPerContract,
    maxLoss,
    maxGain,
    breakeven,
    riskRewardRatio,
    notes,
  };
}
