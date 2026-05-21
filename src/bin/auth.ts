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
  SAXO_APP_SECRET (required for Code-grant apps; omit for PKCE-grant apps)
  SAXO_REDIRECT_URI (default http://localhost:8765/callback). The exact value
    must be registered in the Saxo app. Saxo's authorize endpoint rejects IP-
    literal redirects, so use a hostname (localhost), not 127.0.0.1.
    For PKCE-grant apps the registered URL in the portal must OMIT the port
    (e.g. http://localhost/callback); the URL sent by this CLI keeps the
    port and Saxo matches port-blind.
`);
}

function openBrowser(url: string): void {
  // On Windows `start` is a cmd builtin, not an executable, so we have to go
  // through a URL handler. Avoid `cmd /c start`: OAuth URLs contain `&`, and
  // cmd treats that as a command separator unless quoting is exactly right.
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = isWindows ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    // spawn() emits ENOENT asynchronously via 'error' if the binary is missing —
    // a try/catch around spawn() will not catch it. Swallow it explicitly.
    child.on('error', () => {
      // ignore — user can copy/paste the URL printed earlier.
    });
    child.unref();
  } catch {
    // ignore — user can copy/paste the URL printed earlier.
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
