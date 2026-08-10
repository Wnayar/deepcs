import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { clearQueued, markQueued } from '../queue';
import { getRoadmap, joinQueue, matchStatus, type Difficulty, type Session } from '../api';

/**
 * How often to check that the claim still exists.
 *
 * This is not how a match is noticed. That arrives on the stream the shell
 * holds open, immediately and without asking. This covers the one case a
 * message cannot: the pair claim lives in Redis and the session row in
 * Postgres with no transaction spanning them, so a crash between the two
 * leaves somebody claimed with no session and no event ever published. Phase 3
 * documented `GET /match/status` answering `none` as the recovery, and nothing
 * else detects it.
 *
 * A minute apart, because it is a crash window rather than a race, and one
 * request a minute while somebody watches a waiting screen is not worth
 * optimising.
 */
const CLAIM_CHECK_MS = 60_000;

interface Props {
  /** A session already in progress, if there is one. */
  active: Session | null;
  /** Told to the shell so the header can offer the way back into the room. */
  onJoined: (session: Session) => void;
  /** Told to the shell so its own watcher starts or stops. The flag it reads
   * lives in storage, which React has no way to observe. */
  onQueueChanged: () => void;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** A lesson's "find a partner" button arrives as /match?topic=os&difficulty=easy,
 * so the form opens on what was just clicked rather than making you pick it
 * again. In the URL and not in a prop, because the choice should survive a
 * refresh and a shared link like everything else here. */
function usePreset(): { topic: string | null; difficulty: Difficulty | null } {
  const [params] = useSearchParams();
  const difficulty = params.get('difficulty');
  return {
    topic: params.get('topic'),
    difficulty: DIFFICULTIES.includes(difficulty as Difficulty) ? (difficulty as Difficulty) : null,
  };
}

/**
 * Join the queue and wait.
 *
 * The polling here is not laziness about push — it is the crash-recovery
 * contract phase 3 designed. The pair claim lives in Redis and the session row
 * in Postgres, with no transaction spanning them, so a crash between the two
 * would leave a claimed partner with no session. `GET /match/status` answering
 * `none` is the signal to re-join, and it is the only thing that unsticks that
 * case. Every topic and difficulty resolves to a question, so a join never
 * dead-ends on an empty combination.
 */
/**
 * The topic list, fetched rather than written out here.
 *
 * It was a constant duplicated in two screens, and the database is the thing
 * that actually decides which topics exist: a topic seeded but missing from a
 * hard-coded list is a question set nobody can ever be matched on, and it
 * fails silently. Falling back to an empty list would leave the form unusable,
 * so a failed fetch leaves the select empty and the error visible instead.
 */
function useTopics(): { topic: string; title: string }[] {
  const [topics, setTopics] = useState<{ topic: string; title: string }[]>([]);
  useEffect(() => {
    getRoadmap()
      .then((res) => setTopics(res.topics.map((t) => ({ topic: t.topic, title: t.title }))))
      .catch(() => setTopics([]));
  }, []);
  return topics;
}

export function MatchPage({ active, onJoined, onQueueChanged }: Props) {
  const topics = useTopics();
  const navigate = useNavigate();
  const preset = usePreset();
  const [topic, setTopic] = useState(preset.topic ?? 'os');
  const [difficulty, setDifficulty] = useState<Difficulty>(preset.difficulty ?? 'medium');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const enter = async (session: Session) => {
    setWaiting(false);
    clearTimeout(timer.current);
    clearQueued();
    onQueueChanged();
    try {
      onJoined(session);
      await navigate(`/session/${session.id}`);
    } catch {
      setError('Matched, but the session could not be opened. Try refreshing the page.');
    }
  };

  /** Not a poll for a partner. See CLAIM_CHECK_MS: this only catches a claim
   * that was lost to a crash, which no message can announce. */
  const checkClaim = async () => {
    if (document.hidden) {
      timer.current = setTimeout(() => void checkClaim(), CLAIM_CHECK_MS);
      return;
    }
    try {
      const status = await matchStatus(topic, difficulty);
      if (status.status === 'matched') return void enter(status.session);
      if (status.status === 'none') {
        // Neither matched nor queued: the claim was lost between Redis and
        // Postgres. Re-joining is the documented recovery, not an error.
        const rejoined = await joinQueue(topic, difficulty);
        if (rejoined.status === 'matched') return void enter(rejoined.session);
      }
      timer.current = setTimeout(() => void checkClaim(), CLAIM_CHECK_MS);
    } catch (err) {
      setWaiting(false);
      setError(err instanceof Error ? err.message : 'lost contact with matching');
    }
  };

  const start = async () => {
    setError(null);
    setWaiting(true);
    try {
      const result = await joinQueue(topic, difficulty);
      if (result.status === 'matched') return void enter(result.session);
      // Remembered, so the shell opens its stream and keeps watching after this
      // screen is navigated away from.
      markQueued(topic, difficulty);
      onQueueChanged();
      timer.current = setTimeout(() => void checkClaim(), CLAIM_CHECK_MS);
    } catch (err) {
      setWaiting(false);
      setError(err instanceof Error ? err.message : 'could not join the queue');
    }
  };

  const cancel = () => {
    // Leaves the queue entry behind: there is no leave endpoint, so the entry
    // is claimed by whoever joins next. Worth knowing rather than pretending
    // the button does more than it does.
    //
    // Which is exactly why the queued flag is *not* cleared here. Pressing this
    // stops this screen asking; it does not take you out of the queue, so a
    // partner can still arrive. Clearing the flag would stop the shell watching
    // too, and put back the bug where somebody is matched into a session nobody
    // tells them about. The flag expires on its own.
    clearTimeout(timer.current);
    setWaiting(false);
  };

  // Joining while already matched hands back the same session rather than
  // queueing — phase 3's idempotence guard, which is what stops one person
  // being in two rooms. Saying so is the point: without this the button
  // silently teleports you into a room you thought you had left.
  if (active) {
    return (
      <>
        <h2>You are already in a session</h2>
        <p className="muted">
          Leaving the editor does not end it — the document is still there, and so is your partner.
        </p>
        <div className="row">
          <button className="primary" onClick={() => void navigate(`/session/${active.id}`)}>
            Return to it
          </button>
        </div>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          To start a different one, end that session first.
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Find a partner</h2>
      <p className="muted">
        You will both get the same question and a shared document to answer it in.
      </p>

      <div className="row" style={{ marginBottom: '1rem' }}>
        <select value={topic} disabled={waiting} onChange={(event) => setTopic(event.target.value)}>
          {topics.map((t) => (
            <option key={t.topic} value={t.topic}>
              {t.title}
            </option>
          ))}
        </select>

        <select
          value={difficulty}
          disabled={waiting}
          onChange={(event) => setDifficulty(event.target.value as Difficulty)}
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>

        {waiting ? (
          <button onClick={cancel}>Stop waiting</button>
        ) : (
          <button className="primary" onClick={() => void start()}>
            Join the queue
          </button>
        )}
      </div>

      {waiting && (
        <p className="status">
          Waiting for someone to join {topic}/{difficulty}…
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
