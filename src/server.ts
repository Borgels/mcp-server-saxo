import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SaxoClient, type SaxoClientOptions } from './saxo/client.js';
import { persistTokensFromRuntimeConfig } from './saxo/token-persistence.js';
import { registerSaxoTools } from './tools/saxo.js';

export interface CreateServerOptions {
  client?: SaxoClient;
  clientOptions?: SaxoClientOptions;
}

const PACKAGE_VERSION = readPackageVersion();

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'saxo',
    version: PACKAGE_VERSION,
  });

  const clientOptions = options.clientOptions ?? {};
  const client = options.client ?? new SaxoClient({
    ...clientOptions,
    onTokensRefreshed: clientOptions.onTokensRefreshed ?? (async (tokens, environment) => {
      await persistTokensFromRuntimeConfig(environment, tokens);
    }),
  });
  registerSaxoTools(server, client);

  return server;
}

// Reads version from the nearest package.json by walking up from this file.
// Works in both source mode (tsx loads src/server.ts) and bundled dist (tsup
// emits a chunk under dist/). Falls back to '0.0.0' if package.json is
// somehow unreachable so the server still starts.
function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    try {
      const raw = readFileSync(resolve(dir, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      // fall through and walk up
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return '0.0.0';
}
