import { useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import type * as Y from 'yjs';
import { Navigate, useNavigate, useParams } from 'react-router';
import {
  consentToReveal,
  currentSession,
  endSession,
  getQuestion,
  partnerName,
  revealState,
  type Question,
  type Session,
} from '../api';
import { idToken } from '../auth';
import { connectCollab, type CollabStatus } from '../collab';
import { monaco } from '../monaco';
import { marked } from 'marked';
import type { SessionSummary } from '../App';

/** How often to ask whether the other person has agreed to reveal. Only runs
 * in the gap between one consent and the other, which is usually seconds. */
const REVEAL_POLL_MS = 2_500;

/**
 * Rebuilds the session from its URL, then renders it.
 *
 * Asking the server which session the caller is in — rather than trusting a
 * session object handed over by whatever navigated here — is what makes a
 * refresh, a bookmark and the Back button all land back in the same document.
 * The id in the path is checked against that answer, and a stale link to an
 * ended session or somebody else's goes to the roadmap rather than to a screen
 * of its own.
 */
export function SessionRoute({ onEnded }: { onEnded: () => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<{ session: Session; question: Question } | null>(null);
  const [gone, setGone] = useState(false);
  /** The partner's name, once Matching has answered. Null covers both "not
   * fetched yet" and "they signed up before names existed", and both render the
   * same way, because neither is worth a different sentence. */
  const [partner, setPartner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await currentSession();
        if (!session || session.id !== id) throw new Error('not in this session');
        const question = await getQuestion(session.questionId);
        if (!cancelled) setLoaded({ session, question });

        // After the room is usable, not before. A name is a label on a session
        // that already works, so a slow or failed lookup must not hold the
        // editor closed.
        const { displayName } = await partnerName(session.id);
        if (!cancelled) setPartner(displayName);
      } catch {
        if (!cancelled) setGone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (gone) return <Navigate to="/" replace />;
  if (!loaded) return <p className="muted">Rejoining…</p>;

  return (
    <SessionPage
      session={loaded.session}
      question={loaded.question}
      partner={partner}
      onEnded={(summary) => {
        onEnded();
        // The summary is built from what this page already knows and there is
        // no endpoint that could rebuild it, so it travels in history state
        // rather than in the URL. A refresh on /summary therefore has nothing
        // to show, and that route sends you to the roadmap.
        void navigate('/summary', { replace: true, state: { summary } });
      }}
    />
  );
}

interface Props {
  session: Session;
  question: Question;
  /** The partner's display name, or null while it is still being fetched and
   * for accounts made before names existed. Both render as nothing. */
  partner: string | null;
  onEnded: (summary: SessionSummary) => void;
}

export function SessionPage({ session, question, partner, onEnded }: Props) {
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

  /** Runs only while we have agreed and the answer has not arrived, which is
   * usually seconds — not a background timer for the whole session. */
  useEffect(() => {
    if (reference || !consent.you) return;
    const timer = setInterval(async () => {
      // Nobody is reading a hidden tab, and the answer is still there when it
      // comes back.
      if (document.hidden) return;
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

  // Specifically *you* having agreed and them not having. "Anyone has agreed"
  // would show "waiting for your partner" to the person their partner is in
  // fact waiting on.
  const waitingOnPartner = consent.you && !consent.partner && reference === null;

  return (
    <>
      <h2>{question.title}</h2>
      {partner && (
        <p className="muted" style={{ marginTop: '-0.35rem' }}>
          Working with <strong>{partner}</strong>
        </p>
      )}
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
          <div
            className="reference prose"
            dangerouslySetInnerHTML={{ __html: marked.parse(reference) }}
          />
        </>
      )}
    </>
  );
}

/**
 * Your own connection, in words rather than a state name. It is reported
 * separately from the partner's presence because the two fail independently:
 * your socket can be down while your partner's is fine, and the reverse.
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
