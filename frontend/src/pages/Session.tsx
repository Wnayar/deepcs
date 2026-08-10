import { useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import type * as Y from 'yjs';
import { consentToReveal, endSession, revealState, type Question, type Session } from '../api';
import { idToken } from '../auth';
import { connectCollab, type CollabStatus } from '../collab';
import { monaco } from '../monaco';
import { numberReference } from '../reference';
import type { SessionSummary } from '../App';

/** How often to ask whether the other person has agreed to reveal. Only runs
 * in the gap between one consent and the other, which is usually seconds. */
const REVEAL_POLL_MS = 2_500;

interface Props {
  session: Session;
  question: Question;
  onEnded: (summary: SessionSummary) => void;
}

export function SessionPage({ session, question, onEnded }: Props) {
  const editorHost = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ReturnType<typeof monaco.editor.create> | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [peers, setPeers] = useState(0);
  const [consent, setConsent] = useState({ you: false, partner: false });
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  /**
   * One effect owns the whole live connection: the socket, the Yjs document,
   * the editor and the binding between them. They have exactly the same
   * lifetime, and splitting them across effects is how you get an editor bound
   * to a destroyed document after a re-render.
   */
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    void (async () => {
      const token = await idToken();
      if (!token || cancelled || !editorHost.current) return;

      const collab = connectCollab({
        sessionId: session.id,
        token,
        onStatus: (next) => {
          if (!cancelled) setStatus(next);
        },
      });

      const editor = monaco.editor.create(editorHost.current, {
        value: '',
        // Plain text: the core editor API ships no language contributions (see
        // monaco.ts). The document is prose, so this costs highlighting only.
        language: 'plaintext',
        automaticLayout: true,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
      });
      editorRef.current = editor;

      // `"content"` is not a name chosen here — it is the field the Collab
      // service seeds the scaffold into, so binding to anything else produces
      // an empty editor that syncs with nobody.
      const text: Y.Text = collab.doc.getText('content');
      const binding = new MonacoBinding(
        text,
        editor.getModel()!,
        new Set([editor]),
        collab.awareness,
      );

      // Everyone in the room except us. Yjs awareness carries this for free,
      // and y-monaco draws the remote carets from the same data.
      const onAwareness = () => {
        if (!cancelled) setPeers(Math.max(0, collab.awareness.getStates().size - 1));
      };
      collab.awareness.on('change', onAwareness);

      cleanup = () => {
        editorRef.current = null;
        collab.awareness.off('change', onAwareness);
        binding.destroy();
        editor.dispose();
        collab.destroy();
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [session.id]);

  /**
   * The partner pressed End. The socket is already closed by the server, so
   * nothing typed from here could reach anyone — making the editor read-only
   * is what stops it looking like it still works.
   */
  useEffect(() => {
    if (status === 'ended') editorRef.current?.updateOptions({ readOnly: true });
  }, [status]);

  /** Poll only while we have agreed and the answer has not arrived — not a
   * background timer for the whole session. */
  useEffect(() => {
    if (reference || !consent.you) return;
    const timer = setInterval(async () => {
      try {
        const state = await revealState(session.id);
        setConsent({ you: state.you, partner: state.partner });
        if (state.referenceMd) setReference(state.referenceMd);
      } catch {
        /* transient; the next tick tries again */
      }
    }, REVEAL_POLL_MS);
    return () => clearInterval(timer);
  }, [session.id, consent.you, reference]);

  const agree = async () => {
    setError(null);
    try {
      const state = await consentToReveal(session.id);
      setConsent({ you: state.you, partner: state.partner });
      if (state.referenceMd) setReference(state.referenceMd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not record consent');
    }
  };

  const finish = async () => {
    setEnding(true);
    try {
      const { endedAt } = await endSession(session.id);
      onEnded({
        question,
        startedAt: session.createdAt,
        endedAt,
        revealed: reference !== null,
      });
    } catch (err) {
      setEnding(false);
      setError(err instanceof Error ? err.message : 'could not end the session');
    }
  };

  // Waiting is specifically *you* having agreed and them not having. The old
  // check was "anyone has agreed", which showed "waiting for your partner"
  // to the person their partner was in fact waiting on.
  const waitingOnPartner = consent.you && !consent.partner && reference === null;

  return (
    <>
      <h2>{question.title}</h2>
      <p className="status row">
        {(() => {
          const conn = connectionLabel(status);
          return (
            <span className={`signal ${conn.tone}`}>
              <i className="dot" /> {conn.text}
            </span>
          );
        })()}
        {/* Awareness counts every connected client including this one, so a
            second entry is the partner being in the room right now. */}
        <span className={`signal ${peers === 1 ? 'ok' : 'wait'}`}>
          <i className="dot" /> {peers === 1 ? 'Partner is here' : 'Waiting for your partner'}
        </span>
      </p>

      {status === 'unauthorized' && (
        <p className="error">Sign-in was rejected for this session. Try signing out and back in.</p>
      )}
      {status === 'refused' && (
        <p className="error">
          This session is closed to you — it may have already been ended by your partner.
        </p>
      )}
      {status === 'ended' && (
        <div className="card">
          <strong>Your partner ended this session.</strong>
          <p className="muted" style={{ margin: '0.35rem 0 0.75rem' }}>
            The document below is final and can no longer be edited. Anything revealed stays
            visible.
          </p>
          <button
            className="primary"
            onClick={() =>
              onEnded({
                question,
                startedAt: session.createdAt,
                // The moment we were told, which is within milliseconds of the
                // real end — the summary rounds to minutes.
                endedAt: new Date().toISOString(),
                revealed: reference !== null,
              })
            }
          >
            See the summary
          </button>
        </div>
      )}

      <div className="editor" ref={editorHost} />

      <div className="row" style={{ marginTop: '1rem' }}>
        <button
          className="primary"
          onClick={() => void agree()}
          disabled={Boolean(reference) || status === 'ended'}
        >
          {reference ? 'Answer revealed' : 'Reveal the answer'}
        </button>
        <button onClick={() => void finish()} disabled={ending || status === 'ended'}>
          {ending ? 'Ending…' : 'End session'}
        </button>
        {waitingOnPartner && (
          <span className="signal wait">
            <i className="dot" /> Waiting for your partner to agree
          </span>
        )}
        {!consent.you && consent.partner && reference === null && (
          <span className="signal wait">
            <i className="dot" /> Your partner is waiting on you
          </span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {reference && (
        <>
          <h3 style={{ marginBottom: 0 }}>Reference answer</h3>
          <p className="muted" style={{ marginTop: '0.25rem' }}>
            Released because you both agreed — it was never in the shared document.
          </p>
          <div className="reference">{numberReference(reference, question.parts.length)}</div>
        </>
      )}
    </>
  );
}

/**
 * The two things a person in a session needs to know, said in words rather
 * than in a state name.
 *
 * There are two of them because they fail independently and the fix differs:
 * your own socket can be down while your partner's is fine, and the reverse.
 * The old single line read "live · partner connected", where "live" was the
 * status of *your* connection — which nothing on the page said, so it could
 * equally have been read as the session, the document, or the other person.
 */
function connectionLabel(status: CollabStatus): { text: string; tone: 'ok' | 'wait' | 'bad' } {
  switch (status) {
    case 'connecting':
      return { text: 'Connecting to the session…', tone: 'wait' };
    case 'connected':
      return { text: 'Your edits are syncing', tone: 'ok' };
    case 'unauthorized':
      return { text: 'Sign-in rejected — not syncing', tone: 'bad' };
    case 'refused':
      return { text: 'Session closed to you — not syncing', tone: 'bad' };
    case 'ended':
      return { text: 'Session ended — no longer syncing', tone: 'bad' };
    case 'closed':
      return { text: 'Disconnected — reconnecting', tone: 'bad' };
  }
}
