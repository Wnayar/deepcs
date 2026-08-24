# Architecture decisions

DESIGN.md states what the system *is*. These records state *why* — the
alternatives each choice beat and the tradeoff accepted. One decision per
file; a decision changes by adding a new record that supersedes an old one,
not by editing history.

| # | Decision |
|---|---|
| [001](001-one-deployable.md) | One deployable, not many |
| [002](002-platform-cloudflare-workers.md) | Platform: Cloudflare Workers |
| [003](003-content-as-static-files.md) | Content ships as static files in git |
| [004](004-database-d1.md) | Database: D1 (SQLite) |
| [005](005-identity-firebase.md) | Identity: Firebase Auth, verified in-Worker |
| [006](006-monetization-stripe-lifetime.md) | Monetization: Stripe Managed Payments, lifetime unlock |
| [007](007-free-paid-line-two-repos.md) | The free/paid line, history rewrite, two repos |
| [008](008-rate-limiting.md) | Rate limiting: per-uid binding plus edge rule |
| [009](009-frontend-react-vite.md) | Frontend: React + Vite SPA |
| [010](010-testing-strategy.md) | Testing: the pyramid and its tooling |
| [011](011-e2e-sign-in.md) | Signing in inside the e2e browser |
