import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SaxoClient, type SaxoClientOptions } from './saxo/client.js';
import { registerSaxoTools } from './tools/saxo.js';

export interface CreateServerOptions {
  client?: SaxoClient;
  clientOptions?: SaxoClientOptions;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'saxo',
    version: '0.1.0',
  });

  const client = options.client ?? new SaxoClient(options.clientOptions);
  registerSaxoTools(server, client);

  return server;
}
