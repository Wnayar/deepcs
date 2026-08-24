import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { loadEnv } from 'vite';
import { mintToken } from '../integration/helpers';

/**
 * Signing in for real is not possible here: the only doors are the Google
 * and GitHub popups, which need the network and a provider account. So a
 * test hands the Firebase SDK the session a returning reader would have
 * restored, carrying a real RS256 token minted from the committed throwaway
 * key. The Worker verifies that token exactly as in production; what is
 * skipped is Google's login screen, not the trust boundary (DESIGN.md §11).
 */

/** The SDK keys its stored session by API key, so this has to resolve the
 * same value the bundle compiled in (src/app/config.ts). */
const API_KEY =
  loadEnv('production', process.cwd(), 'VITE_').VITE_FIREBASE_API_KEY ?? 'fake-api-key';

/** A uid no run has used before. The local D1 file outlives the suite, so
 * fixed uids would let one run inherit the last one's rows. */
export function freshUid(flow: string): string {
  return `e2e-${flow}-${randomUUID().slice(0, 8)}`;
}

export async function signIn(page: Page, uid: string): Promise<void> {
  // Google's identity endpoints must not be reachable from this suite. The
  // SDK reloads a restored user on startup and keeps it when that call
  // fails, which is what already happens to a reader on a dead network.
  await page.route('**://*.googleapis.com/**', (route) => route.abort());

  const session = {
    uid,
    email: `${uid}@example.test`,
    emailVerified: true,
    displayName: 'E2E reader',
    isAnonymous: false,
    // No photoURL: the header would fetch it from a provider CDN.
    providerData: [
      {
        providerId: 'google.com',
        uid,
        displayName: 'E2E reader',
        email: `${uid}@example.test`,
        phoneNumber: null,
        photoURL: null,
      },
    ],
    stsTokenManager: {
      refreshToken: `${uid}-refresh`,
      accessToken: await mintToken(uid),
      // Inside the token's own hour, so nothing reaches for a refresh.
      expirationTime: Date.now() + 3_000_000,
    },
    createdAt: String(Date.now()),
    lastLoginAt: String(Date.now()),
    apiKey: API_KEY,
    appName: '[DEFAULT]',
  };

  await page.addInitScript(
    (stored: { key: string; value: string }) =>
      window.localStorage.setItem(stored.key, stored.value),
    { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, value: JSON.stringify(session) },
  );
}
