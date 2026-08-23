import { z } from 'zod';
import { HttpError, json } from './http';
import { requireUid } from './auth';
import { isEntitled } from './entitlement';
import { stepAccess } from './manifest';
import type { Env } from './env';

/** Exactly two booleans; anything else is a 400 before any SQL. */
const Body = z.object({ done: z.boolean(), starred: z.boolean() }).strict();

/** GET /api/me — the reader's marks and their entitlement, in one call,
 * because every signed-in page load wants both (DESIGN.md §3). */
export async function me(request: Request, env: Env): Promise<Response> {
  const uid = await requireUid(request, env);
  const [rows, entitled] = await Promise.all([
    env.DB.prepare('SELECT step_id, done, starred FROM progress WHERE uid = ?').bind(uid).all(),
    isEntitled(env, uid),
  ]);
  return json({
    progress: rows.results.map((r) => ({
      stepId: r.step_id,
      done: Boolean(r.done),
      starred: Boolean(r.starred),
    })),
    entitled,
  });
}

/** PUT /api/me/progress/:stepId — replaces state rather than toggling it,
 * so the same call twice lands on the same row and retries are free.
 * Progress is free for everyone, paid steps included: the content is what
 * is sold, not the checkbox (DESIGN.md §7). */
export async function putProgress(
  request: Request,
  env: Env,
  stepId: string,
): Promise<Response> {
  const uid = await requireUid(request, env);

  if (!(await stepAccess(request, env)).has(stepId))
    throw new HttpError(400, 'no such step');

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'body must be {done, starred}');
  const { done, starred } = parsed.data;

  await env.DB.prepare(
    `INSERT INTO progress (uid, step_id, done, starred) VALUES (?, ?, ?, ?)
     ON CONFLICT (uid, step_id) DO UPDATE
       SET done = excluded.done, starred = excluded.starred,
           updated_at = datetime('now')`,
  )
    .bind(uid, stepId, Number(done), Number(starred))
    .run();

  return json({ stepId, done, starred });
}
