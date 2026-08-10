import type pg from 'pg';
import type { DomainEvent } from '@deepcs/shared/events';

/**
 * Turns events into rows.
 *
 * Every statement here is safe to run twice, and that is not a nicety. The job
 * reads a batch, processes it, then acknowledges it; a crash in between means
 * Redis hands the same entries to the next run. Delivery is at-least-once, so
 * the only way to get exactly-once *effects* is for the effects to be
 * repeatable. Two techniques appear below and the choice between them is the
 * interesting part:
 *
 *   - **A natural key** where the event names something that exists once: a
 *     session id, a user id. `ON CONFLICT DO UPDATE` then writes the same row
 *     again instead of a second one.
 *   - **The log's entry id** where it does not. A user may join the queue,
 *     give up, and join again, and both are real, so there is nothing in the
 *     payload to key on. The id Redis assigned is unique and is not the
 *     producer's to get wrong.
 *
 * Note what is absent: no counters. `count = count + 1` run twice is wrong and
 * no care at the call site fixes it, which is why `GET /stats` groups over
 * these rows on read rather than maintaining totals on write.
 */
export async function applyEvent(client: pg.PoolClient, event: DomainEvent): Promise<void> {
  /**
   * A field the event is required to carry.
   *
   * Missing means the producer and this consumer disagree about the payload,
   * which is a bug rather than a data condition, so it throws with the entry id
   * rather than writing a row with a hole in it. The batch then rolls back and
   * the entries stay unacknowledged, which is right for a deploy that shipped
   * a bad producer and is retried once it is rolled back.
   *
   * The limitation that buys: a permanently malformed entry is retried for
   * ever, because nothing here moves it aside. A dead-letter path is what fixes
   * that, and it is not built. See the phase doc.
   */
  const need = (field: string): string => {
    const value = event.data[field];
    if (value === undefined) {
      throw new Error(`event ${event.id} (${event.type}) is missing "${field}"`);
    }
    return value;
  };

  switch (event.type) {
    case 'user.signed_up':
      await client.query(
        `INSERT INTO stats.signups (user_id, signed_up_at) VALUES ($1, now())
         ON CONFLICT (user_id) DO NOTHING`,
        [need('userId')],
      );
      return;

    case 'queue.joined':
      await client.query(
        `INSERT INTO stats.queue_joins (event_id, user_id, topic, difficulty, joined_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (event_id) DO NOTHING`,
        [event.id, need('userId'), need('topic'), need('difficulty')],
      );
      return;

    case 'match.created':
      // The row is created here and only here. Every other event updates it,
      // which is why ordering within the single stream matters: a summary for
      // a session nobody has heard of would be an insert with no topic.
      await client.query(
        `INSERT INTO stats.session_summaries
           (session_id, question_id, topic, difficulty, participants, waited_seconds, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id) DO UPDATE SET
           question_id = EXCLUDED.question_id,
           topic = EXCLUDED.topic,
           difficulty = EXCLUDED.difficulty,
           participants = EXCLUDED.participants,
           waited_seconds = EXCLUDED.waited_seconds,
           started_at = EXCLUDED.started_at`,
        [
          need('sessionId'),
          need('questionId'),
          need('topic'),
          need('difficulty'),
          need('participants').split(','),
          Number(need('waitedSeconds')),
          need('startedAt'),
        ],
      );
      return;

    case 'session.started':
      // Arrives once per room opened, not once per session, so it repeats
      // whenever participants disconnect and return and again on a second
      // instance. COALESCE keeps the first, which makes every repeat a no-op
      // and is the whole reason this event is recorded rather than counted.
      await client.query(
        `UPDATE stats.session_summaries
            SET first_connected_at = COALESCE(first_connected_at, $2)
          WHERE session_id = $1`,
        [need('sessionId'), need('connectedAt')],
      );
      return;

    case 'reveal.consented':
      // Both participants consenting produces two of these, and the answer to
      // "was it revealed" is the same either way. Setting a flag to true twice
      // is the cheapest kind of idempotent there is.
      await client.query(
        `UPDATE stats.session_summaries SET revealed = true WHERE session_id = $1`,
        [need('sessionId')],
      );
      return;

    case 'session.ended':
      await client.query(`UPDATE stats.session_summaries SET ended_at = $2 WHERE session_id = $1`, [
        need('sessionId'),
        need('endedAt'),
      ]);
      return;
  }
}

/**
 * Applies one batch inside a transaction.
 *
 * The transaction is not for atomicity across events, which the log already
 * orders. It is so that a failure halfway through a batch leaves no partial
 * batch behind: those entries are still unacknowledged, so they come back, and
 * they come back to a database that looks exactly as it did before. Without it,
 * redelivery would replay events on top of half-applied ones, which is a
 * situation the idempotency above happens to survive and should not have to.
 */
export async function applyBatch(pool: pg.Pool, events: DomainEvent[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const event of events) await applyEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
