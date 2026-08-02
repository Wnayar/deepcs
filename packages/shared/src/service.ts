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

export interface ServiceOptions {
  name: ServiceName;
  port: number;
}

/**
 * Fastify's internal log lines label the request id `reqId`. Everything else in
 * this system — the `X-Request-Id` header, the structured field name in
 * DESIGN.md §6 — uses `request_id`, and a trace that changes key name halfway
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
 * DESIGN.md §6 requires of all of them, so no service can quietly skip one:
 *
 *   1. Structured JSON logs carrying `service` and `request_id`.
 *   2. An `X-Request-Id` that is *propagated* if the caller sent one and minted
 *      if not — the thing that makes a six-service request path traceable.
 *   3. `/health/live` and `/health/ready` as separate endpoints.
 *   4. Graceful shutdown on SIGTERM.
 */
export function createService({ name, port }: ServiceOptions): {
  app: FastifyInstance;
  start: () => Promise<void>;
} {
  const app = Fastify({
    requestIdHeader: 'x-request-id',
    // An instance, not the class — Fastify validates this at boot.
    logController: new DeepcsLogController(),
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Cloud Logging reads `message` and `severity`, not pino's `msg`/`level`.
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
   * At phase 0 there are no dependencies to check, so readiness is trivially
   * true. Phase 1 gives it real work.
   */
  app.get('/health/live', async () => ({ status: 'ok', service: name }));
  app.get('/health/ready', async () => ({ status: 'ok', service: name, checks: {} }));

  const start = async (): Promise<void> => {
    /**
     * Graceful shutdown (DESIGN.md §6). Cloud Run sends SIGTERM and then waits;
     * `app.close()` stops accepting new connections and lets in-flight requests
     * finish. Without this, a deploy severs whatever was mid-flight.
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

    // Cloud Run injects PORT and expects the container to honour it; the value
    // in SERVICES is only the local-compose default (DESIGN.md §7).
    const listenPort = process.env.PORT ? Number(process.env.PORT) : port;

    // 0.0.0.0, not localhost: inside a container, binding the loopback
    // interface makes the service unreachable from anywhere outside it.
    await app.listen({ port: listenPort, host: '0.0.0.0' });
  };

  return { app, start };
}
