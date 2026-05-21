// MCPB / Desktop Extension manifests declare every user_config field's env
// var in the spawned process's environment with a `${user_config.NAME}`
// template. Claude Desktop substitutes the template with the user's value
// when the user_config field is set — but if the field is OPTIONAL and the
// user leaves it blank, the literal placeholder string is passed through
// to the child process unchanged. Calling code that does
// `process.env.SAXO_POLICY_PATH` then receives the string
// "${user_config.SAXO_POLICY_PATH}" and tries to use it as a real path /
// token / boolean, which breaks everything.
//
// We treat any env value that still looks like a template placeholder as
// unset. This is safe because no real Saxo credential or path begins with
// "${user_config.".

const PLACEHOLDER_PREFIX = '${user_config.';

export function isUnresolvedUserConfigPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PLACEHOLDER_PREFIX);
}

/**
 * Read an env var, returning `undefined` if it's missing OR if it's still
 * an unresolved MCPB user_config template.
 */
export function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (isUnresolvedUserConfigPlaceholder(raw)) {
    return undefined;
  }
  return raw;
}

/**
 * Read a boolean env var. Unresolved placeholders are treated as the
 * fallback value.
 */
export function readBoolEnv(name: string, fallback = false): boolean {
  const raw = readEnv(name);
  if (raw === undefined) {
    return fallback;
  }
  return raw.trim().toLowerCase() === 'true';
}

/**
 * Read a numeric env var. Unresolved placeholders or non-numeric values
 * return the fallback.
 */
export function readNumberEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
