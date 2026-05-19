import type { SaxoClient } from './client.js';

export type OrderDurationType =
  | 'DayOrder'
  | 'GoodTillCancel'
  | 'GoodTillDate'
  | 'GoodForPeriod'
  | 'ImmediateOrCancel'
  | 'FillOrKill'
  | 'AtTheOpening'
  | 'AtTheClose';

export interface OrderDuration {
  DurationType: OrderDurationType;
  ExpirationDate?: string;
  ExpirationTime?: string;
}

export interface RelatedOrder {
  AssetType: string;
  BuySell: 'Buy' | 'Sell';
  Amount: number;
  OrderType: string;
  OrderPrice?: number;
  StopPrice?: number;
  OrderDuration: OrderDuration;
}

export interface PlaceOrderInput {
  AccountKey: string;
  Uic: number;
  AssetType: string;
  BuySell: 'Buy' | 'Sell';
  Amount: number;
  OrderType: string;
  OrderDuration: OrderDuration;
  OrderPrice?: number;
  StopPrice?: number;
  ManualOrder?: boolean;
  ExternalReference?: string;
  Orders?: RelatedOrder[];
}

export function placeOrder(client: SaxoClient, body: PlaceOrderInput): Promise<unknown> {
  return client.post('/trade/v2/orders', body);
}

export function precheckOrder(client: SaxoClient, body: PlaceOrderInput): Promise<unknown> {
  return client.post('/trade/v2/orders/precheck', body);
}

export interface ModifyOrderInput {
  OrderId: string;
  AccountKey: string;
  Uic: number;
  AssetType: string;
  Amount?: number;
  OrderType?: string;
  OrderPrice?: number;
  StopPrice?: number;
  OrderDuration?: OrderDuration;
}

export function modifyOrder(client: SaxoClient, body: ModifyOrderInput): Promise<unknown> {
  return client.patch('/trade/v2/orders', body);
}

export interface CancelOrderInput {
  orderIds: string[];
  accountKey: string;
}

export function cancelOrder(client: SaxoClient, input: CancelOrderInput): Promise<unknown> {
  return client.delete(`/trade/v2/orders/${input.orderIds.map(encodeURIComponent).join(',')}`, {
    AccountKey: input.accountKey,
  });
}
