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

/**
 * Firebase is the only thing in this system that issues identity (ADR-04).
 * The browser's job is to obtain an ID token and attach it to requests; it
 * never checks one. That check happens once, at the Gateway, which is the
 * only component holding the project id it verifies against.
 *
 * Note the asymmetry with the backend: the Gateway depends on `jose` and can
 * *only* verify, deliberately holding no credential that could mint a token.
 * This is the opposite half — it can obtain tokens and cannot verify them.
 */
const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

if (AUTH_EMULATOR_URL) {
  // `disableWarnings` because the SDK logs a loud banner about talking to an
  // emulator, which is precisely what we want here and not worth the noise.
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
 * The current ID token, refreshed by the SDK when it is close to expiring.
 *
 * Fetched per request rather than cached in a module variable: Firebase tokens
 * last an hour, and a collab session can outlive one. Holding the first token
 * forever would mean a page that worked for fifty minutes and then started
 * returning 401 for no visible reason.
 */
export async function idToken(): Promise<string | null> {
  return (await auth.currentUser?.getIdToken()) ?? null;
}
