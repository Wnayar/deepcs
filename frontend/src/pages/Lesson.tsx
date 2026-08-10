import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { getLesson, listQuestions, type Difficulty, type Lesson, type Question } from '../api';

/** Easy/medium/hard are day 1/2/3 of the notes, which is what the bank seeded
 * them from — so the drills are listed in that order rather than alphabetically. */
const ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

interface Props {
  topic: string;
  /** Start a session on this topic and difficulty — the whole point of the page. */
  onPractise: (topic: string, difficulty: Difficulty) => void;
  onBack: () => void;
}

/**
 * One topic's notes, followed by the three questions that drill them.
 *
 * The lesson and the questions are joined by `topic`: the lesson's primary key
 * is the same string the bank carries in `tags[0]`, so listing the drills for
 * what you have just read costs one filtered query and no join table.
 *
 * `marked` output goes in through `dangerouslySetInnerHTML`, which is safe here
 * for a reason worth being explicit about rather than assuming: this markdown
 * is seeded by a migration from a fixed set of notes. No user writes it, no
 * route updates it. Were lessons ever to accept submissions, this line is the
 * one that would need a sanitizer in front of it.
 */
export function LessonPage({ topic, onPractise, onBack }: Props) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [drills, setDrills] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLesson(null);
    Promise.all([getLesson(topic), listQuestions({ tags: topic, limit: 10 })])
      .then(([l, page]) => {
        setLesson(l);
        setDrills(
          [...page.items].sort((a, b) => ORDER.indexOf(a.difficulty) - ORDER.indexOf(b.difficulty)),
        );
      })
      .catch(() => setError('could not load this lesson'));
  }, [topic]);

  if (error) return <p className="error">{error}</p>;
  if (!lesson) return <p className="muted">Loading…</p>;

  return (
    <>
      <button onClick={onBack}>← All topics</button>
      <h2>{lesson.title}</h2>

      <article
        className="prose"
        dangerouslySetInnerHTML={{ __html: marked.parse(lesson.bodyMd) }}
      />

      <h3>Drill it</h3>
      <p className="muted">
        Three sets of questions on what you just read. Pairing with someone puts you both in one
        editor; the reference answer stays hidden until you both ask for it.
      </p>

      {drills.map((q) => (
        <div key={q.id} className="card">
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {q.difficulty} · {q.parts.length} questions
          </div>
          <h3 style={{ margin: '0.15rem 0 0.6rem' }}>{q.title}</h3>
          <button className="primary" onClick={() => onPractise(topic, q.difficulty)}>
            Find a partner
          </button>
        </div>
      ))}
    </>
  );
}
