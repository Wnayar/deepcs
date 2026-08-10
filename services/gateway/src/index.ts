import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import proxy from '@fastify/http-proxy';
import { createService } from '@deepcs/shared/service';
import { USER_ID_HEADER } from '@deepcs/shared/headers';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { SERVICES } from '@deepcs/shared/services';
import { bearerToken, createVerifier, TokenError } from './auth.js';
import { BUCKETS, createRateLimiter } from './rate-limit.js';

const { app, start } = createService({ name: 'gateway', port: SERVICES.gateway.port });

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
  exposedHeaders: ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining'],
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

  const token = bearerToken(req.headers.authorization);
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

for (const route of ROUTES) {
  const host =
    process.env[`${route.service.toUpperCase()}_URL`] ??
    `http://${route.service}:${SERVICES[route.service].port}`;

  await app.register(proxy, {
    upstream: host,
    prefix: route.prefix,
    rewritePrefix: route.prefix,
    websocket: route.websocket,
    replyOptions: {
      /**
       * Forward the identity and the trace id. `X-User-Id` is present only if
       * the hook above verified a token; on a public route it is absent, and
       * absent must be read downstream as anonymous rather than as "skip the
       * check" (§6).
       */
      rewriteRequestHeaders: (req, headers) => ({
        ...headers,
        'x-request-id': String(req.id),
        ...((req as unknown as { userId: string | null }).userId
          ? { [USER_ID_HEADER]: (req as unknown as { userId: string }).userId }
          : {}),
      }),
    },
  });
}

await start();
