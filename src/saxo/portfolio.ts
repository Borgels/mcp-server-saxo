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

export async function getBalance(client: SaxoClient, input: GetBalanceInput): Promise<unknown> {
  // Saxo's /port/v1/balances requires ClientKey even when AccountKey is
  // supplied. Most callers (especially LLM drivers) only pass AccountKey.
  // Fall back to the session ClientKey to avoid a confusing 400.
  const clientKey = input.clientKey ?? (await client.resolveClientKey());
  return client.get('/port/v1/balances', {
    AccountKey: input.accountKey,
    ClientKey: clientKey,
  });
}

export interface ListPositionsInput {
  clientKey?: string;
  accountKey?: string;
  top?: number;
  skip?: number;
  fieldGroups?: string[];
}

export async function listPositions(client: SaxoClient, input: ListPositionsInput): Promise<unknown> {
  // /me works without keys; the explicit endpoint requires ClientKey.
  if (!input.clientKey && !input.accountKey) {
    return client.get('/port/v1/positions/me', {
      $top: input.top,
      $skip: input.skip,
      FieldGroups: input.fieldGroups?.join(','),
    });
  }
  const clientKey = input.clientKey ?? (await client.resolveClientKey());
  return client.get('/port/v1/positions', {
    ClientKey: clientKey,
    AccountKey: input.accountKey,
    $top: input.top,
    $skip: input.skip,
    FieldGroups: input.fieldGroups?.join(','),
  });
}

export interface ListClosedPositionsInput {
  clientKey?: string;
  accountKey?: string;
  top?: number;
  skip?: number;
  fromDate?: string;
  toDate?: string;
}

export async function listClosedPositions(
  client: SaxoClient,
  input: ListClosedPositionsInput,
): Promise<unknown> {
  if (!input.clientKey && !input.accountKey) {
    return client.get('/port/v1/closedpositions/me', {
      $top: input.top,
      $skip: input.skip,
      FromDate: input.fromDate,
      ToDate: input.toDate,
    });
  }
  const clientKey = input.clientKey ?? (await client.resolveClientKey());
  return client.get('/port/v1/closedpositions', {
    ClientKey: clientKey,
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

export async function listOrders(client: SaxoClient, input: ListOrdersInput): Promise<unknown> {
  if (!input.clientKey && !input.accountKey) {
    return client.get('/port/v1/orders/me', {
      $top: input.top,
      $skip: input.skip,
      FieldGroups: input.fieldGroups?.join(','),
      Status: input.status,
    });
  }
  const clientKey = input.clientKey ?? (await client.resolveClientKey());
  return client.get('/port/v1/orders', {
    ClientKey: clientKey,
    AccountKey: input.accountKey,
    $top: input.top,
    $skip: input.skip,
    FieldGroups: input.fieldGroups?.join(','),
    Status: input.status,
  });
}

export interface GetOrderInput {
  orderId: string;
  clientKey?: string;
  fieldGroups?: string[];
}

export async function getOrder(client: SaxoClient, input: GetOrderInput): Promise<unknown> {
  const clientKey = input.clientKey ?? (await client.resolveClientKey());
  return client.get(`/port/v1/orders/${encodeURIComponent(input.orderId)}`, {
    ClientKey: clientKey,
    FieldGroups: input.fieldGroups?.join(','),
  });
}
