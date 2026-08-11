import { describe, expect, it } from 'vitest';
import { createService } from './service.js';
import { SERVICES, type ServiceName } from './services.js';

/**
 * `createService` is compiled into all six images, so a bug here is a bug
 * everywhere. This used to live as five byte-identical `health.test.ts` files,
 * one per service — which tested this file five times under five different
 * name strings and tested the services themselves not at all.
 *
 * Needs no Postgres or Redis: everything here goes through `app.inject`, so
 * the CI lint job runs it rather than the matrix job that provisions both.
 */
const HTTP_SERVICES = (Object.keys(SERVICES) as ServiceName[]).filter(
  (name) => SERVICES[name].port !== null,
);

describe('createService', () => {
  it.each(HTTP_SERVICES)('answers /health/live and /health/ready for %s', async (name) => {
    const { app } = createService({ name, port: SERVICES[name].port! });
    await app.ready();

    for (const url of ['/health/live', '/health/ready']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', service: name });
    }

    await app.close();
  });

  it('propagates an inbound x-request-id instead of minting a new one', async () => {
    const { app } = createService({ name: 'gateway', port: SERVICES.gateway.port! });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'trace-me-across-six-services' },
    });

    expect(res.headers['x-request-id']).toBe('trace-me-across-six-services');
    await app.close();
  });

  it('mints a request id when the caller sent none', async () => {
    const { app } = createService({ name: 'gateway', port: SERVICES.gateway.port! });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health/live' });

    expect(res.headers['x-request-id']).toBeTruthy();
    await app.close();
  });

  it('reports no checks at all when a service declares no dependencies', async () => {
    const { app } = createService({ name: 'gateway', port: SERVICES.gateway.port! });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    // Not `checks: {}` — an empty object reads like a probe that ran and found
    // nothing, when in fact none was configured.
    expect(res.json()).not.toHaveProperty('checks');
    await app.close();
  });

  it('is ready when every declared dependency answers', async () => {
    const { app } = createService({
      name: 'users',
      port: SERVICES.users.port!,
      ready: async () => ({ postgres: 'ok' }),
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { postgres: 'ok' } });
    await app.close();
  });

  /**
   * The point of readiness: it has to be able to say no. Answering 200 with a
   * dead database means the orchestrator keeps routing traffic this instance
   * can only turn into 500s.
   */
  it('is 503 when a declared dependency is unreachable', async () => {
    const { app } = createService({
      name: 'users',
      port: SERVICES.users.port!,
      ready: async () => ({ postgres: 'unreachable' }),
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { postgres: 'unreachable' } });
    await app.close();
  });

  it('is 503, not a 500, when the probe itself throws', async () => {
    const { app } = createService({
      name: 'users',
      port: SERVICES.users.port!,
      ready: async () => {
        throw new Error('pool exploded');
      },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('stays live even when readiness is failing', async () => {
    // Liveness must not follow readiness: a service waiting on a dependency
    // is not a wedged process, and restarting it fixes nothing.
    const { app } = createService({
      name: 'users',
      port: SERVICES.users.port!,
      ready: async () => ({ postgres: 'unreachable' }),
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health/live' });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  /**
   * The regression test for the reason `trustProxy` is set at all. Without it
   * `req.ip` is the socket's peer — which behind any proxy is the proxy, not
   * the caller — and every anonymous request would share one per-IP rate-limit
   * bucket.
   */
  it('reads the client address from X-Forwarded-For', async () => {
    const { app } = createService({ name: 'gateway', port: SERVICES.gateway.port! });
    app.get('/whoami', async (req) => ({ ip: req.ip }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });

    expect(res.json()).toEqual({ ip: '203.0.113.7' });
    await app.close();
  });

  /**
   * `trustProxy: 1` and not `true`: a caller can put anything in
   * X-Forwarded-For, and whatever sits in front of us appends rather than
   * replaces. Only the rightmost entry is vouched for, so a forged one to its
   * left must be ignored — otherwise a client mints a fresh rate-limit bucket
   * per request just by varying the header.
   */
  it('ignores a forged X-Forwarded-For entry to the left of the real one', async () => {
    const { app } = createService({ name: 'gateway', port: SERVICES.gateway.port! });
    app.get('/whoami', async (req) => ({ ip: req.ip }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.7' },
    });

    expect(res.json()).toEqual({ ip: '203.0.113.7' });
    await app.close();
  });
});
