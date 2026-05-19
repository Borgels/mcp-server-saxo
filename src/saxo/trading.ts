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

export interface MultiLegOrderLeg {
  Uic: number;
  AssetType: string;
  BuySell: 'Buy' | 'Sell';
  Amount: number;
  ToOpenClose: 'ToOpen' | 'ToClose';
}

export interface PlaceMultiLegOrderInput {
  AccountKey: string;
  OrderType: 'Limit';
  OrderPrice?: number;
  OrderDuration: OrderDuration;
  Legs: MultiLegOrderLeg[];
  ManualOrder?: boolean;
  ExternalReference?: string;
}

export function placeMultiLegOrder(
  client: SaxoClient,
  body: PlaceMultiLegOrderInput,
): Promise<unknown> {
  return client.post('/trade/v2/orders/multileg', body);
}

export function precheckMultiLegOrder(
  client: SaxoClient,
  body: PlaceMultiLegOrderInput,
): Promise<unknown> {
  return client.post('/trade/v2/orders/multileg/precheck', body);
}

export interface ModifyMultiLegOrderInput {
  AccountKey: string;
  MultiLegOrderId: string;
  Amount?: number;
  OrderPrice?: number;
}

export function modifyMultiLegOrder(
  client: SaxoClient,
  body: ModifyMultiLegOrderInput,
): Promise<unknown> {
  return client.patch('/trade/v2/orders/multileg', body);
}

export interface CancelMultiLegOrderInput {
  multiLegOrderId: string;
  accountKey: string;
}

export function cancelMultiLegOrder(
  client: SaxoClient,
  input: CancelMultiLegOrderInput,
): Promise<unknown> {
  return client.delete(
    `/trade/v2/orders/multileg/${encodeURIComponent(input.multiLegOrderId)}`,
    { AccountKey: input.accountKey },
  );
}
