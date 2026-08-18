import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import {
  currentSession,
  ensureProfile,
  joinQueue,
  matchStatus,
  type Question,
  type Session,
} from './api';
import { signOutUser, watchUser, type User } from './auth';
import { useTheme } from './theme';
import { clearQueued, readQueued } from './queue';
import { RoadmapPage } from './pages/Roadmap';
import { StepPage } from './pages/Step';
import { LoginPage } from './pages/Login';
import { MatchPage } from './pages/Match';
import { SessionRoute } from './pages/Session';
import { SummaryPage } from './pages/Summary';

/**
 * How often a waiting browser asks whether it has been matched. Three seconds
 * is the latency somebody staring at a waiting screen actually feels, and at
 * one request per three seconds a waiting user sits far inside the Gateway's
 * per-user budget (120 requests a minute, services/gateway/src/rate-limit.ts).
 */
const MATCH_POLL_MS = 3_000;

/**
 * The wordmark's glyph: three bars going down and getting shorter, for a
 * subject you read downward into. Drawn rather than an image file so it takes
 * the text colour and stays sharp at any size, and so a theme switch needs no
 * second asset.
 */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4.5" width="18" height="3.4" rx="1.7" />
      <rect x="3" y="10.3" width="12.5" height="3.4" rx="1.7" opacity="0.72" />
      <rect x="3" y="16.1" width="7" height="3.4" rx="1.7" opacity="0.45" />
    </svg>
  );
}

export interface SessionSummary {
  question: Question;
  startedAt: string;
  endedAt: string;
  revealed: boolean;
}

/**
 * The shell: the header, and which screen is on the page.
 *
 * **A URL is a promise that the page can be rebuilt from it**, and every route
 * here keeps that promise by refetching rather than relying on state it was
 * handed. The one exception is `/summary`, which is assembled from what the
 * session page knew and has no endpoint behind it, so it travels in history
 * state and a refresh goes to the roadmap.
 */
export function App() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /** Read inside the poll below, which closes over its own render. A ref
   * rather than a dependency, because re-running the poll on every navigation
   * would restart its timer each time the reader moved. */
  const where = useRef(pathname);
  where.current = pathname;

  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Session | null>(null);
  /** True when a session appeared while the user was somewhere else, so the
   * header can say a partner has arrived rather than inviting them back to a
   * room they have never been in. */
  const [arrived, setArrived] = useState(false);
  /** Bumped when the queue is joined or left, purely to restart the watcher
   * below: the flag it reads lives in storage, which React cannot observe. */
  const [queuedAt, setQueuedAt] = useState(0);
  /** The signed-in reader's own name, for the header. Null while the profile
   * call is in flight, and for accounts made before names existed. */
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();

  /** Stable, because the session route depends on it inside an effect: an
   * inline arrow would change identity every render and refetch the room. */
  const forgetSession = useCallback(() => setActive(null), []);

  useEffect(
    () =>
      watchUser((next) => {
        setUser(next);
        setReady(true);
      }),
    [],
  );

  // Users creates the profile row lazily on this call, and `/match/join`
  // refuses a uid it has never seen, so this has to happen once per sign-in
  // before the user can reach anything that matters.
  //
  // Asking for the active session in the same pass is what stops the app lying
  // about where you are: navigating away from the editor closes the socket but
  // does not end anything, so without this the header would keep offering to
  // find a partner while you were still in a room.
  useEffect(() => {
    if (!user) {
      setDisplayName(null);
      return setActive(null);
    }
    // The profile call already returns the name, so keeping its answer costs
    // nothing. Failing to get one is not worth showing an error over: the
    // header simply says less.
    void ensureProfile()
      .then((profile) => setDisplayName(profile.displayName))
      .catch(() => {});
    void currentSession()
      .then(setActive)
      .catch(() => setActive(null));
  }, [user]);

  /**
   * Ask whether a partner has arrived, from wherever the reader happens to be.
   *
   * Being matched is caused by somebody else's request, and HTTP gives a server
   * no way to speak first, so the only way to find out is to keep asking. The
   * match screen could ask, but only while it is on screen, so somebody who
   * queued and went to read a lesson would be put into a session nobody told
   * them about. Asking from the shell means it is noticed from any page.
   *
   * The guard matters twice: only somebody actually waiting asks at all, and
   * `readQueued` returns null once the wait window has passed, which is what
   * stops an abandoned tab asking forever.
   */
  useEffect(() => {
    if (!user || active) return;
    if (!readQueued()) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    /**
     * Somebody on the match screen is watching for exactly this, so take them
     * into the room. Somebody who queued and wandered off to read a lesson is
     * not, and pulling them out of it mid-paragraph is hostile: they get the
     * header's "a partner arrived" instead, and go in when they choose.
     */
    const entered = (session: Session) => {
      clearQueued();
      setActive(session);
      if (where.current === '/match') void navigate(`/session/${session.id}`);
      else setArrived(true);
    };

    const ask = async () => {
      const queued = readQueued();
      if (stopped || !queued) return;

      try {
        const status = await matchStatus(queued.topic, queued.difficulty);
        if (stopped) return;

        if (status.status === 'matched') {
          entered(status.session);
          return;
        }

        // Neither matched nor queued: the claim was lost between Redis and
        // Postgres, or the entry aged out. Re-joining is the documented
        // recovery for both, and it cannot run past the wait window because
        // `readQueued` has already returned null by then.
        if (status.status === 'none') {
          const rejoined = await joinQueue(queued.topic, queued.difficulty);
          if (stopped) return;
          if (rejoined.status === 'matched') {
            entered(rejoined.session);
            return;
          }
        }
      } catch {
        // One failed check is not a reason to give up on the whole wait; the
        // next one is a few seconds away.
      }

      timer = setTimeout(() => void ask(), MATCH_POLL_MS);
    };

    void ask();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `navigate` is stable in react-router, so listing it satisfies the lint
    // rule without making this effect restart its timer.
  }, [user, active, queuedAt, navigate]);

  if (!ready) return <main className="muted">Loading…</main>;

  return (
    <>
      <header>
        <h1>
          <Link className="wordmark" to="/">
            <Mark />
            deepcs
          </Link>
        </h1>

        {/* Two groups, not one row of similar things. Left is where you can go;
            right is what is true about you — the session you are in, who you
            are signed in as, how the page looks. Mixing them made "Sign out"
            read as another destination. */}
        <nav className="nav-primary">
          {/* Links, not buttons that navigate. A `<button>` inside an `<a>` is
              invalid markup and behaves unpredictably, and a link is what these
              actually are: middle-click and open-in-new-tab work for free.
              `.navlink` gives them the look of the buttons beside them. */}
          <NavLink className="navlink" to="/">
            Roadmap
          </NavLink>

          {/* Three states, not two. "Return to session" while you are already
              looking at it is a link that goes nowhere, so being in the room
              gets its own quiet marker and only leaving it turns into a call to
              go back. */}
          {active ? (
            <SessionNavEntry
              sessionId={active.id}
              arrived={arrived}
              onSeen={() => setArrived(false)}
            />
          ) : (
            <NavLink className="navlink" to="/match">
              Find a partner
            </NavLink>
          )}
        </nav>

        <div className="nav-utility">
          {/* Who you are signed in as. Before the sign-out button rather than
              inside it, because a name is not a control and putting it in one
              made the button read as a destination. */}
          {displayName && <span className="who">{displayName}</span>}

          {/* Always present, signed in or out. Signed out it is the way in;
              signed in it is where you go to leave, and hiding it would mean
              the only account control appears and disappears depending on state
              the visitor cannot see. */}
          {user ? (
            <button className="quiet" onClick={() => void signOutUser()} title={user.email ?? ''}>
              Sign out
            </button>
          ) : (
            <NavLink className="navlink" to="/signin">
              Sign in
            </NavLink>
          )}

          <button
            className="quiet"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <Routes>
        {/* The roadmap and an open topic are the same screen: the panel sits
            over the map, so giving it its own URL is what makes Back close it
            rather than leave the site. */}
        <Route path="/" element={<Wide />}>
          <Route index element={<RoadmapPage signedIn={Boolean(user)} />} />
          <Route path="topic/:topic" element={<RoadmapPage signedIn={Boolean(user)} />} />
        </Route>

        <Route element={<Narrow />}>
          <Route path="/step/:id" element={<StepPage signedIn={Boolean(user)} />} />
          <Route path="/signin" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route
            path="/match"
            element={
              user ? (
                <MatchPage
                  active={active}
                  onJoined={setActive}
                  onQueueChanged={() => setQueuedAt(Date.now())}
                />
              ) : (
                <LoginPage />
              )
            }
          />
          <Route
            path="/session/:id"
            element={
              user ? <SessionRoute onEnded={forgetSession} /> : <Navigate to="/signin" replace />
            }
          />
          <Route path="/summary" element={<SummaryPage />} />
          {/* Anything else is a typo or a stale link, and the roadmap is the
              one page that always makes sense to land on. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

/**
 * The header entry for a session in progress, in three states rather than two.
 * "Return to session" is right for somebody who stepped out of a room they have
 * been in, and wrong for the person who queued, wandered off, and was matched
 * by their partner's request without ever seeing it: nothing has happened that
 * they could return from. They are told a partner turned up instead.
 */
function SessionNavEntry({
  sessionId,
  arrived,
  onSeen,
}: {
  sessionId: string;
  arrived: boolean;
  onSeen: () => void;
}) {
  const here = useLocation().pathname === `/session/${sessionId}`;

  useEffect(() => {
    if (here) onSeen();
  }, [here, onSeen]);

  if (here) return <span className="live">In session</span>;
  return (
    <NavLink className="navlink primary" to={`/session/${sessionId}`}>
      {arrived ? 'Partner found, join now' : 'Return to session'}
    </NavLink>
  );
}

/** The roadmap is a canvas and fills the window; every other screen is a
 * document and gets a reading width. Two layouts, one place each. */
function Wide() {
  return (
    <main className="wide">
      <Outlet />
    </main>
  );
}

function Narrow() {
  return (
    <main>
      <Outlet />
    </main>
  );
}
