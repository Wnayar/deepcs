import { describe, expect, it } from 'vitest';
import { SELF, applyD1Migrations, env } from 'cloudflare:test';

/** The platform promises the app leans on: the SPA deep-link rewrite, free
 * content bypassing the Worker entirely, and repeatable migrations
 * (DESIGN.md §15.2). */

const base = 'https://deepcs.test';

describe('the deployment shape', () => {
  it('serves index.html with a 200 for an unknown path (the deep-link promise)', async () => {
    const res = await SELF.fetch(`${base}/step/anything-at-all`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('serves free content publicly, no token anywhere', async () => {
    const roadmap = await SELF.fetch(`${base}/content/roadmap.json`);
    expect(roadmap.status).toBe(200);

    const lesson = await SELF.fetch(`${base}/content/lessons/sample-processes-1.md`);
    expect(lesson.status).toBe(200);
    expect(await lesson.text()).toContain('sample content');
  });

  it('does not list paid steps in the free questions file', async () => {
    const res = await SELF.fetch(`${base}/content/questions.json`);
    const body = (await res.json()) as { steps: { id: string }[] };
    expect(body.steps.some((s) => s.id.startsWith('sample-premium'))).toBe(false);
  });

  it('404s unknown API routes as JSON, not as the SPA', async () => {
    const res = await SELF.fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('json');
  });

  it('applies migrations twice cleanly', async () => {
    // Setup already applied them once; a second pass must be a no-op.
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('progress', 'entitlements')",
    ).all();
    expect(tables.results.length).toBe(2);
  });
});
