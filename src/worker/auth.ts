import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './http';
import type { Env } from './env';

/**
 * Firebase ID token verification, in-process. Only Google's public keys are
 * involved, so nothing here can mint a token.
 *
 * The audience check is load-bearing: Google signs every Firebase project's
 * tokens with the same key set, so a token from a stranger's project passes
 * signature, exp, and issuer shape. Only `audience` rejects it.
 */

const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

type KeySet = ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet>;

/** Module scope: the key fetch happens once per isolate, not per request. */
let cachedKeySet: KeySet | null = null;

/**
 * Google's public keys, fetched on first use and reused for the isolate's life.
 *
 * An inline JWKS means tests, which verify real signatures against a local
 * key pair; no JWKS means production, which fetches Google's.
 */
function getKeySet(env: Env): KeySet {
  if (cachedKeySet !== null) {
    return cachedKeySet;
  }

  if (env.AUTH_JWKS_JSON) {
    const keys = JSON.parse(env.AUTH_JWKS_JSON);
    cachedKeySet = createLocalJWKSet(keys);
  } else {
    cachedKeySet = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }

  return cachedKeySet;
}

/** The verified caller's uid, or a thrown 401. */
export async function requireUid(request: Request, env: Env): Promise<string> {
  const header = request.headers.get('authorization');

  if (header === null) {
    throw new HttpError(401, 'sign in first');
  }

  if (!header.startsWith('Bearer ')) {
    throw new HttpError(401, 'sign in first');
  }

  const token = header.slice('Bearer '.length);

  let payload;
  try {
    const verified = await jwtVerify(token, getKeySet(env), {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
      algorithms: ['RS256'],
    });
    payload = verified.payload;
  } catch {
    // One flat answer: which check failed is not the caller's business.
    throw new HttpError(401, 'invalid token');
  }

  const uid = payload.sub;

  if (typeof uid !== 'string' || uid === '') {
    throw new HttpError(401, 'token has no subject');
  }

  return uid;
}
