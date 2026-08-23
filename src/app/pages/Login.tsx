import { useState } from 'react';
import { signIn, signUp } from '../auth';

/** Email and password only; Firebase owns credentials entirely. This form
 * hands them to the SDK and never sees a token except to attach it. */
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
      // Firebase codes read like `auth/invalid-credential`; show the tail.
      const code = (err as { code?: string }).code ?? 'unknown';
      setError(code.replace(/^auth\//, '').replace(/-/g, ' '));
    } finally {
      setBusy(false);
    }
  };

  /** Switching mode clears the error; it belonged to the other form. */
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
