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

/** Module scope: the key fetch happens once per isolate, not per request. */
let jwks: ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet> | null =
  null;

function keySet(env: Env) {
  jwks ??= env.AUTH_JWKS_JSON
    ? createLocalJWKSet(JSON.parse(env.AUTH_JWKS_JSON))
    : createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

/** The verified caller's uid, or a thrown 401. */
export async function requireUid(request: Request, env: Env): Promise<string> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'sign in first');

  try {
    const { payload } = await jwtVerify(header.slice('Bearer '.length), keySet(env), {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
      algorithms: ['RS256'],
    });
    if (typeof payload.sub !== 'string' || payload.sub === '')
      throw new HttpError(401, 'token has no subject');
    return payload.sub;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'invalid token');
  }
}
