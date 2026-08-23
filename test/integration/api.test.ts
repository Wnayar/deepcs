import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { mintToken } from './helpers';

/** The trust boundary and the progress API. Every token is really signed
 * and verified; the failing ones are wrong in exactly one claim. */

const base = 'https://deepcs.test';

async function put(token: string, stepId: string, body: unknown) {
  return SELF.fetch(`${base}/api/me/progress/${stepId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('the trust boundary', () => {
  it('refuses a request with no token', async () => {
    const res = await SELF.fetch(`${base}/api/me`);
    expect(res.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    const token = await mintToken('user-a', { expired: true });
    const res = await SELF.fetch(`${base}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('refuses a validly-signed token for a different project (the audience check)', async () => {
    const token = await mintToken('user-a', {
      aud: 'somebody-elses-project',
      iss: 'https://securetoken.google.com/somebody-elses-project',
    });
    const res = await SELF.fetch(`${base}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('progress', () => {
  it('round-trips a mark', async () => {
    const token = await mintToken('user-a');
    const putRes = await put(token, 'sample-processes-1', { done: true, starred: false });
    expect(putRes.status).toBe(200);

    const me = await SELF.fetch(`${base}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { progress: unknown[]; entitled: boolean };
    expect(body.progress).toEqual([{ stepId: 'sample-processes-1', done: true, starred: false }]);
    expect(body.entitled).toBe(false);
  });

  it('is idempotent: the same mark twice is one row with the latest values', async () => {
    const token = await mintToken('user-a');
    await put(token, 'sample-processes-1', { done: true, starred: false });
    await put(token, 'sample-processes-1', { done: true, starred: true });

    const rows = await env.DB.prepare(
      "SELECT done, starred FROM progress WHERE uid = 'user-a'",
    ).all();
    expect(rows.results).toEqual([{ done: 1, starred: 1 }]);
  });

  it('rejects a step id the roadmap does not know, writing nothing', async () => {
    const token = await mintToken('user-a');
    const res = await put(token, 'not-a-real-step', { done: true, starred: false });
    expect(res.status).toBe(400);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM progress').first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });

  it('rejects a body that is not exactly two booleans', async () => {
    const token = await mintToken('user-a');
    const res = await put(token, 'sample-processes-1', { done: 'yes', starred: false });
    expect(res.status).toBe(400);
  });

  it('keeps two users apart', async () => {
    const a = await mintToken('user-a');
    const b = await mintToken('user-b');
    await put(a, 'sample-processes-1', { done: true, starred: false });

    const me = await SELF.fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${b}` } });
    const body = (await me.json()) as { progress: unknown[] };
    expect(body.progress).toEqual([]);
  });
});
