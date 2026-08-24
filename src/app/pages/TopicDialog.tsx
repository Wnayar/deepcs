import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import type { RoadmapTopic, Tier } from '../api';
import type { Mark } from '../progress';

const TIER_LABEL: Record<Tier, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  skills: 'Skills',
};

interface Props {
  topic: RoadmapTopic;
  signedIn: boolean;
  /** A paid topic for a reader who has not bought: steps still list, marks
   * hide, a banner sells. Presentation only; the Worker is the gate. */
  locked: boolean;
  markOf: (stepId: string) => Mark;
  onMark: (stepId: string, next: Mark) => void;
  onOpenStep: (stepId: string) => void;
  onClose: () => void;
}

/** A topic's contents, shown over the map so closing it returns exactly to
 * where you were. Escape and a backdrop click both close it. */
export function TopicDialog({ topic, signedIn, locked, markOf, onMark, onOpenStep, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const done = topic.steps.filter((step) => markOf(step.id).done).length;

  useEffect(() => {
    // Focus enters the dialog so Escape works without a click first.
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="scrim"
      onClick={onClose}
      // A press on the backdrop must not start a pan on the map behind it.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={panel}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={topic.title}
        tabIndex={-1}
        // A click inside must not reach the backdrop and close the dialog.
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="quiet"
          onClick={onClose}
          aria-label="Close"
          style={{ position: 'absolute', top: '0.9rem', right: '0.9rem' }}
        >
          ✕
        </button>

        {/* Left-aligned, pushed down from the edge: reading starts at the
            top left, so that is where the title sits; a centred title in a
            wide panel leaves the eye hunting. */}
        <div>
          <div className="dialog-head">
            <p className={`kicker ${topic.tier}`}>
              {TIER_LABEL[topic.tier]}
              {locked && ' · Pro'}
            </p>
            <h2>{topic.title}</h2>
            <p className="muted">{topic.summary}</p>
            {signedIn && !locked && (
              <p className="muted">
                {done} of {topic.steps.length} completed
              </p>
            )}
          </div>

          {/* The sell, transparent about the deal: the step list below stays
              fully readable, because hiding titles is what makes a paywall
              read as a trick. */}
          {locked && (
            <div className="upsell">
              <p className="upsell-title">Part of DeepCS Pro</p>
              <Link className="upsell-link" to="/upgrade">
                What's included
              </Link>
            </div>
          )}

          <div className="stack" style={{ gap: '0.35rem', marginTop: '1.1rem' }}>
            {topic.steps.map((step) => {
              const mark = markOf(step.id);
              return (
                /* A row, not a button: the tick, the star and the step are
                   three separate actions, and nested buttons are invalid
                   markup with unpredictable clicks. */
                <div key={step.id} className="card step-item">
                  {signedIn && !locked && (
                    <>
                      <button
                        className="mark-toggle"
                        aria-pressed={mark.done}
                        aria-label={`Mark ${step.title} ${mark.done ? 'not done' : 'done'}`}
                        title={mark.done ? 'Done' : 'Mark done'}
                        onClick={() => onMark(step.id, { ...mark, done: !mark.done })}
                      >
                        <span aria-hidden="true" className={mark.done ? 'ring done' : 'ring'} />
                      </button>

                      <button
                        className="mark-toggle star"
                        aria-pressed={mark.starred}
                        aria-label={`${mark.starred ? 'Unstar' : 'Star'} ${step.title}`}
                        title={mark.starred ? 'Starred' : 'Star this'}
                        onClick={() => onMark(step.id, { ...mark, starred: !mark.starred })}
                      >
                        <span aria-hidden="true">{mark.starred ? '★' : '☆'}</span>
                      </button>
                    </>
                  )}

                  <button className="step-open" onClick={() => onOpenStep(step.id)}>
                    <span className="label">
                      <strong>{step.title}</strong>
                    </span>
                    <span aria-hidden="true" className="faint">
                      →
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
