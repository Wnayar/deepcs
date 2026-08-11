import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { ServiceName } from './services';

/**
 * There is deliberately no `index.ts` barrel re-exporting this file alongside
 * `logger.ts`. tsup inlines @deepcs/shared into every service bundle, and a
 * barrel makes that inlining all-or-nothing: importing the barrel for a logger
 * drags Fastify in too, and because Fastify and its dependencies are CommonJS,
 * esbuild cannot tree-shake them back out. The Stats job — which is not a
 * server and must never import Fastify — is what forced the subpath exports.
 */

/** What a readiness probe reports: one entry per dependency this service
 * cannot serve without. */
export type ReadinessChecks = Record<string, 'ok' | 'unreachable'>;

/**
 * Turns a dependency ping into the word a health endpoint wants — e.g.
 *   { postgres: await probe(pingDb(pool)) }
 * Swallowing the error is the point: a health route reports a dependency
 * being down, it does not itself fail because one is.
 */
export async function probe(check: Promise<unknown>): Promise<'ok' | 'unreachable'> {
  try {
    await check;
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

export interface ServiceOptions {
  name: ServiceName;
  port: number;
  /**
   * Dependencies that must be reachable for this service to answer requests
   * at all. Omit it when there are none — that is a real answer, not a gap.
   * The Gateway omits it on purpose: it fails *open* when Redis is down
   * (see its rate-limit hook), so a Redis outage is not a reason to take it
   * out of rotation. Questions omits Redis for the same reason — the cache
   * being down makes it slower, not broken.
   */
  ready?: () => Promise<ReadinessChecks>;
}

/**
 * Fastify's internal log lines label the request id `reqId`. Everything else in
 * this system — the `X-Request-Id` header, the structured field name in
 * the overview §6 — uses `request_id`, and a trace that changes key name halfway
 * through six services is not a trace.
 *
 * In Fastify 5 this is set by subclassing the log controller; the older
 * top-level `requestIdLogLabel` option still works but is deprecated and goes
 * away in Fastify 6.
 */
class DeepcsLogController extends LogController {
  constructor() {
    super({ requestIdLogLabel: 'request_id' });
  }
}

/**
 * Every HTTP service in DeepCS is built from this. It fixes the four things
 * the overview §6 requires of all of them, so no service can quietly skip one:
 *
 *   1. Structured JSON logs carrying `service` and `request_id`.
 *   2. An `X-Request-Id` that is *propagated* if the caller sent one and minted
 *      if not — the thing that makes a six-service request path traceable.
 *   3. `/health/live` and `/health/ready` as separate endpoints.
 *   4. Graceful shutdown on SIGTERM.
 */
export function createService({ name, port, ready }: ServiceOptions): {
  app: FastifyInstance;
  start: () => Promise<void>;
} {
  const app = Fastify({
    /**
     * Without this, `req.ip` is the socket's peer address — which behind any
     * proxy is the proxy, not the caller. On the cluster that is the ingress
     * controller. Every anonymous request would then share one `rl:ip:` bucket
     * and the per-IP limiter in §6 would be a per-*cluster* limiter: one client
     * spending 60 tokens locks out everyone. It looks correct under compose
     * only because compose publishes the port directly, so the peer really is
     * the client.
     *
     * `1`, not `true`. A proxy that behaves correctly *appends* the caller's
     * address to any inbound X-Forwarded-For rather than replacing it, so the
     * rightmost entry is the one it vouches for and everything left of it is
     * caller-supplied. `true` trusts the whole chain and takes the leftmost —
     * which a client sets themselves, handing them a fresh bucket per forged
     * header and removing the limit entirely. `1` trusts exactly the one hop in
     * front of us. Re-check the number against whatever actually sits in front
     * of the service, an Ingress included; it is a property of how it is run,
     * not of Fastify.
     */
    trustProxy: 1,
    requestIdHeader: 'x-request-id',
    // An instance, not the class — Fastify validates this at boot.
    logController: new DeepcsLogController(),
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // The keys a structured-log collector conventionally reads are `message`
      // and `severity`, not pino's own `msg`/`level`.
      messageKey: 'message',
      base: { service: name },
      formatters: {
        level: (label) => ({ severity: label.toUpperCase() }),
      },
    },
  });

  // Echo the id back so a browser (and k6, §8) can correlate too.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  /**
   * Liveness vs readiness is not ceremony, and the split matters more here than
   * it looks. Liveness answers "is this process wedged, restart it"; readiness
   * answers "may traffic be routed here yet". A service whose Postgres pool has
   * not connected is *live* but not *ready* — conflating them means the
   * orchestrator kills a healthy process that is merely still starting up.
   *
   * Readiness only means something if it can say *no*, which is what the
   * optional `ready` probe is for. A service that passes one and cannot reach
   * a dependency answers 503 here, so it stops receiving traffic it would only
   * fail. A service that passes none answers 200 unconditionally — and says so
   * by omitting `checks` rather than returning an empty object that looks like
   * a check that ran and found nothing.
   */
  app.get('/health/live', async () => ({ status: 'ok', service: name }));

  app.get('/health/ready', async (_req, reply) => {
    if (!ready) return { status: 'ok', service: name };

    let checks: ReadinessChecks;
    try {
      checks = await ready();
    } catch (err) {
      app.log.error({ err }, 'readiness probe threw');
      return reply.code(503).send({ status: 'degraded', service: name });
    }

    if (Object.values(checks).some((state) => state !== 'ok')) {
      return reply.code(503).send({ status: 'degraded', service: name, checks });
    }
    return { status: 'ok', service: name, checks };
  });

  const start = async (): Promise<void> => {
    /**
     * Graceful shutdown (the overview §6). Kubernetes and `docker stop` both send
     * SIGTERM and then wait; `app.close()` stops accepting new connections and
     * lets in-flight requests finish. Without this, replacing a pod severs
     * whatever was mid-flight, which is exactly what the disruption check in
     * k8s/disruption-check.sh measures.
     *
     * Registered here rather than at construction on purpose: these are
     * *process*-wide handlers, and a test that builds ten app instances would
     * otherwise leave ten SIGTERM listeners on one process.
     */
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        app.log.info({ signal }, 'shutting down');
        app.close().then(
          () => process.exit(0),
          (err: unknown) => {
            app.log.error({ err }, 'error during shutdown');
            process.exit(1);
          },
        );
      });
    }

    // PORT is honoured when the environment sets it, which is how a container
    // is told where to listen; the value in SERVICES is the compose default.
    const listenPort = process.env.PORT ? Number(process.env.PORT) : port;

    // 0.0.0.0, not localhost: inside a container, binding the loopback
    // interface makes the service unreachable from anywhere outside it.
    await app.listen({ port: listenPort, host: '0.0.0.0' });
  };

  return { app, start };
}
