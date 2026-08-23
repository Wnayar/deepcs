/**
 * Build-time environment. Every value here is public by design and ships in
 * the bundle: the Firebase API key identifies the project, it does not
 * authorize anything. The API needs no configured origin because it is
 * same-origin with the page.
 */

/** Points the Firebase SDK at the Auth emulator. Presence is the switch. */
export const AUTH_EMULATOR_URL = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR as string | undefined;

export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'fake-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-deepcs',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
};
