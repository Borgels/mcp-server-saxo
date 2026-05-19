import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

export async function upsertEnvFile(path: string, entries: Record<string, string>): Promise<void> {
  let lines: string[] = [];
  if (existsSync(path)) {
    const existing = await readFile(path, 'utf8');
    lines = existing.split('\n');
  }

  const remaining = new Map(Object.entries(entries));

  const next = lines.map(line => {
    const match = /^([A-Z0-9_]+)\s*=/.exec(line);
    if (!match) {
      return line;
    }
    const key = match[1] as string;
    if (remaining.has(key)) {
      const value = remaining.get(key) as string;
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });

  for (const [key, value] of remaining) {
    next.push(`${key}=${value}`);
  }

  while (next.length > 0 && next[next.length - 1] === '') {
    next.pop();
  }

  await writeFile(path, `${next.join('\n')}\n`, 'utf8');
}
