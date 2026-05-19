import type { SaxoClient } from './client.js';

export interface SaxoSessionInfo {
  ClientKey?: string;
  UserKey?: string;
  Culture?: string;
  Language?: string;
  [key: string]: unknown;
}

export function getSessionMe(client: SaxoClient): Promise<SaxoSessionInfo> {
  return client.get<SaxoSessionInfo>('/root/v1/sessions/me');
}

export function getDiagnostics(client: SaxoClient): Promise<unknown> {
  return client.get('/root/v1/diagnostics/get');
}
