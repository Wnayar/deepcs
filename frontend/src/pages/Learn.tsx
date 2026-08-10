import { useEffect, useState } from 'react';
import { listLessons, type LessonSummary } from '../api';

/**
 * The front page: the nine topics, as the way in.
 *
 * This is step zero of the product loop, and it comes before the question bank
 * on purpose. Arriving at a list of questions you cannot answer is not a place
 * to start learning from — the material comes first, the drills come after it,
 * and solving one with someone else comes after that.
 *
 * Public, like the bank. Nothing here needs an account.
 */
export function LearnPage({ onOpen }: { onOpen: (topic: string) => void }) {
  const [topics, setTopics] = useState<LessonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLessons()
      .then((res) => setTopics(res.items))
      .catch(() => setError('could not load the topics'));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!topics) return <p className="muted">Loading…</p>;

  return (
    <>
      <h2>Learn</h2>
      <p className="muted">
        Nine topics, written as notes rather than reference docs. Read one, then drill it — alone or
        with a partner.
      </p>

      <div className="grid">
        {topics.map((t) => (
          <button key={t.topic} className="card tile" onClick={() => onOpen(t.topic)}>
            <strong>{t.title}</strong>
            <span className="muted">3 questions</span>
          </button>
        ))}
      </div>
    </>
  );
}
