import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { AUTH_EMULATOR_URL, FIREBASE_CONFIG } from './config';

const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

if (AUTH_EMULATOR_URL) {
  connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
}

export type { User };

export function watchUser(onChange: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, onChange);
}

/* Google and GitHub only, no passwords: nothing to brute force, no
 * verification emails to run, and a bot needs a real provider account per
 * fake user, which prices out mass signup. The Worker never knows which
 * door was used; it only verifies the token. */

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  // An explicit click always shows the account picker: signing out then
  // back in must be able to choose a different account. Silent session
  // restore is untouched; this only runs when the button is pressed.
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export async function signInWithGithub(): Promise<void> {
  await signInWithPopup(auth, new GithubAuthProvider());
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

/**
 * The current ID token. Fetched per request rather than cached: tokens last
 * an hour and the SDK refreshes them, so a cached copy silently turns into
 * 401s.
 */
export async function idToken(): Promise<string | null> {
  return (await auth.currentUser?.getIdToken()) ?? null;
}
