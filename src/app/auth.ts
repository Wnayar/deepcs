import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
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

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email: string, password: string): Promise<void> {
  await createUserWithEmailAndPassword(auth, email, password);
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
