# ADR-009: Frontend — React + Vite SPA

**Status:** Accepted, 2026-08-23.

## Context

The frontend must be static assets served from the edge, with a tiny API
called only for progress and checkout. There is no SSR requirement: it is an
app behind sign-in, not a content site needing crawlable HTML.

## Decision

A React + Vite single-page app. `vite build` output is the asset directory;
the SPA fallback (unknown path → `index.html`, 200) is one line of Workers
config.

## Alternatives considered

| Option | Fit | Verdict |
|---|---|---|
| **React + Vite SPA** | perfect: the build output *is* the asset dir | ✅ chosen |
| Next.js on Workers (OpenNext) | needs a server runtime for SSR — reintroduces compute on the read path static assets just made free | ❌ SSR/SEO this app does not need |
| Astro SSG + islands | good for the lessons | ❌ two rendering models instead of one, for markdown-to-HTML the client already does |

## Consequences

"Every screen is a URL" holds with no exception, and every route refetches
rather than trusting handed state, so any link rebuilds. The only poll in the
app is the bounded post-purchase entitlement check.
