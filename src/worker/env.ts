/** Cloudflare's rate-limiting binding, keyed per call. */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Bindings and vars from wrangler.toml. The two Stripe values are secrets
 * (`wrangler secret put`) and optional: without them the repo still runs,
 * with checkout answering 503. The rate limiters are optional too, so local
 * dev and tests run without them. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  FIREBASE_PROJECT_ID: string;
  /** Test-only: an inline JWKS, so tests verify real signatures against a
   * local key pair instead of Google's. Never set in production. */
  AUTH_JWKS_JSON?: string;

  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;

  RATE_LIMIT_CHECKOUT?: RateLimit;
  RATE_LIMIT_WRITE?: RateLimit;
}
