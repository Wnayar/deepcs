import { createJobLogger } from '@deepcs/shared/logger';
import { createPool } from '@deepcs/shared/db';
import { createRedis } from '@deepcs/shared/redis';
import { createRedisEventLog } from '@deepcs/shared/events';
import { applyBatch } from './consumer.js';

/**
 * Stats is a JOB, not a server (DESIGN.md §5, ADR-01).
 *
 * There is no `listen()` here and there never will be. Its trigger is time, not
 * a request, and a service that is not running between requests has no process
 * for a timer to fire inside — so it cannot be a server at all. A scheduler
 * starts it, it drains the event log, it exits.
 *
 * The exit code is the contract: 0 tells whatever started it that the run
 * succeeded, anything else marks it failed and makes it retryable.
 */
const log = createJobLogger('stats');

/** How many entries to take at a time. Small enough that a crash re-does
 * little work, large enough that a backlog drains in a few round trips. */
const BATCH = 200;

/** A backstop, not a target. The job is meant to reach an empty log and stop;
 * this only bounds the damage if something is appending faster than it reads,
 * so a run cannot become the always-on consumer §7 rules out. */
const MAX_BATCHES = 50;

async function run(): Promise<void> {
  const startedAt = process.hrtime.bigint();
  log.info('stats job started');

  const pool = createPool();
  // The offline queue is on: this job's first Redis command is issued
  // immediately, with no request to have waited behind, so it would otherwise
  // race the connection and fail on a socket that is milliseconds from ready.
  const redis = createRedis(undefined, { enableOfflineQueue: true });
  const events = createRedisEventLog(redis);

  let drained = 0;
  try {
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const entries = await events.readBatch(BATCH);
      if (entries.length === 0) break;

      await applyBatch(pool, entries);

      // Acknowledged only after the transaction committed. That order is the
      // whole safety property: acking first would mean a crash in between
      // loses the entries for good, because an acked entry is never
      // redelivered. This way a crash costs a repeat, and a repeat is
      // something every write here is built to survive.
      await events.ack(entries.map((entry) => entry.id));
      drained += entries.length;
    }
  } finally {
    await pool.end();
    redis.disconnect();
  }

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
