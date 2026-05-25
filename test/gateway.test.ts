import { describe, expect, it } from 'vitest';
import { createSaxoGateway, saxoGatewayTools } from '../src/gateway.js';

describe('Saxo gateway export', () => {
  it('exposes a curated read-only portfolio surface', () => {
    expect(saxoGatewayTools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'session_me',
      'search_instruments',
      'list_positions',
    ]));
    expect(saxoGatewayTools.every(tool => tool.riskLevel === 'read')).toBe(true);
  });

  it('supports local capability search without upstream calls', async () => {
    const gateway = createSaxoGateway({ accessToken: 'token' });
    const result = await gateway.callTool('capabilities', { query: 'positions' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeTruthy();
  });
});
