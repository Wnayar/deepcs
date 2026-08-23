/**
 * Everything the browser needs to know about its environment, in one place.
 *
 * Vite only exposes variables prefixed `VITE_` to client code — anything else
 * in `.env` stays on the build machine. Every value here is public by design
 * and ships inside the JavaScript, which is normal for a Firebase web app:
 * the API key identifies the project, it does not authorise anything. The
 * Worker verifies every token against the project id before trusting a
 * single request.
 *
 * There is no API origin to configure: the SPA and `/api/*` are served from
 * one origin by the same Worker deployment, which is what makes CORS not
 * exist here (DESIGN.md §12).
 */

/**
 * Set locally to point the Firebase SDK at the Auth emulator instead of
 * Google. Its *presence* is the switch.
 */
export const AUTH_EMULATOR_URL = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR as string | undefined;

export const FIREBASE_CONFIG = {
  // The emulator ignores the key entirely; the docs use the literal
  // "fake-api-key" for exactly this reason.
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'fake-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-deepcs',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
};
