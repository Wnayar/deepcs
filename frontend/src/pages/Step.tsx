import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { getStep, questionReference, type Difficulty, type Step } from '../api';

interface Props {
  stepId: string;
  signedIn: boolean;
  onOpenStep: (stepId: string) => void;
  onPractise: (topic: string, difficulty: Difficulty) => void;
  onBack: () => void;
}

/**
 * One step: the questions it prepares you for, then the material, then the
 * answer and the option to work through it with someone.
 *
 * The questions come first on purpose. Reading a long page without knowing
 * what it is for is where people give up, and three lines at the top saying
 * "this is what you will be able to answer" turns the same material into
 * something with an end. They are also short enough to stay in mind while
 * reading, which is why they are not tucked into a sidebar.
 *
 * The sidebar is navigation instead: the three steps of this topic, so moving
 * on does not mean going back to the map and finding it again.
 *
 * `marked` output goes in through `dangerouslySetInnerHTML`, which is safe
 * here for a reason worth stating rather than assuming: this markdown is
 * seeded by a migration from a fixed set of notes, no user writes it, and no
 * route updates it. The day lessons start accepting submissions is the day
 * that line needs a sanitizer in front of it.
 */
export function StepPage({ stepId, signedIn, onOpenStep, onPractise, onBack }: Props) {
  const [step, setStep] = useState<Step | null>(null);
  const [answers, setAnswers] = useState<string | null>(null);
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStep(null);
    setAnswers(null);
    setError(null);
    window.scrollTo({ top: 0 });
    getStep(stepId)
      .then(setStep)
      .catch(() => setError('This step could not be loaded. Try refreshing the page.'));
  }, [stepId]);

  const showAnswers = async () => {
    setLoadingAnswers(true);
    try {
      setAnswers((await questionReference(stepId)).referenceMd);
    } catch {
      setError('The answers could not be loaded. Try again in a moment.');
    } finally {
      setLoadingAnswers(false);
    }
  };

  if (error && !step) return <p className="error">{error}</p>;
  if (!step) return <p className="muted">Loading…</p>;

  return (
    <div className="step-layout">
      <nav className="sidebar" aria-label={`Steps in ${step.topicTitle}`}>
        <button className="quiet" onClick={onBack} style={{ marginBottom: '0.6rem' }}>
          ← Roadmap
        </button>
        <span className="heading">{step.topicTitle}</span>
        {step.siblings.map((sibling) => (
          <button
            key={sibling.id}
            aria-current={sibling.id === step.id ? 'page' : undefined}
            onClick={() => onOpenStep(sibling.id)}
          >
            {sibling.step}. {sibling.title}
          </button>
        ))}
      </nav>

      <div>
        <span className="tag accent">Step {step.step}</span>
        <h2 style={{ marginTop: '0.5rem' }}>{step.title}</h2>

        <div className="card" style={{ margin: '1.25rem 0 2rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>What you should be able to answer</h3>
          <ol className="checklist">
            {step.parts.map((part) => (
              <li key={part}>{part}</li>
            ))}
          </ol>
        </div>

        <article
          className="prose"
          dangerouslySetInnerHTML={{ __html: marked.parse(step.lessonMd) }}
        />

        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '2.5rem 0 1.5rem' }} />

        <h3>Ready to check yourself?</h3>
        <p className="muted">
          Try answering the questions above out loud first. Working through them with someone else
          is the version that actually sticks, because you have to say it rather than recognise it.
        </p>

        <div className="row">
          <button className="primary" onClick={() => onPractise(step.topic, step.difficulty)}>
            Work through it with a partner
          </button>

          {signedIn ? (
            !answers && (
              <button onClick={() => void showAnswers()} disabled={loadingAnswers}>
                {loadingAnswers ? 'Loading…' : 'Show the answers'}
              </button>
            )
          ) : (
            <span className="muted">Sign in to see the answers.</span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {answers && (
          <div className="reference prose">
            <div dangerouslySetInnerHTML={{ __html: marked.parse(answers) }} />
          </div>
        )}
      </div>
    </div>
  );
}
