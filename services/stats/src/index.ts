import { createJobLogger } from '@deepcs/shared/logger';

/**
 * Stats is a JOB, not a server (DESIGN.md §5, ADR-01).
 *
 * There is no `listen()` here and there never will be. Its trigger is time, not
 * a request, and a scaled-to-zero Cloud Run *service* has no running process
 * for a timer to fire inside — so it cannot be a server at all. Cloud Scheduler
 * starts it every 5 minutes, it drains the event log, it exits.
 *
 * The exit code is the contract: 0 tells Cloud Run Jobs the run succeeded,
 * anything else marks it failed and makes it retryable.
 */
const log = createJobLogger('stats');

async function run(): Promise<void> {
  const startedAt = process.hrtime.bigint();
  log.info('stats job started');

  // Phase 6 replaces this: read past the consumer-group bookmark on the
  // `events` Redis Stream, write summaries + aggregates idempotently, ack.
  const drained = 0;

  const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  log.info({ drained, duration_ms: ms }, 'stats job finished');
}

run().then(
  () => process.exit(0),
  (err: unknown) => {
    log.error({ err }, 'stats job failed');
    process.exit(1);
  },
);
