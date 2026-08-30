import { z } from 'zod';
import { HttpError, json } from './http';
import { requireUid } from './auth';
import { isEntitled } from './entitlement';
import { limitByUid } from './rate-limit';
import { stepAccess } from './manifest';
import type { Env } from './env';

const Body = z.object({ done: z.boolean(), starred: z.boolean() }).strict();

/** GET /api/me: the reader's marks and entitlement in one call. */
export async function me(request: Request, env: Env): Promise<Response> {
  const uid = await requireUid(request, env);

  const rowsQuery = env.DB.prepare('SELECT step_id, done, starred FROM progress WHERE uid = ?')
    .bind(uid)
    .all();

  const [rows, entitled] = await Promise.all([rowsQuery, isEntitled(env, uid)]);

  const progress = rows.results.map((row) => ({
    stepId: row.step_id,
    done: Boolean(row.done),
    starred: Boolean(row.starred),
  }));

  return json({ progress, entitled });
}

/**
 * Records one step's checkbox state for the signed-in reader.
 *
 * PUT /api/me/progress/:stepId. Replaces state rather than toggling, so
 * retries are free. Progress works on paid steps too: the content is what
 * is sold, not the checkbox.
 */
export async function putProgress(request: Request, env: Env, stepId: string): Promise<Response> {
  const uid = await requireUid(request, env);

  // Generous: caps a bot loop without touching a human ticking boxes. Worst
  // case past it is quota, which fails safe to 429 with no bill.
  await limitByUid(env.RATE_LIMIT_WRITE, uid);

  const knownSteps = await stepAccess(request, env);

  if (!knownSteps.has(stepId)) {
    throw new HttpError(400, 'no such step');
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = Body.safeParse(rawBody);

  if (!parsed.success) {
    throw new HttpError(400, 'body must be {done, starred}');
  }

  const done = parsed.data.done;
  const starred = parsed.data.starred;

  const statement = env.DB.prepare(
    `INSERT INTO progress (uid, step_id, done, starred) VALUES (?, ?, ?, ?)
     ON CONFLICT (uid, step_id) DO UPDATE
       SET done = excluded.done, starred = excluded.starred,
           updated_at = datetime('now')`,
  );

  await statement.bind(uid, stepId, Number(done), Number(starred)).run();

  return json({ stepId, done, starred });
}
