import { afterEach, describe, expect, it } from 'vitest';
import { bearerToken, createVerifier, queryToken, TokenError } from './auth.js';

const PROJECT = 'demo-deepcs';
const ISSUER = `https://securetoken.google.com/${PROJECT}`;
const EMULATOR = 'firebase-auth:9099';

/**
 * Build a token in the shape the Firebase Auth emulator issues: `alg: none`,
 * empty signature. Written by hand rather than fetched from a running emulator
 * so these tests need nothing but the file under test.
 */
function emulatorToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

const validClaims = (overrides: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: PROJECT,
  sub: 'uid-abc123',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  ...overrides,
});

describe('bearerToken', () => {
  it('returns null when there is no Authorization header at all', () => {
    // Not an error: the bank, the roadmap and /stats are public, so "no
    // token" is a valid state that must fall through to anonymous.
    expect(bearerToken(undefined)).toBeNull();
  });

  it('returns null for a non-bearer scheme', () => {
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('is case-insensitive on the scheme', () => {
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Bearer abc')).toBe('abc');
  });
});

describe('queryToken', () => {
  // Collab's WS handshake: a browser's native WebSocket constructor
  // can't set an Authorization header, so the token travels as ?token=
  // instead. The onRequest hook in index.ts only consults this for requests
  // carrying an Upgrade: websocket header — these tests cover the parsing
  // itself, not that gating.
  it('reads the token from a query object', () => {
    expect(queryToken({ token: 'abc123' })).toBe('abc123');
  });

  it('returns null when token is missing', () => {
    expect(queryToken({ sessionId: 's1' })).toBeNull();
  });

  it('returns null for an empty token', () => {
    expect(queryToken({ token: '' })).toBeNull();
  });

  it('returns null for a non-string token', () => {
    expect(queryToken({ token: ['abc'] })).toBeNull();
  });

  it('returns null for a non-object query', () => {
    expect(queryToken(undefined)).toBeNull();
    expect(queryToken(null)).toBeNull();
    expect(queryToken('token=abc')).toBeNull();
  });
});

describe('emulator verification', () => {
  const verify = createVerifier({ projectId: PROJECT, emulatorHost: EMULATOR });

  it('accepts a well-formed emulator token and returns sub as the uid', async () => {
    const { uid } = await verify(emulatorToken(validClaims()));
    expect(uid).toBe('uid-abc123');
  });

  it('rejects an expired token', async () => {
    const token = emulatorToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 1 }));
    await expect(verify(token)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('rejects a token issued for a different Firebase project', async () => {
    // The classic mistake this guards: Google signs every project's tokens
    // with the same key set, so without an audience check a validly-signed
    // token from someone else's project would be accepted here.
    const token = emulatorToken(validClaims({ aud: 'someone-elses-project' }));
    await expect(verify(token)).rejects.toMatchObject({ reason: 'audience' });
  });

  it('rejects a token from an unexpected issuer', async () => {
    const token = emulatorToken(validClaims({ iss: 'https://evil.example.com' }));
    await expect(verify(token)).rejects.toMatchObject({ reason: 'issuer' });
  });

  it('rejects a token with no subject', async () => {
    const token = emulatorToken(validClaims({ sub: undefined }));
    await expect(verify(token)).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('rejects a tampered payload', async () => {
    // Flipping a character in the payload segment of an *unsigned* token still
    // has to fail, and it fails on claim checks rather than on signature —
    // which is precisely why the emulator path checks every claim.
    const token = emulatorToken(validClaims());
    const [header, payload, sig] = token.split('.');
    const tampered = `${header}${payload}x.${sig}`;
    await expect(verify(tampered)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects garbage that is not a JWT at all', async () => {
    await expect(verify('not-a-token')).rejects.toMatchObject({ reason: 'malformed' });
  });
});

describe('the production guard', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('refuses to construct a verifier with the emulator enabled in production', () => {
    // The emulator issues UNSIGNED tokens, so this flag has to be impossible
    // to set in production. "Impossible" is enforced by refusing to
    // boot — a Gateway that started this way would accept tokens anyone could
    // forge in a text editor, and would look perfectly healthy doing it.
    process.env.NODE_ENV = 'production';
    expect(() => createVerifier({ projectId: PROJECT, emulatorHost: EMULATOR })).toThrow(
      /refusing to start/i,
    );
  });

  it('allows the emulator outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => createVerifier({ projectId: PROJECT, emulatorHost: EMULATOR })).not.toThrow();
  });

  it('refuses to construct a verifier with no project id', () => {
    expect(() => createVerifier({ projectId: '' })).toThrow(/FIREBASE_PROJECT_ID/);
  });
});
