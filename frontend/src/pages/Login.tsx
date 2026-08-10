import { useState } from 'react';
import { signIn, signUp } from '../auth';

/**
 * Email and password only. Firebase owns credentials entirely (ADR-04) — this
 * form hands them to the SDK and never sees a token afterwards except to
 * attach it to requests.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (mode: 'in' | 'up') => {
    setBusy(true);
    setError(null);
    try {
      await (mode === 'in' ? signIn(email, password) : signUp(email, password));
    } catch (err) {
      // Firebase error codes read like `auth/invalid-credential`; the tail is
      // the only part worth showing.
      const code = (err as { code?: string }).code ?? 'unknown';
      setError(code.replace(/^auth\//, '').replace(/-/g, ' '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="auth"
      onSubmit={(event) => {
        event.preventDefault();
        void submit('in');
      }}
    >
      <h2>Sign in to find a partner</h2>
      <p className="muted">Browsing the question bank needs no account.</p>

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
        autoComplete="current-password"
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          Sign in
        </button>
        <button type="button" disabled={busy} onClick={() => void submit('up')}>
          Create account
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </form>
  );
}
