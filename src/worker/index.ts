import { HttpError, json } from './http';
import { me, putProgress } from './progress';
import { entitlement } from './entitlement';
import { checkout } from './checkout';
import { webhook } from './webhook';
import { servePaid } from './content';
import type { Env } from './env';

/**
 * The entire backend. The platform serves the SPA and free content without
 * invoking this; only /api/* and /content/paid/* run it. No route accepts a
 * uid — /me is whoever the verified token says (DESIGN.md §9).
 */
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      // GET /content/paid/lessons/oop.md -> the file, or 401 / 402
      if (pathname.startsWith('/content/paid/')) return await servePaid(request, env);

      // GET /api/me -> {progress: [{stepId, done, starred}], entitled}
      if (pathname === '/api/me' && method === 'GET') return await me(request, env);
      // GET /api/me/entitlement -> {entitled}
      if (pathname === '/api/me/entitlement' && method === 'GET')
        return await entitlement(request, env);

      // PUT /api/me/progress/oop-1 -> the row as saved
      //   body {"done": true, "starred": false}
      // exec gives null or a match array whose [1] is the captured step id. The
      // character class is a shape filter, not validation: it rejects dots and
      // slashes here, and progress.ts checks the id against the shipped manifest.
      const progress = /^\/api\/me\/progress\/([A-Za-z0-9-]{1,80})$/.exec(pathname);
      if (progress?.[1] && method === 'PUT') return await putProgress(request, env, progress[1]);

      // POST /api/checkout -> {url: 'https://checkout.stripe.com/c/pay/...'}
      if (pathname === '/api/checkout' && method === 'POST') return await checkout(request, env);
      // POST /api/webhooks/stripe -> {received: true}
      //   header Stripe-Signature: t=..,v1=.. (no token)
      //   body {"type": "checkout.session.completed", ...}
      if (pathname === '/api/webhooks/stripe' && method === 'POST')
        return await webhook(request, env);

      return json({ error: 'no such route' }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('unhandled', err instanceof Error ? err.stack : err);
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
