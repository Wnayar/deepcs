import { useEffect, useRef } from 'react';
import type { RoadmapTopic } from '../api';

interface Props {
  topic: RoadmapTopic;
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
export function TopicDialog({ topic, onOpenStep, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);

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

        {/* Auto vertical margins center this block in the panel when it is
            shorter than the screen, and collapse to zero when it is taller,
            so long content still scrolls from the top instead of clipping. */}
        <div style={{ margin: 'auto 0' }}>
          <h2 style={{ margin: '0 0 0.35rem', textAlign: 'center' }}>{topic.title}</h2>
          <p className="muted" style={{ textAlign: 'center' }}>
            {topic.summary}
          </p>

          <div className="stack" style={{ gap: '0.35rem', marginTop: '1.1rem' }}>
            {topic.steps.map((step) => (
              <button key={step.id} className="card step-item" onClick={() => onOpenStep(step.id)}>
                <span className="step-number">{step.step}</span>
                <span className="label">
                  <strong>{step.title}</strong>
                  <span className="faint">
                    {step.questionCount} question{step.questionCount === 1 ? '' : 's'} to answer
                  </span>
                </span>
                <span aria-hidden="true" className="faint">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
