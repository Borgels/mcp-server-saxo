export type SaxoEnvironment = 'sim' | 'live';

export interface SaxoEnvironmentEndpoints {
  apiBase: string;
  streamingBase: string;
  authorize: string;
  token: string;
}

const ENDPOINTS: Record<SaxoEnvironment, SaxoEnvironmentEndpoints> = {
  sim: {
    apiBase: 'https://gateway.saxobank.com/sim/openapi',
    streamingBase: 'https://streaming.saxobank.com/sim/openapi',
    authorize: 'https://sim.logonvalidation.net/authorize',
    token: 'https://sim.logonvalidation.net/token',
  },
  live: {
    apiBase: 'https://gateway.saxobank.com/openapi',
    streamingBase: 'https://streaming.saxobank.com/openapi',
    authorize: 'https://live.logonvalidation.net/authorize',
    token: 'https://live.logonvalidation.net/token',
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
