import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import proxy from '@fastify/http-proxy';
import { createService } from '@deepcs/shared/service';
import { USER_ID_HEADER } from '@deepcs/shared/headers';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { SERVICES } from '@deepcs/shared/services';
import { bearerToken, createVerifier, queryToken, TokenError } from './auth.js';
import { BUCKETS, createRateLimiter } from './rate-limit.js';

const { app, start } = createService({ name: 'gateway', port: SERVICES.gateway.port });

/**
 * @fastify/http-proxy reads `wsClientOptions.rewriteRequestHeaders` at runtime
 * but omits the field from its published types, which makes the whole options
 * object impossible to satisfy from a caller's side. The cast lives here, at
 * the one call, rather than as a per-property cast that still fails the
 * surrounding object's own check.
 */
async function registerProxyRoute(options: Record<string, unknown>): Promise<void> {
  await app.register(proxy, options as unknown as Parameters<typeof proxy>[1]);
}

const redis = createRedis();
const limiter = createRateLimiter(redis);
const verify = createVerifier({
  projectId: process.env.FIREBASE_PROJECT_ID ?? '',
  emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
});

/**
 * One origin, not `*`: the frontend sends an Authorization header, and a
 * wildcard origin cannot be combined with credentialed requests anyway, so `*`
 * would be both less safe and non-functional.
 */
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
  /**
   * Listed, because the plugin's default is `GET,HEAD,POST` and a method left
   * out of it is refused by the *browser*, in the preflight, before the request
   * is ever sent. Nothing reaches a log and the server looks innocent: curl
   * sends no preflight, so the same call succeeds from a terminal and fails in
   * a tab. That is exactly how `PUT /users/me/progress/:questionId` shipped
   * broken. Adding a method to the API means adding it here.
   */
  methods: ['GET', 'HEAD', 'POST', 'PUT'],
  // A response header a browser cannot read may as well not be sent: `fetch`
  // hides everything outside the CORS-safelist unless it is named here. The
  // frontend backs off on `retry-after` and would otherwise read null.
  exposedHeaders: [
    'x-request-id',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'retry-after',
    'x-cache',
  ],
});

await app.register(helmet, {
  // The Gateway serves JSON, not HTML, so a content policy here protects
  // nothing. It belongs on whatever serves the frontend, which is where it is
  // (frontend/vite.config.ts).
  contentSecurityPolicy: false,
});

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook. Null on public routes with no token. */
    userId: string | null;
  }
}

/**
 * Authentication, once, here. Downstream services never re-verify; they read
 * X-User-Id and trust it. Three cases, and the middle one gets missed:
 *
 *   no token      -> anonymous. Valid: the bank, the roadmap and /stats are
 *                    public. Falls back to per-IP rate limiting.
 *   broken token  -> 401. Presenting something malformed or expired is an
 *                    attempt to authenticate, and a failed one.
 *   valid token   -> X-User-Id injected from `sub`.
 *
 * A WebSocket upgrade is a fourth case: a browser's native WebSocket
 * constructor cannot set an Authorization header, so the token arrives as
 * `?token=`. That fallback is read only for an actual upgrade, so it never
 * widens how an ordinary HTTP route can be authenticated.
 */
app.addHook('onRequest', async (req, reply) => {
  req.userId = null;

  /**
   * Without this line the entire scheme is decorative: a client could send
   * `X-User-Id: <someone else>` and, since downstream services trust the header
   * by design, be that person. Deleting it unconditionally means the only way
   * the header exists downstream is because this file put it there.
   */
  delete req.headers[USER_ID_HEADER];

  const isWebSocketUpgrade = req.headers.upgrade?.toLowerCase() === 'websocket';
  const token =
    bearerToken(req.headers.authorization) ?? (isWebSocketUpgrade ? queryToken(req.query) : null);
  if (token === null) return;

  try {
    const { uid } = await verify(token);
    req.userId = uid;
    req.headers[USER_ID_HEADER] = uid;
  } catch (err) {
    if (err instanceof TokenError) {
      // The reason is logged, not returned. Telling a caller whether a token
      // was expired, forged, or issued for another project is free information
      // about what to try next.
      req.log.warn({ reason: err.reason }, 'token rejected');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    throw err;
  }
});

/**
 * Rate limiting runs *after* authentication, because which bucket a request
 * draws on depends on whether it turned out to be authenticated. Keying an
 * authenticated request by IP would let one user on a shared NAT exhaust
 * everyone else's allowance.
 */
app.addHook('onRequest', async (req, reply) => {
  /**
   * Health checks are exempt, and not for tidiness. Registering those routes in
   * createService before this hook exists does not exempt them — Fastify binds
   * hooks to every route at boot — so without this line an uptime probe draws
   * from the same anonymous bucket as real traffic, and at more than one probe
   * a second it exhausts capacity 60 on its own. A healthy Gateway then answers
   * 429, which reads as an outage.
   */
  if (req.url.startsWith('/health')) return;

  const [key, bucket] = req.userId
    ? [`rl:user:${req.userId}`, BUCKETS.user]
    : [`rl:ip:${req.ip}`, BUCKETS.ip];

  let result;
  try {
    result = await limiter.consume(key, bucket);
  } catch (err) {
    /**
     * Fail *open* on a Redis outage, and log it loudly. Failing closed turns a
     * cache outage into a total outage. This is a deliberate
     * availability-over-enforcement choice, defensible only because the thing
     * being protected is request volume rather than money or data.
     */
    req.log.error({ err }, 'rate limiter unavailable; allowing request');
    return;
  }

  reply.header('x-ratelimit-limit', result.limit);
  reply.header('x-ratelimit-remaining', result.remaining);

  if (!result.allowed) {
    reply.header('retry-after', Math.ceil(result.retryAfterMs / 1000));
    return reply.code(429).send({ error: 'rate limit exceeded' });
  }
});

/**
 * Redis state as information rather than as a readiness answer. The Gateway
 * holds no database, and it still serves traffic when Redis is down because the
 * limiter fails open above — so this is for a dashboard, not a reason to
 * withdraw the instance. That is why `createService` was given no `ready`.
 */
app.get('/health/deps', async () => {
  try {
    await pingRedis(redis);
    return { redis: 'ok' };
  } catch {
    return { redis: 'unreachable' };
  }
});

app.get('/', async () => ({ service: 'gateway' }));

/**
 * The routing table, and it is a security boundary rather than a convenience: a
 * prefix is forwarded wholesale with no filtering on what follows, so every
 * path under a listed prefix is reachable from a browser. That is why the route
 * releasing a reference answer sits under `/internal`, which nothing proxies.
 *
 * Three prefixes reach Questions, one per screen it feeds. They could have been
 * one, but everything under `/questions/` takes a uuid as its next segment, and
 * a prefix meaning "read the material" should not be nested inside one meaning
 * "read a question".
 *
 * `websocket: true` on collab is what makes the upgrade proxy at all. Every
 * socket is proxied here, so one collab connection occupies a concurrency slot
 * on the Gateway *and* one on Collab, and the Gateway's slots are shared with
 * every HTTP request in the system.
 */
const ROUTES = [
  { prefix: '/users', service: 'users', websocket: false },
  { prefix: '/questions', service: 'questions', websocket: false },
  { prefix: '/roadmap', service: 'questions', websocket: false },
  { prefix: '/steps', service: 'questions', websocket: false },
  { prefix: '/match', service: 'matching', websocket: false },
  { prefix: '/collab', service: 'collab', websocket: true },
  // Both reach the Stats read server. A session's summary is under `/sessions`
  // because it is about one session rather than the whole system.
  { prefix: '/stats', service: 'stats', websocket: false },
  { prefix: '/sessions', service: 'stats', websocket: false },
] as const;

/**
 * Forward the identity and the trace id. `X-User-Id` is present only if the
 * hook above verified a token; on a public route it is absent, and absent must
 * be read downstream as anonymous rather than as "skip the check".
 */
function rewriteHttpHeaders(req: unknown, headers: Record<string, unknown>) {
  return {
    ...headers,
    'x-request-id': String((req as { id: unknown }).id),
    ...((req as { userId: string | null }).userId
      ? { [USER_ID_HEADER]: (req as { userId: string }).userId }
      : {}),
  };
}

/**
 * A WebSocket upgrade opens a *second*, separate proxied connection with its
 * own header rewrite hook, and its default forwards nothing but `cookie` — so
 * without this Collab would never see `X-User-Id` and would 401 every socket,
 * authorized or not. The reversed argument order against the HTTP variant is
 * the proxy library's own inconsistency, not a typo.
 */
function rewriteWsHeaders(headers: Record<string, unknown>, req: unknown) {
  return rewriteHttpHeaders(req, headers);
}

for (const route of ROUTES) {
  const host =
    process.env[`${route.service.toUpperCase()}_URL`] ??
    `http://${route.service}:${SERVICES[route.service].port}`;

  await registerProxyRoute({
    upstream: host,
    prefix: route.prefix,
    rewritePrefix: route.prefix,
    websocket: route.websocket,
    replyOptions: { rewriteRequestHeaders: rewriteHttpHeaders },
    // Passed on every route rather than only the WebSocket one: http-proxy
    // builds its WebSocketProxy only when `websocket` is true, so elsewhere
    // this is read by nobody.
    wsClientOptions: { rewriteRequestHeaders: rewriteWsHeaders },
  });
}

await start();
