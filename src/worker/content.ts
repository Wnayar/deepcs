import { HttpError } from './http';
import { requireUid } from './auth';
import { isEntitled } from './entitlement';
import type { Env } from './env';

/**
 * Serves one paid file to a buyer, or refuses without spending any bytes.
 *
 * GET /content/paid/*: the paywall. These paths are in run_worker_first, so
 * the platform never serves them directly; the file moves only after a
 * token check and one entitlement read, and 401/402 carry no content bytes.
 */
export async function servePaid(request: Request, env: Env): Promise<Response> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';

  if (!isRead) {
    throw new HttpError(405, 'method not allowed');
  }

  const uid = await requireUid(request, env);
  const entitled = await isEntitled(env, uid);

  if (!entitled) {
    throw new HttpError(402, 'payment required');
  }

  const asset = await env.ASSETS.fetch(request);

  if (!asset.ok) {
    throw new HttpError(404, 'no such file');
  }

  // Entitled bytes must never land in a shared cache.
  const headers = new Headers(asset.headers);
  headers.set('cache-control', 'private, max-age=300');

  return new Response(asset.body, { status: asset.status, headers });
}
