import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { ServiceName } from './services';

/**
 * There is deliberately no `index.ts` barrel re-exporting this file alongside
 * `logger.ts`. tsup inlines @deepcs/shared into every service bundle, and a
 * barrel makes that inlining all-or-nothing: importing the barrel for a logger
 * drags Fastify in too, and Fastify's CommonJS dependencies cannot be
 * tree-shaken back out. The Stats job is not a server and must never import
 * Fastify, which is what forced the subpath exports.
 */

/** What a readiness probe reports: one entry per dependency this service
 * cannot serve without. */
export type ReadinessChecks = Record<string, 'ok' | 'unreachable'>;

/**
 * Turns a dependency ping into the word a health endpoint wants, e.g.
 *   { postgres: await probe(pingDb(pool)) }
 * Swallowing the error is the point: a health route reports a dependency being
 * down, it does not itself fail because one is.
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
   * Dependencies this service cannot answer requests without. Omit it when
   * there are none: the Gateway fails *open* when Redis is down, and Questions
   * treats Redis as a cache, so for both a Redis outage means slower, not
   * broken, and is no reason to leave the rotation.
   */
  ready?: () => Promise<ReadinessChecks>;
}

/**
 * Fastify labels the request id `reqId` in its own log lines. Everything else
 * here — the `X-Request-Id` header, the structured field name — uses
 * `request_id`, and a trace that changes key name halfway through six services
 * is not a trace. In Fastify 5 this is set by subclassing the log controller.
 */
class DeepcsLogController extends LogController {
  constructor() {
    super({ requestIdLogLabel: 'request_id' });
  }
}

/**
 * Every HTTP service is built from this, so none of them can quietly skip one
 * of the four things they all owe: structured JSON logs carrying `service` and
 * `request_id`, an `X-Request-Id` propagated if the caller sent one and minted
 * if not, `/health/live` and `/health/ready` as separate endpoints, and
 * graceful shutdown on SIGTERM.
 */
export function createService({ name, port, ready }: ServiceOptions): {
  app: FastifyInstance;
  start: () => Promise<void>;
} {
  const app = Fastify({
    /**
     * Without this, `req.ip` is the socket's peer address, which behind any
     * proxy is the proxy rather than the caller. Every anonymous request would
     * then share one `rl:ip:` bucket and the per-IP limiter would be a
     * per-*cluster* limiter.
     *
     * `1`, not `true`. A correct proxy *appends* the caller's address to any
     * inbound X-Forwarded-For, so the rightmost entry is the one it vouches for
     * and everything left of it is caller-supplied. `true` trusts the whole
     * chain and takes the leftmost, handing a client a fresh bucket per forged
     * header. `1` trusts exactly the one hop in front. The number is a property
     * of what is actually in front of the service, an Ingress included, so
     * re-check it rather than inheriting it.
     */
    trustProxy: 1,
    requestIdHeader: 'x-request-id',
    // An instance, not the class — Fastify validates this at boot.
    logController: new DeepcsLogController(),
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // A structured-log collector conventionally reads `message` and
      // `severity`, not pino's own `msg`/`level`.
      messageKey: 'message',
      base: { service: name },
      formatters: {
        level: (label) => ({ severity: label.toUpperCase() }),
      },
    },
  });

  // Echo the id back so a browser (and the load script) can correlate too.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  /**
   * Liveness answers "is this process wedged, restart it"; readiness answers
   * "may traffic be routed here yet". A service whose Postgres pool has not
   * connected is live but not ready, and conflating the two means the
   * orchestrator kills a healthy process that is merely still starting.
   *
   * Readiness only means something if it can say no, which is what `ready` is
   * for. A service that declares no dependencies answers 200 unconditionally,
   * and says so by omitting `checks` rather than returning an empty object that
   * looks like a probe that ran and found nothing.
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
     * Kubernetes and `docker stop` both send SIGTERM and then wait;
     * `app.close()` stops accepting new connections and lets in-flight requests
     * finish. Without this, replacing a pod severs whatever was mid-flight.
     *
     * Registered here rather than at construction because these are
     * *process*-wide handlers, and a test building ten app instances would
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
