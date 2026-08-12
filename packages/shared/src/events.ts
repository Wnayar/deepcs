import type Redis from 'ioredis';

/**
 * The domain event log (the overview §5).
 *
 * Six moments in the product are recorded here, by whichever service owns the
 * moment. Nothing reads them synchronously: the Stats job drains the log on a
 * schedule, turns it into summaries and aggregates, and acknowledges what it
 * processed.
 *
 * **Why a log and not a queue** (ADR-07). A queue deletes on consume, so a bug
 * in the summary logic means the data needed to recompute it is gone. A log
 * keeps entries after they are read, so fixing the bug is rewinding a bookmark.
 * That property is the reason this is worth building at all.
 *
 * The interface has three methods because those are the three that Redis
 * Streams and Kafka genuinely share. A Kafka adapter behind it is in the
 * backlog and is not built; the point of keeping the surface this small is
 * that such an adapter would be the only thing that changes.
 */

/** The six moments. Named after what happened, in the past tense, because an
 * event is a record of a fact and not an instruction to do something. */
export type EventType =
  | 'user.signed_up'
  | 'queue.joined'
  | 'match.created'
  | 'session.started'
  | 'reveal.consented'
  | 'session.ended';

export interface DomainEvent {
  /** The log's own id for this entry. Unique, ordered, and assigned by the log
   * rather than by the producer, which makes it usable as an idempotency key
   * for events that have no natural one. */
  id: string;
  type: EventType;
  /** Flat, string-valued, and small. Redis Streams entries are field/value
   * pairs, so anything nested has to be JSON in one field; keeping the payload
   * flat means the entry is readable with `XRANGE` from a shell. */
  data: Record<string, string>;
}

export interface EventLog {
  /** Appends one entry and returns its id. */
  append(type: EventType, data: Record<string, string>): Promise<string>;

  /**
   * Reads up to `count` entries that this consumer group has not yet been
   * given, blocking for nothing: a job that finds an empty log should exit,
   * not wait.
   */
  readBatch(count: number): Promise<DomainEvent[]>;

  /** Marks entries as processed, so they leave the group's pending list. */
  ack(ids: string[]): Promise<void>;
}

/** One stream, not one per type. Ordering across types is the point: a
 * `session.ended` that overtook its own `match.created` would be a summary for
 * a session the consumer has never heard of. */
const STREAM = 'events';

/** The consumer group. A group is what gives Redis a server-side bookmark and
 * a pending list per consumer, which is what makes redelivery after a crash
 * possible rather than silent loss. */
const GROUP = 'stats';

/**
 * The Redis Streams adapter.
 *
 * `consumerName` identifies one running copy of the job. It matters only for
 * the pending list: entries delivered to a consumer that then died stay
 * attributed to that name until they are acknowledged or claimed, so a stable
 * name lets the next run of the same job find its own unfinished work.
 */
export function createRedisEventLog(redis: Redis, consumerName = 'stats-job'): EventLog {
  /**
   * Creating the group is idempotent and has to happen before the first read,
   * but the stream may not exist yet on a fresh database. `MKSTREAM` creates an
   * empty one rather than failing, and BUSYGROUP means somebody else already
   * did this, which is success and not an error.
   */
  const ensureGroup = async (): Promise<void> => {
    try {
      await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  };

  return {
    async append(type, data) {
      const fields = Object.entries({ type, ...data }).flat();
      return redis.xadd(STREAM, '*', ...fields) as Promise<string>;
    },

    async readBatch(count) {
      await ensureGroup();

      // `>` means "entries never delivered to this group". Entries that were
      // delivered but never acked are deliberately not read here: claiming
      // another consumer's abandoned work needs XAUTOCLAIM and a policy for
      // how long is too long, and this job's own unfinished work is redelivered
      // by asking for `0` instead. Kept out until there is a second consumer to
      // justify it.
      const response = (await redis.xreadgroup(
        'GROUP',
        GROUP,
        consumerName,
        'COUNT',
        count,
        'STREAMS',
        STREAM,
        '>',
      )) as [string, [string, string[]][]][] | null;

      if (!response) return [];

      return response.flatMap(([, entries]) =>
        entries.map(([id, fields]) => {
          // Fields arrive as a flat array: [k1, v1, k2, v2, ...].
          const data: Record<string, string> = {};
          for (let i = 0; i + 1 < fields.length; i += 2) data[fields[i]!] = fields[i + 1]!;
          const { type, ...rest } = data;
          return { id, type: type as EventType, data: rest };
        }),
      );
    },

    async ack(ids) {
      if (ids.length === 0) return;
      await redis.xack(STREAM, GROUP, ...ids);
    },
  };
}

/**
 * Records an event without ever failing the request that caused it.
 *
 * Fire-and-forget on purpose (§5). A user who signed up has signed up whether
 * or not the log accepted the entry, and failing their request because a
 * statistics pipeline is unavailable would be trading something that matters
 * for something that does not. The cost of a dropped entry is a summary that
 * undercounts, which is why it is warned about rather than swallowed silently.
 */
export async function emitEvent(
  log: EventLog,
  logger: { warn: (obj: object, msg: string) => void },
  type: EventType,
  data: Record<string, string>,
): Promise<void> {
  try {
    await log.append(type, data);
  } catch (err) {
    logger.warn({ err, event_type: type }, 'event not recorded');
  }
}
