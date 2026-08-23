/** Everything the Worker is given. Bindings and vars come from
 * wrangler.toml; the two secrets exist only in Cloudflare's secret store
 * (DESIGN.md §12) and are optional here so the repo runs, fixtures and all,
 * with payments simply unconfigured (checkout answers 503). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  FIREBASE_PROJECT_ID: string;
  /** Test escape hatch: an inline JWKS (the public half of a throwaway test
   * key pair), so signature verification runs for real against local keys
   * instead of Google's. Never set in production. */
  AUTH_JWKS_JSON?: string;

  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
}
