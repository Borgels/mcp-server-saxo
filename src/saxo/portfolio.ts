import type { SaxoClient } from './client.js';

export interface ListAccountsInput {
  clientKey?: string;
  includeSubAccounts?: boolean;
}

export function listAccounts(client: SaxoClient, input: ListAccountsInput): Promise<unknown> {
  if (input.clientKey) {
    return client.get('/port/v1/accounts', {
      ClientKey: input.clientKey,
      IncludeSubAccounts: input.includeSubAccounts,
    });
  }

  return client.get('/port/v1/accounts/me', {
    IncludeSubAccounts: input.includeSubAccounts,
  });
}

export interface GetBalanceInput {
  accountKey?: string;
  clientKey?: string;
}

export function getBalance(client: SaxoClient, input: GetBalanceInput): Promise<unknown> {
  return client.get('/port/v1/balances', {
    AccountKey: input.accountKey,
    ClientKey: input.clientKey,
  });
}

export interface ListPositionsInput {
  clientKey?: string;
  accountKey?: string;
  top?: number;
  skip?: number;
  fieldGroups?: string[];
}

export function listPositions(client: SaxoClient, input: ListPositionsInput): Promise<unknown> {
  const query = {
    ClientKey: input.clientKey,
    AccountKey: input.accountKey,
    $top: input.top,
    $skip: input.skip,
    FieldGroups: input.fieldGroups?.join(','),
  };

  if (input.clientKey || input.accountKey) {
    return client.get('/port/v1/positions', query);
  }

  return client.get('/port/v1/positions/me', query);
}

export interface ListClosedPositionsInput {
  clientKey?: string;
  accountKey?: string;
  top?: number;
  skip?: number;
  fromDate?: string;
  toDate?: string;
}

export function listClosedPositions(
  client: SaxoClient,
  input: ListClosedPositionsInput,
): Promise<unknown> {
  return client.get('/port/v1/closedpositions/me', {
    ClientKey: input.clientKey,
    AccountKey: input.accountKey,
    $top: input.top,
    $skip: input.skip,
    FromDate: input.fromDate,
    ToDate: input.toDate,
  });
}

export interface ListOrdersInput {
  clientKey?: string;
  accountKey?: string;
  top?: number;
  skip?: number;
  fieldGroups?: string[];
  status?: 'Working' | 'All';
}

export function listOrders(client: SaxoClient, input: ListOrdersInput): Promise<unknown> {
  const query = {
    ClientKey: input.clientKey,
    AccountKey: input.accountKey,
    $top: input.top,
    $skip: input.skip,
    FieldGroups: input.fieldGroups?.join(','),
    Status: input.status,
  };

  if (input.clientKey || input.accountKey) {
    return client.get('/port/v1/orders', query);
  }

  return client.get('/port/v1/orders/me', query);
}

export interface GetOrderInput {
  orderId: string;
  clientKey?: string;
  fieldGroups?: string[];
}

export function getOrder(client: SaxoClient, input: GetOrderInput): Promise<unknown> {
  return client.get(`/port/v1/orders/${encodeURIComponent(input.orderId)}`, {
    ClientKey: input.clientKey,
    FieldGroups: input.fieldGroups?.join(','),
  });
}
