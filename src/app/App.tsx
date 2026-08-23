import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes } from 'react-router';
import { signOutUser, watchUser, type User } from './auth';
import { useTheme } from './theme';
import { useProgress } from './progress';
import { RoadmapPage } from './pages/Roadmap';
import { StepPage } from './pages/Step';
import { LoginPage } from './pages/Login';
import { UpgradePage, UpgradeThanksPage } from './pages/Upgrade';

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

/**
 * The shell: the header, and which screen is on the page.
 *
 * **A URL is a promise that the page can be rebuilt from it**, and every
 * route keeps that promise by refetching rather than relying on state it was
 * handed. Nothing here asks the server anything on a timer; the only poll in
 * the app is the bounded one on /upgrade/thanks.
 */
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, toggleTheme] = useTheme();

  // One call serves the whole shell: the reader's marks feed the map and the
  // topic panel, and `entitled` decides whether the header still sells.
  const progress = useProgress(Boolean(user));

  useEffect(
    () =>
      watchUser((next) => {
        setUser(next);
        setReady(true);
      }),
    [],
  );

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

        <nav className="nav-primary">
          <NavLink className="navlink" to="/">
            Roadmap
          </NavLink>
          {/* The one sales surface in the chrome, and only for readers who
              have something to buy: once entitled it disappears rather than
              lingering as a link to a page that has nothing to offer. */}
          {!progress.entitled && (
            <NavLink className="navlink" to="/upgrade">
              Unlock everything
            </NavLink>
          )}
        </nav>

        <div className="nav-utility">
          {/* Always present, signed in or out. Signed out it is the way in;
              signed in it is where you go to leave, and hiding it would mean
              the only account control appears and disappears depending on
              state the visitor cannot see. */}
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
          <Route index element={<RoadmapPage signedIn={Boolean(user)} progress={progress} />} />
          <Route
            path="topic/:topic"
            element={<RoadmapPage signedIn={Boolean(user)} progress={progress} />}
          />
        </Route>

        <Route element={<Narrow />}>
          <Route path="/step/:id" element={<StepPage signedIn={Boolean(user)} />} />
          <Route path="/signin" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route
            path="/upgrade"
            element={<UpgradePage signedIn={Boolean(user)} entitled={progress.entitled} />}
          />
          <Route path="/upgrade/thanks" element={<UpgradeThanksPage />} />
          {/* Anything else is a typo or a stale link, and the roadmap is the
              one page that always makes sense to land on. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
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
