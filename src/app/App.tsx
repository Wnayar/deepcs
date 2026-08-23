import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes } from 'react-router';
import { signOutUser, watchUser, type User } from './auth';
import { useTheme } from './theme';
import { useProgress } from './progress';
import { RoadmapPage } from './pages/Roadmap';
import { StepPage } from './pages/Step';
import { LoginPage } from './pages/Login';
import { UpgradePage, UpgradeThanksPage } from './pages/Upgrade';

/** The wordmark glyph. Inline SVG so it takes the text colour and follows
 * theme switches. */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4.5" width="18" height="3.4" rx="1.7" />
      <rect x="3" y="10.3" width="12.5" height="3.4" rx="1.7" opacity="0.72" />
      <rect x="3" y="16.1" width="7" height="3.4" rx="1.7" opacity="0.45" />
    </svg>
  );
}

/** The shell: the header, and which screen is on the page. Every route
 * refetches rather than trusting handed state, so any URL rebuilds. */
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, toggleTheme] = useTheme();

  // Shared here because the header, the map, and the topic panel read it.
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
          {/* Hidden once entitled: the page it links to has nothing left to
              sell. */}
          {!progress.entitled && (
            <NavLink className="navlink" to="/upgrade">
              Unlock everything
            </NavLink>
          )}
        </nav>

        <div className="nav-utility">
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
        {/* An open topic is the same screen as the map; its own URL makes
            Back close the panel rather than leave the site. */}
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

/** The map fills the window; every other screen gets a reading width. */
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
