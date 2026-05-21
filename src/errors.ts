export interface SaxoErrorPayload {
  ErrorCode?: string;
  Message?: string;
  ModelState?: unknown;
}

const SECRET_PATTERNS = [
  /authorization:\s*bearer\s+[^\s,}"']+/gi,
  /(["']?(?:access_token|refresh_token|client_secret|SAXO_ACCESS_TOKEN|SAXO_REFRESH_TOKEN|SAXO_APP_SECRET)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
  /(SAXO_APP_SECRET["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
];

export class SaxoHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly payload?: SaxoErrorPayload | unknown;
  readonly retryAfter?: string;

  constructor(input: {
    status: number;
    url: string;
    payload?: SaxoErrorPayload | unknown;
    retryAfter?: string;
    fallbackMessage?: string;
  }) {
    super(formatSaxoHttpError(input));
    this.name = 'SaxoHttpError';
    this.status = input.status;
    this.url = redactSecrets(input.url);
    this.payload = input.payload;
    this.retryAfter = input.retryAfter;
  }
}

export class SaxoPolicyDeniedError extends Error {
  readonly reason: string;
  readonly tool: string;

  constructor(tool: string, reason: string) {
    super(`Policy denied ${tool}: ${reason}`);
    this.name = 'SaxoPolicyDeniedError';
    this.tool = tool;
    this.reason = reason;
  }
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }

  return redactSecrets(String(error));
}

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => {
    pattern.lastIndex = 0;
    return current.replace(pattern, (match, prefix?: string) => {
      if (typeof prefix === 'string' && prefix.length > 0) {
        return `${prefix}[REDACTED]`;
      }
      const separator = match.includes(':') ? ':' : '=';
      const key = match.split(separator)[0]?.trim() ?? 'secret';
      return `${key}${separator} [REDACTED]`;
    });
  }, value);
}

function formatSaxoHttpError(input: {
  status: number;
  url: string;
  payload?: SaxoErrorPayload | unknown;
  retryAfter?: string;
  fallbackMessage?: string;
}): string {
  const payload = isSaxoErrorPayload(input.payload) ? input.payload : undefined;
  const nested = extractNestedSaxoError(input.payload);
  const parts = [
    `Saxo OpenAPI request failed with HTTP ${input.status}`,
    payload?.ErrorCode ? `ErrorCode=${payload.ErrorCode}` : undefined,
    payload?.Message,
    nested,
    input.retryAfter ? `retry-after=${input.retryAfter}s` : undefined,
    input.fallbackMessage,
  ].filter(Boolean);

  return redactSecrets(parts.join(' | '));
}

function isSaxoErrorPayload(value: unknown): value is SaxoErrorPayload {
  return typeof value === 'object' && value !== null;
}

function extractNestedSaxoError(value: unknown): string | undefined {
  const messages = new Set<string>();
  collectNestedSaxoErrors(value, messages);
  return messages.size ? Array.from(messages).join(' | ') : undefined;
}

function collectNestedSaxoErrors(value: unknown, messages: Set<string>): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedSaxoErrors(item, messages);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const errorInfo = record.ErrorInfo;
  if (typeof errorInfo === 'object' && errorInfo !== null) {
    const nested = errorInfo as Record<string, unknown>;
    const code = typeof nested.ErrorCode === 'string' ? nested.ErrorCode : undefined;
    const message = typeof nested.Message === 'string' ? nested.Message : undefined;
    if (code || message) {
      messages.add([code ? `ErrorCode=${code}` : undefined, message].filter(Boolean).join(' | '));
    }
  }

  for (const item of Object.values(record)) {
    collectNestedSaxoErrors(item, messages);
  }
}
