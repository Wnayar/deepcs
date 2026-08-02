import { describe, expect, it } from 'vitest';
import { createService } from '@deepcs/shared/service';
import { SERVICES } from '@deepcs/shared/services';

describe('collab service', () => {
  it('answers /health/live and /health/ready separately', async () => {
    const { app } = createService({ name: 'collab', port: SERVICES.collab.port });
    await app.ready();

    for (const url of ['/health/live', '/health/ready']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', service: 'collab' });
    }

    await app.close();
  });

  it('propagates an inbound x-request-id instead of minting a new one', async () => {
    const { app } = createService({ name: 'collab', port: SERVICES.collab.port });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'trace-me-across-six-services' },
    });

    expect(res.headers['x-request-id']).toBe('trace-me-across-six-services');
    await app.close();
  });
});
