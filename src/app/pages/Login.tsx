import { useState } from 'react';
import { signIn, signUp } from '../auth';

/**
 * Email and password only. Firebase owns credentials entirely (ADR-04) — this
 * form hands them to the SDK and never sees a token afterwards except to
 * attach it to requests.
 *
 * **The form picks a mode first**, and it did not always. Both actions used to
 * sit on one screen with every field showing, so a display name was on the page
 * while somebody was only trying to sign in: it reads as a third credential,
 * and one you could get wrong. It never was one, since the name is only sent on
 * sign-up and is ignored by the upsert on any later call, but a field that
 * cannot reject you still stops people who think it can.
 */
export function LoginPage() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creating = mode === 'up';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await (creating ? signUp(email, password) : signIn(email, password));
    } catch (err) {
      // Firebase error codes read like `auth/invalid-credential`; the tail is
      // the only part worth showing.
      const code = (err as { code?: string }).code ?? 'unknown';
      setError(code.replace(/^auth\//, '').replace(/-/g, ' '));
    } finally {
      setBusy(false);
    }
  };

  /** Switching mode clears the error, which otherwise belongs to the form you
   * just left and reads as a complaint about the one you are now looking at. */
  const switchTo = (next: 'in' | 'up') => {
    setMode(next);
    setError(null);
  };

  return (
    <form
      className="auth"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2>Tracking progress needs an account</h2>
      <p className="muted">
        Ticks and stars belong to somebody, so they are the one thing here that cannot be
        anonymous. Reading the free lessons and questions needs no account at all.
      </p>

      {/* Buttons rather than links: these switch what this form is, they do not
          navigate, and the URL is the same page either way. */}
      <div className="tabs" role="group" aria-label="Sign in or create an account">
        <button type="button" aria-pressed={!creating} onClick={() => switchTo('in')}>
          Sign in
        </button>
        <button type="button" aria-pressed={creating} onClick={() => switchTo('up')}>
          Create account
        </button>
      </div>

      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        autoComplete="username"
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <input
        type="password"
        placeholder="password"
        value={password}
        // Tells a password manager whether to offer a saved one or a new one.
        autoComplete={creating ? 'new-password' : 'current-password'}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          {creating ? 'Create account' : 'Sign in'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </form>
  );
}
