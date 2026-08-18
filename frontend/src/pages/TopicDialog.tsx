import { useEffect, useRef } from 'react';
import type { RoadmapTopic } from '../api';
import type { Mark } from '../progress';

interface Props {
  topic: RoadmapTopic;
  /** Signed out, the tick and star are not drawn at all rather than drawn and
   * refused: the panel is readable by anyone, the marks belong to somebody. */
  signedIn: boolean;
  markOf: (stepId: string) => Mark;
  onMark: (stepId: string, next: Mark) => void;
  onOpenStep: (stepId: string) => void;
  onClose: () => void;
}

/**
 * What is inside a topic, shown over the roadmap rather than on a page of its
 * own so that closing it puts you back exactly where you were on the map.
 *
 * Escape closes it and so does a click on the backdrop, because a dialog with
 * only one small close button is the kind of thing people get stuck in.
 */
export function TopicDialog({ topic, signedIn, markOf, onMark, onOpenStep, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const done = topic.steps.filter((step) => markOf(step.id).done).length;

  useEffect(() => {
    // Focus moves into the dialog so the keyboard follows the eye, and Escape
    // works without first clicking something inside it.
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
      // The map is behind this and drags from anywhere, so a press that lands
      // on the backdrop must not also start a pan.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={panel}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={topic.title}
        tabIndex={-1}
        // A click inside the panel must not reach the backdrop behind it,
        // which would close the dialog the moment anyone tried to use it.
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

        {/* Top-aligned, not centred. Centring moved the title up and down
            depending on how many steps a topic has, so opening two topics in a
            row made the panel appear to jump. */}
        <div>
          <h2 style={{ margin: '0 0 0.35rem', textAlign: 'center' }}>{topic.title}</h2>
          {signedIn && (
            <p className="muted" style={{ textAlign: 'center', margin: '0 0 0.6rem' }}>
              ({done} / {topic.steps.length})
            </p>
          )}
          <p className="muted" style={{ textAlign: 'center' }}>
            {topic.summary}
          </p>

          <div className="stack" style={{ gap: '0.35rem', marginTop: '1.1rem' }}>
            {topic.steps.map((step) => {
              const mark = markOf(step.id);
              return (
                /* A row, not a button. The tick, the star and the step itself
                   are three separate actions, and a button inside a button is
                   invalid markup that React builds through the DOM: nothing
                   looks broken and then clicks land on the wrong one. */
                <div key={step.id} className="card step-item">
                  {signedIn && (
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

                  {/* The title alone. A number in front of it repeated what
                      the reading order already shows, and a question count is
                      the wrong thing to promise a reader before they arrive. */}
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
