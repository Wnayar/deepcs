import { HttpError } from './http';
import { requireUid } from './auth';
import { isEntitled } from './entitlement';
import type { Env } from './env';

/**
 * GET /content/paid/* — the paywall itself (DESIGN.md §6). These paths are
 * listed in run_worker_first, so the platform never serves them directly;
 * every request lands here, and the file moves only after a token check and
 * one entitlement row read. 401 and 402 carry no content bytes — the lock
 * icon in the UI is presentation, this is the gate.
 */
export async function servePaid(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    throw new HttpError(405, 'method not allowed');

  const uid = await requireUid(request, env);
  if (!(await isEntitled(env, uid))) throw new HttpError(402, 'payment required');

  // The assets binding serves run_worker_first paths happily when asked
  // from inside the Worker; only the platform's direct route skips them.
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) throw new HttpError(404, 'no such file');

  // Entitled bytes must never land in a shared cache.
  const headers = new Headers(asset.headers);
  headers.set('cache-control', 'private, max-age=300');
  return new Response(asset.body, { status: asset.status, headers });
}
