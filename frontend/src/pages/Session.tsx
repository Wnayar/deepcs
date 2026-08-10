import { useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import type * as Y from 'yjs';
import { consentToReveal, endSession, revealState, type Question, type Session } from '../api';
import { idToken } from '../auth';
import { connectCollab, type CollabStatus } from '../collab';
import { monaco } from '../monaco';
import type { SessionSummary } from '../App';

/** How often to ask whether the other person has agreed to reveal. Only runs
 * in the gap between one consent and the other, which is usually seconds. */
const REVEAL_POLL_MS = 2_500;

interface Props {
  session: Session;
  question: Question;
  displayName: string;
  onEnded: (summary: SessionSummary) => void;
}

export function SessionPage({ session, question, displayName, onEnded }: Props) {
  const editorHost = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [peers, setPeers] = useState(0);
  const [consented, setConsented] = useState<string[]>([]);
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
        displayName,
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
  }, [session.id, displayName]);

  /** Poll only while we have agreed and the answer has not arrived — not a
   * background timer for the whole session. */
  useEffect(() => {
    if (reference || !consented.length) return;
    const timer = setInterval(async () => {
      try {
        const state = await revealState(session.id);
        setConsented(state.consented);
        if (state.referenceMd) setReference(state.referenceMd);
      } catch {
        /* transient; the next tick tries again */
      }
    }, REVEAL_POLL_MS);
    return () => clearInterval(timer);
  }, [session.id, consented.length, reference]);

  const agree = async () => {
    setError(null);
    try {
      const state = await consentToReveal(session.id);
      setConsented(state.consented);
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
        partnerUid: session.partnerUid,
        startedAt: session.createdAt,
        endedAt,
        revealed: reference !== null,
      });
    } catch (err) {
      setEnding(false);
      setError(err instanceof Error ? err.message : 'could not end the session');
    }
  };

  const iAgreed = consented.length > 0 && reference === null;

  return (
    <>
      <h2>{question.title}</h2>
      <p className="status">
        {statusLabel(status)} · {peers === 1 ? 'partner connected' : `${peers} others here`} ·
        working with {session.partnerUid}
      </p>

      {status === 'unauthorized' && (
        <p className="error">Sign-in was rejected for this session. Try signing out and back in.</p>
      )}
      {status === 'refused' && (
        <p className="error">
          This session is closed to you — it may have already been ended by your partner.
        </p>
      )}

      <div className="editor" ref={editorHost} />

      <div className="row" style={{ marginTop: '1rem' }}>
        <button className="primary" onClick={() => void agree()} disabled={Boolean(reference)}>
          {reference ? 'Answer revealed' : 'Reveal the answer'}
        </button>
        <button onClick={() => void finish()} disabled={ending}>
          {ending ? 'Ending…' : 'End session'}
        </button>
        {iAgreed && <span className="status">Waiting for your partner to agree…</span>}
      </div>

      {error && <p className="error">{error}</p>}

      {reference && (
        <>
          <h3 style={{ marginBottom: 0 }}>Reference answer</h3>
          <p className="muted" style={{ marginTop: '0.25rem' }}>
            Released because you both agreed — it was never in the shared document.
          </p>
          <div className="reference">{reference}</div>
        </>
      )}
    </>
  );
}

function statusLabel(status: CollabStatus): string {
  switch (status) {
    case 'connecting':
      return 'connecting…';
    case 'connected':
      return 'live';
    case 'unauthorized':
      return 'not signed in';
    case 'refused':
      return 'session closed';
    case 'closed':
      return 'disconnected';
  }
}
