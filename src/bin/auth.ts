#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { upsertEnvFile } from '../saxo/env-file.js';
import {
  completeOauthFlow,
  loadOauthConfigFromEnv,
  startOauthFlow,
} from '../saxo/oauth.js';
import { resolveEnvironment, type SaxoEnvironment } from '../saxo/environment.js';

interface CliOptions {
  environment: SaxoEnvironment;
  envFile: string;
  print: boolean;
  timeoutMs: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const config = loadOauthConfigFromEnv(options.environment);
  const flow = startOauthFlow(config);

  console.error(`\nSaxo OAuth ${flow.environment.toUpperCase()} flow`);
  console.error(`Redirect URI: ${flow.redirectUri}`);
  console.error(`Open this URL in your browser if it doesn't open automatically:\n  ${flow.authorizeUrl}\n`);

  openBrowser(flow.authorizeUrl);

  const { tokens } = await completeOauthFlow(flow.ticketId, options.timeoutMs);

  const entries: Record<string, string> = {
    SAXO_ENVIRONMENT: flow.environment,
    SAXO_ACCESS_TOKEN: tokens.accessToken,
  };
  if (tokens.refreshToken) {
    entries.SAXO_REFRESH_TOKEN = tokens.refreshToken;
  }
  if (tokens.expiresAt) {
    entries.SAXO_TOKEN_EXPIRES_AT = new Date(tokens.expiresAt).toISOString();
  }

  if (options.print) {
    for (const [key, value] of Object.entries(entries)) {
      process.stdout.write(`${key}=${value}\n`);
    }
    return;
  }

  await upsertEnvFile(options.envFile, entries);
  console.error(`\nWrote ${Object.keys(entries).length} key(s) to ${options.envFile}`);
}

function parseArgs(args: string[]): CliOptions {
  let environment: SaxoEnvironment = resolveEnvironment(process.env.SAXO_ENVIRONMENT);
  let envFile = resolve(process.cwd(), '.env');
  let print = false;
  let timeoutMs = 180_000;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--env' || arg === '-e') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('--env requires sim or live.');
      }
      environment = resolveEnvironment(value);
      i += 1;
    } else if (arg === '--print') {
      print = true;
    } else if (arg === '--out') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('--out requires a path.');
      }
      envFile = resolve(process.cwd(), value);
      i += 1;
    } else if (arg === '--timeout') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('--timeout requires seconds.');
      }
      timeoutMs = Number(value) * 1000;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { environment, envFile, print, timeoutMs };
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run auth -- [--env sim|live] [--out .env] [--timeout 180] [--print]

Environment variables required:
  SAXO_APP_KEY
  SAXO_APP_SECRET
  SAXO_REDIRECT_URI (default http://127.0.0.1:8765/callback)
`);
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // ignore — user can copy/paste the URL printed earlier.
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
