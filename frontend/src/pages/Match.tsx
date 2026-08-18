import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { clearQueued, markQueued, MAX_WAIT_MS } from '../queue';
import { getRoadmap, joinQueue, type Difficulty, type Session } from '../api';

interface Props {
  /** A session already in progress, if there is one. */
  active: Session | null;
  /** Told to the shell so the header can offer the way back into the room. */
  onJoined: (session: Session) => void;
  /** Told to the shell so it starts or stops asking. The flag it reads lives in
   * storage, which React has no way to observe. */
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
 * The topic list, fetched rather than written out here. The database is what
 * actually decides which topics exist: a topic seeded but missing from a
 * hard-coded list is a question set nobody can ever be matched on, and it fails
 * silently. A failed fetch leaves the select empty rather than substituting a
 * list that might be wrong.
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

/**
 * Join the queue and wait.
 *
 * A match is noticed by the shell, which asks `/match/status` every few seconds
 * for as long as this browser is queued; nothing on this screen does the
 * asking. What this screen adds is the end of the wait: after MAX_WAIT_MS
 * nobody has come, so it stops and says so rather than leaving a spinner
 * running against a queue entry the server has already dropped.
 */
export function MatchPage({ active, onJoined, onQueueChanged }: Props) {
  const topics = useTopics();
  const navigate = useNavigate();
  const preset = usePreset();
  const [topic, setTopic] = useState(preset.topic ?? 'os');
  const [difficulty, setDifficulty] = useState<Difficulty>(preset.difficulty ?? 'medium');
  const [waiting, setWaiting] = useState(false);
  /** The wait ran out with nobody on the other side, which is an outcome rather
   * than an error: the queue entry is gone on both sides and joining again is
   * the only thing left to do. */
  const [gaveUp, setGaveUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const enter = async (session: Session) => {
    setWaiting(false);
    setGaveUp(false);
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

  /** The wait window closing. The shell stops asking at the same point, because
   * `readQueued` expires on the same MAX_WAIT_MS, and Matching drops the entry
   * itself once it is that old. Clearing the flag here only makes it immediate.
   */
  const giveUp = () => {
    setWaiting(false);
    setGaveUp(true);
    clearQueued();
    onQueueChanged();
  };

  const start = async () => {
    setError(null);
    setGaveUp(false);
    setWaiting(true);
    try {
      const result = await joinQueue(topic, difficulty);
      if (result.status === 'matched') return void enter(result.session);
      // Remembered, so the shell keeps asking after this screen is navigated
      // away from.
      markQueued(topic, difficulty);
      onQueueChanged();
      timer.current = setTimeout(giveUp, MAX_WAIT_MS);
    } catch (err) {
      setWaiting(false);
      setError(err instanceof Error ? err.message : 'could not join the queue');
    }
  };

  const cancel = () => {
    // Leaves the queue entry behind: there is no leave endpoint, so the entry
    // is claimed by whoever joins next until it ages out a minute later. Worth
    // knowing rather than pretending the button does more than it does.
    //
    // Which is exactly why the queued flag is *not* cleared here. Pressing this
    // stops this screen showing a wait; it does not take you out of the queue,
    // so a partner can still arrive. Clearing the flag would stop the shell
    // asking too, and put back the bug where somebody is matched into a session
    // nobody tells them about. The flag expires on its own.
    clearTimeout(timer.current);
    setWaiting(false);
  };

  // Joining while already matched hands back the same session rather than
  // queueing — Matching's idempotence guard, which is what stops one person
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
      {gaveUp && (
        <p className="status">
          Nobody joined {topic}/{difficulty} in the last minute. You have been removed from the
          queue, so try again later.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
