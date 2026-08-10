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
 * @fastify/http-proxy's WebSocket proxying reads `wsClientOptions.rewriteRequestHeaders`
 * at runtime (its index.js merges it straight into the client options and calls it
 * directly), but the package's published types omit that field entirely — the whole
 * options object it hands to `fastify.register` ends up structurally impossible to
 * satisfy from a caller's side no matter how the value is shaped or cast, so the
 * escape hatch lives in one place, at the actual call, rather than as a per-property
 * cast that still fails the surrounding object's own check.
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
 * CORS locked to one origin (§6). Not `*`: the frontend sends an Authorization
 * header, and a wildcard origin cannot be combined with credentialed requests
 * anyway — so `*` would be both less safe and non-functional.
 */
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
  // A response header a browser cannot read may as well not be sent: `fetch`
  // hides everything outside the CORS-safelist unless it is named here.
  // `retry-after` is the one the 429 above depends on — a frontend backing off
  // would otherwise read null — and `x-cache` is what makes phase 2's cache
  // visible from anywhere other than curl.
  exposedHeaders: [
    'x-request-id',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'retry-after',
    'x-cache',
  ],
});

await app.register(helmet, {
  /**
   * CSP off at the Gateway: it serves JSON, not HTML, so a content policy here
   * protects nothing. It belongs on whatever serves the frontend (phase 5).
   */
  contentSecurityPolicy: false,
});

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook. Null on public routes with no token — see §6. */
    userId: string | null;
  }
}

/**
 * Authentication, once, at the Gateway (§6). Downstream services never
 * re-verify; they read X-User-Id and trust it.
 *
 * Three cases, and the middle one is the one that gets missed:
 *
 *   no token          -> anonymous. Valid: the question bank and /stats are
 *                        public. Falls back to per-IP rate limiting.
 *   broken token      -> 401. Presenting something malformed or expired is an
 *                        attempt to authenticate, and a failed one.
 *   valid token       -> X-User-Id injected from `sub`.
 *
 * A WebSocket upgrade (Collab, from phase 4) is a fourth case in practice: a
 * browser's native WebSocket constructor cannot set an Authorization header,
 * so the token arrives as `?token=` instead. That fallback is read only when
 * the request is actually a WS upgrade, so it never widens how an ordinary
 * HTTP route can be authenticated.
 */
app.addHook('onRequest', async (req, reply) => {
  req.userId = null;

  /**
   * Strip any inbound X-User-Id before doing anything else.
   *
   * Without this line the entire authentication scheme is decorative: a client
   * could send `X-User-Id: <someone else>` and, since downstream services trust
   * the header by design, be that person. Deleting it unconditionally means the
   * only way the header exists downstream is because this file put it there.
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
      /**
       * The reason is logged but not returned. Telling a caller whether a token
       * was expired, forged, or issued for another project is free information
       * about what to try next.
       */
      req.log.warn({ reason: err.reason }, 'token rejected');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    throw err;
  }
});

/**
 * Rate limiting, after authentication, because the bucket a request draws on
 * depends on whether it turned out to be authenticated.
 *
 * Per-user for authenticated traffic and per-IP otherwise (§6). Keying an
 * authenticated request by IP instead would make one user on a shared NAT able
 * to exhaust everyone else's allowance.
 */
app.addHook('onRequest', async (req, reply) => {
  /**
   * Health checks are exempt, and the reason is not tidiness.
   *
   * Registering the health routes in createService *before* this hook exists
   * does not exempt them — Fastify binds hooks to every route at boot, not at
   * registration — so without this line an uptime probe drew from the same
   * anonymous bucket as real traffic. At more than one probe a second it
   * exhausts capacity 60 on its own and a perfectly healthy Gateway starts
   * answering 429, which reads as an outage and, in the CI smoke test, is one
   * loop-count change away from failing the build.
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
     * Fail *open* on a Redis outage, and log it loudly.
     *
     * The alternative — fail closed — turns a cache outage into a total
     * outage. This is a deliberate availability-over-enforcement choice and it
     * is only defensible because the thing being protected is request volume,
     * not money or data. §7's --max-instances still caps the cost of whatever
     * gets through.
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
 * Readiness reflects the dependency this service actually needs. The Gateway
 * holds no database, so Redis is the whole answer — and a Gateway that cannot
 * reach Redis still serves traffic (it fails open above), so this is
 * information for a dashboard rather than a reason to withdraw the instance.
 */
app.get('/health/deps', async () => {
  try {
    await pingRedis(redis);
    return { redis: 'ok' };
  } catch {
    return { redis: 'unreachable' };
  }
});

app.get('/', async () => ({ service: 'gateway', phase: 1 }));

/**
 * Routing (§5). One registration per downstream service.
 *
 * `websocket: true` on collab is needed from phase 4, and is set now because
 * every WebSocket is proxied through here — the tradeoff §5 names explicitly:
 * one collab connection occupies a concurrency slot on the Gateway *and* one on
 * Collab, and the Gateway's slots are shared with every HTTP request in the
 * system.
 */
const ROUTES = [
  { prefix: '/users', service: 'users', websocket: false },
  { prefix: '/questions', service: 'questions', websocket: false },
  { prefix: '/match', service: 'matching', websocket: false },
  { prefix: '/collab', service: 'collab', websocket: true },
] as const;

/**
 * Forward the identity and the trace id. `X-User-Id` is present only if the
 * hook above verified a token; on a public route it is absent, and absent
 * must be read downstream as anonymous rather than as "skip the check" (§6).
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
 * The WebSocket upgrade to the upstream is a *second*, separate proxied
 * connection (@fastify/http-proxy opens it itself), with its own header
 * rewrite hook — `rewriteHttpHeaders` above only applies to the plain HTTP
 * path. The default here forwards nothing but `cookie`, so without this,
 * Collab's `/collab/connect` would never see `X-User-Id` at all and would
 * 401 every socket, authorized or not. Note the reversed argument order
 * versus the HTTP variant — that's the proxy library's own inconsistency,
 * not a typo.
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
    // constructs its WebSocketProxy only when `websocket` is true, so on the
    // other four this is read by nobody.
    wsClientOptions: { rewriteRequestHeaders: rewriteWsHeaders },
  });
}

await start();
