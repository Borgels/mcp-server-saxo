import { SaxoClient, type SaxoClientOptions } from './saxo/client.js';
import { searchCapabilities } from './saxo/capabilities.js';
import { getBalance, listAccounts, listOrders, listPositions } from './saxo/portfolio.js';
import { getInfoPrice } from './saxo/prices.js';
import { getInstrumentDetails, searchInstruments } from './saxo/reference.js';
import { getDiagnostics, getSessionMe } from './saxo/session.js';

export type GatewayRiskLevel = 'read' | 'write' | 'destructive';
export type GatewayJsonValue = string | number | boolean | null | GatewayJsonValue[] | { [key: string]: GatewayJsonValue };
export type GatewayJsonObject = { [key: string]: GatewayJsonValue };

export interface GatewayToolDefinition {
  name: string;
  title: string;
  description: string;
  riskLevel: GatewayRiskLevel;
  enabledByDefault: boolean;
  inputSchema: GatewayJsonObject;
}

export interface GatewayToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: GatewayJsonValue;
  isError?: boolean;
}

export interface SaxoGatewayOptions extends SaxoClientOptions {}

const emptyInput = { type: 'object', properties: {}, additionalProperties: false } satisfies GatewayJsonObject;

export const saxoGatewayTools: GatewayToolDefinition[] = [
  {
    name: 'capabilities',
    title: 'Search Saxo capabilities',
    description: 'Find supported Saxo account, portfolio, instrument, and price tools.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'session_me',
    title: 'Get Saxo session',
    description: 'Verify the Saxo token and return the current session context.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: emptyInput,
  },
  {
    name: 'diagnostics',
    title: 'Run Saxo diagnostics',
    description: 'Check Saxo OpenAPI connectivity and market-data warnings.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: emptyInput,
  },
  {
    name: 'search_instruments',
    title: 'Search Saxo instruments',
    description: 'Search Saxo reference data for instruments by keyword and asset type.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        keywords: { type: 'string' },
        assetTypes: { type: 'array', items: { type: 'string' } },
        exchangeIds: { type: 'array', items: { type: 'string' } },
        accountKey: { type: 'string' },
        includeNonTradable: { type: 'boolean' },
        top: { type: 'number', minimum: 1, maximum: 500 },
        skip: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_instrument_details',
    title: 'Get Saxo instrument details',
    description: 'Fetch detailed metadata for one or more instruments by Uic and AssetType.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      required: ['uics', 'assetType'],
      properties: {
        uics: { type: 'array', items: { type: 'number' } },
        assetType: { type: 'string' },
        accountKey: { type: 'string' },
        fieldGroups: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_infoprice',
    title: 'Get Saxo snapshot price',
    description: 'Fetch a snapshot bid/ask/last price for a single instrument.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      required: ['uic', 'assetType'],
      properties: {
        uic: { type: 'number' },
        assetType: { type: 'string' },
        accountKey: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_accounts',
    title: 'List Saxo accounts',
    description: 'List Saxo accounts visible to the configured token.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: emptyInput,
  },
  {
    name: 'get_balance',
    title: 'Get Saxo balance',
    description: 'Read Saxo balance for the default or supplied account.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: { type: 'object', properties: { accountKey: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_positions',
    title: 'List Saxo positions',
    description: 'List open Saxo positions.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: { type: 'object', properties: { accountKey: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_orders',
    title: 'List Saxo orders',
    description: 'List Saxo orders for review only.',
    riskLevel: 'read',
    enabledByDefault: true,
    inputSchema: { type: 'object', properties: { accountKey: { type: 'string' } }, additionalProperties: false },
  },
];

export function createSaxoGateway(options: SaxoGatewayOptions = {}) {
  const client = new SaxoClient(options);

  return {
    tools: saxoGatewayTools,
    async callTool(toolName: string, input: GatewayJsonObject = {}): Promise<GatewayToolResult> {
      switch (toolName) {
        case 'capabilities':
          return jsonResult('Found Saxo capabilities.', searchCapabilities(stringValue(input.query) ?? '', numberValue(input.limit) ?? 20));

        case 'session_me':
          return jsonResult('Fetched Saxo session.', await getSessionMe(client));

        case 'diagnostics':
          return jsonResult('Fetched Saxo diagnostics.', await getDiagnostics(client));

        case 'search_instruments':
          return jsonResult('Fetched Saxo instruments.', await searchInstruments(client, input as Parameters<typeof searchInstruments>[1]));

        case 'get_instrument_details':
          return jsonResult('Fetched Saxo instrument details.', await getInstrumentDetails(client, input as unknown as Parameters<typeof getInstrumentDetails>[1]));

        case 'get_infoprice':
          return jsonResult('Fetched Saxo snapshot price.', await getInfoPrice(client, input as unknown as Parameters<typeof getInfoPrice>[1]));

        case 'list_accounts':
          return jsonResult('Fetched Saxo accounts.', await listAccounts(client, input as Parameters<typeof listAccounts>[1]));

        case 'get_balance':
          return jsonResult('Fetched Saxo balance.', await getBalance(client, input as Parameters<typeof getBalance>[1]));

        case 'list_positions':
          return jsonResult('Fetched Saxo positions.', await listPositions(client, input as Parameters<typeof listPositions>[1]));

        case 'list_orders':
          return jsonResult('Fetched Saxo orders.', await listOrders(client, input as Parameters<typeof listOrders>[1]));

        default:
          return errorResult(`Unsupported Saxo gateway tool: ${toolName}`);
      }
    },
  };
}

function stringValue(value: GatewayJsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: GatewayJsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function jsonResult(text: string, structuredContent: unknown): GatewayToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: JSON.parse(JSON.stringify(structuredContent ?? null)) as GatewayJsonValue,
  };
}

function errorResult(text: string): GatewayToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}
