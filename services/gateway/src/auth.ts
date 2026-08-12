import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';

/**
 * Firebase ID token verification.
 *
 * `jose` against Google's published JWKS rather than the Firebase Admin SDK,
 * deliberately: verification needs only public keys, so this service holds no
 * service-account credential and **cannot mint or revoke a token**. The blast
 * radius of a compromised Gateway is "can read traffic", not "can issue
 * identities". See docs/system/01-gateway.md §2.
 */

/**
 * Where Google publishes Firebase's ID-token signing keys, as x509 certificates
 * rather than a bare JWKS. This is the URL Firebase documents for `securetoken`
 * ID tokens specifically, and it is not the OAuth2 v3 certs URL.
 */
const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export class TokenError extends Error {
  constructor(
    message: string,
    readonly reason: 'malformed' | 'expired' | 'signature' | 'issuer' | 'audience',
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface VerifierOptions {
  projectId: string;
  /**
   * Presence of this switches to emulator mode. It is read from
   * FIREBASE_AUTH_EMULATOR_HOST by the caller rather than from the environment
   * here, so that the production guard lives in one place (see createVerifier).
   */
  emulatorHost?: string;
}

export interface VerifiedToken {
  uid: string;
  payload: JWTPayload;
}

/**
 * `createRemoteJWKSet` is the entire JWKS story: it fetches the key set on
 * first use, caches it, honours the response's Cache-Control, and re-fetches
 * when a token arrives with a `kid` it has not seen — which is what makes
 * Google's roughly-daily key rotation a non-event rather than a daily outage.
 *
 * Built once here, not per request: a per-request JWKS would put a round trip
 * to Google on the hot path of every single request.
 */
export function createVerifier({ projectId, emulatorHost }: VerifierOptions) {
  if (!projectId) {
    throw new Error(
      'FIREBASE_PROJECT_ID is not set — refusing to verify against an unknown project',
    );
  }

  /**
   * The emulator issues unsigned tokens, so that mode has to be impossible to
   * reach in production — and impossible is enforced by refusing to boot. A
   * Gateway that started with signature checking disabled would accept a token
   * anyone could forge in a text editor, and look completely healthy doing it.
   */
  if (emulatorHost && process.env.NODE_ENV === 'production') {
    throw new Error(
      'FIREBASE_AUTH_EMULATOR_HOST is set with NODE_ENV=production. ' +
        'The emulator issues unsigned tokens; accepting them in production ' +
        'means accepting forged identities. Refusing to start.',
    );
  }

  const issuer = `https://securetoken.google.com/${projectId}`;
  const jwks = emulatorHost ? null : createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

  return async function verify(token: string): Promise<VerifiedToken> {
    if (emulatorHost) return verifyEmulatorToken(token, { issuer, audience: projectId });

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks!, {
        issuer,
        /**
         * The line that matters most in this file. Google signs every Firebase
         * project's tokens with the *same* key set, so a validly-signed token
         * issued for someone else's project passes the signature, `exp` and
         * `iss`-shape checks. Without this the Gateway would accept it and hand
         * the request a stranger's UID.
         */
        audience: projectId,
        algorithms: ['RS256'],
      }));
    } catch (err) {
      throw asTokenError(err);
    }

    return toVerifiedToken(payload);
  };
}

/**
 * Emulator mode. The Auth emulator signs nothing — its tokens carry
 * `"alg": "none"` and an empty signature — so `jwtVerify` would reject them
 * outright.
 *
 * Everything that is *not* the signature is still checked: `iss`, `aud`, `exp`
 * and the presence of `sub`. Keeping those on the local path is what stops a
 * bug in the claim logic from hiding until it is somewhere that matters.
 */
async function verifyEmulatorToken(
  token: string,
  { issuer, audience }: { issuer: string; audience: string },
): Promise<VerifiedToken> {
  let payload: JWTPayload;
  try {
    payload = decodeJwt(token);
  } catch {
    throw new TokenError('token is not a well-formed JWT', 'malformed');
  }

  if (payload.iss !== issuer) {
    throw new TokenError(`unexpected issuer ${String(payload.iss)}`, 'issuer');
  }
  if (payload.aud !== audience) {
    throw new TokenError(`unexpected audience ${String(payload.aud)}`, 'audience');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    throw new TokenError('token has expired', 'expired');
  }

  return toVerifiedToken(payload);
}

function toVerifiedToken(payload: JWTPayload): VerifiedToken {
  /**
   * The UID is `sub`, not `user_id`. Firebase puts the same value in both, but
   * `sub` is the registered JWT claim and `user_id` is Firebase's own addition.
   * Keying off the standard one is what keeps "migrating provider is a
   * re-registration flow, not a rewrite" true (ADR-04).
   */
  const uid = payload.sub;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new TokenError('token has no subject', 'malformed');
  }
  return { uid, payload };
}

/**
 * jose signals failures by error `code`. Mapping them keeps the *reason* in
 * logs while the client still gets a flat 401 — telling an attacker whether a
 * token was expired or merely forged is free information.
 */
function asTokenError(err: unknown): TokenError {
  const code = (err as { code?: string }).code;
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return new TokenError('token has expired', 'expired');
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return new TokenError('signature verification failed', 'signature');
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
      const claim = (err as { claim?: string }).claim;
      if (claim === 'aud')
        return new TokenError('token was issued for another project', 'audience');
      if (claim === 'iss') return new TokenError('unexpected issuer', 'issuer');
      return new TokenError('claim validation failed', 'malformed');
    }
    default:
      return new TokenError('token is not a well-formed JWT', 'malformed');
  }
}

/**
 * Pull the bearer token out of an Authorization header.
 *
 * Returns null for "no token at all", which is a *valid* state: the bank, the
 * roadmap and /stats are public, so the Gateway has to distinguish "anonymous"
 * from "presented something broken" and reject only the second.
 */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

/**
 * Pull the token out of a `?token=` query param, e.g.
 *   wss://gateway/collab/connect?sessionId=...&token=<firebase-id-token>
 *
 * A browser's native WebSocket constructor cannot set an Authorization
 * header, so a WS upgrade is the one request type that authenticates this
 * way instead — see the onRequest hook in index.ts, which only consults this
 * for requests carrying an `Upgrade: websocket` header.
 */
export function queryToken(query: unknown): string | null {
  if (typeof query !== 'object' || query === null) return null;
  const value = (query as Record<string, unknown>).token;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
