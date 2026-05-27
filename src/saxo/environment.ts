export type SaxoEnvironment = 'sim' | 'live';

export interface SaxoEnvironmentEndpoints {
  apiBase: string;
  authorize: string;
  token: string;
  streamingWs: string;
}

const ENDPOINTS: Record<SaxoEnvironment, SaxoEnvironmentEndpoints> = {
  sim: {
    apiBase: 'https://gateway.saxobank.com/sim/openapi',
    authorize: 'https://sim.logonvalidation.net/authorize',
    token: 'https://sim.logonvalidation.net/token',
    streamingWs: 'https://sim-streaming.saxobank.com/sim/oapi/streaming/ws',
  },
  live: {
    apiBase: 'https://gateway.saxobank.com/openapi',
    authorize: 'https://live.logonvalidation.net/authorize',
    token: 'https://live.logonvalidation.net/token',
    streamingWs: 'https://live-streaming.saxobank.com/oapi/streaming/ws',
  },
};

export function resolveEnvironment(value: string | undefined): SaxoEnvironment {
  const normalized = (value ?? 'sim').trim().toLowerCase();
  if (normalized === 'live') {
    return 'live';
  }
  if (normalized === 'sim' || normalized === '') {
    return 'sim';
  }
  throw new Error(
    `SAXO_ENVIRONMENT must be 'sim' or 'live' (got ${JSON.stringify(value)}).`,
  );
}

export function getEnvironmentEndpoints(environment: SaxoEnvironment): SaxoEnvironmentEndpoints {
  return ENDPOINTS[environment];
}
