/**
 * Everything the browser needs to know about its environment, in one place.
 *
 * Vite only exposes variables prefixed `VITE_` to client code — anything else
 * in `.env` stays on the build machine. That is a feature rather than an
 * inconvenience: it makes it impossible to leak a server-side secret into a
 * bundle by mistake. Every value here is public by design and ships inside the
 * JavaScript, which is normal for a Firebase web app: the API key identifies
 * the project, it does not authorise anything. The Gateway still verifies
 * every token against the project id before trusting a single request.
 */

/** Where the Gateway is. Every request in the app goes through it — no page
 * ever talks to a service directly. */
export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

/**
 * Set locally to point the Firebase SDK at the Auth emulator instead of
 * Google. Its *presence* is the switch, mirroring how the Gateway treats
 * `FIREBASE_AUTH_EMULATOR_HOST`.
 *
 * Note this is `localhost:9099` and not compose's `firebase-auth:9099` — the
 * browser resolves it from the host, not from inside the container network.
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

/** The WebSocket origin, derived rather than configured separately so the two
 * can never disagree about which Gateway they mean. */
export const GATEWAY_WS_URL = GATEWAY_URL.replace(/^http/, 'ws');
