# How the frontend actually works, from nothing

You have the shape of it right: the frontend is a set of files a browser
downloads. This is the detail underneath that, using the real files in this
repo, so you can explain it without hedging.

The design *reasoning* — the reveal rule, the collab protocol, why Monaco is
bound to a document it does not own — is in
[phases/5-frontend.md](./phases/5-frontend.md). This page is the mechanics.

---

# Part 1 — The page a visitor receives is nearly empty

This is `frontend/index.html`, the entire thing, comment and all:

```html
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>deepcs</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

There is no roadmap in it. No lesson text, no editor, no navigation. `<div
id="root">` is empty, and it stays empty until JavaScript fills it.

That is the single fact everything else follows from: **the server sends an
empty container and a program, and the program builds the page on the
visitor's own machine.**

# Part 2 — What happens, in order, on a first visit

```
  1. GET /                    →  index.html            1.15 kB
  2. GET /assets/index-*.js   →  the whole application  822 kB compressed
     GET /assets/index-*.css  →  every style             15 kB compressed
  3. the browser runs the JavaScript
  4. React builds the page inside <div id="root">
  5. the router reads the address bar and picks a screen
  6. that screen calls our API for data
  7. the data arrives, the screen re-renders with it
  ───────────────────────────────────────────────────────────
  steps 1–5 touch no backend of ours at all
```

Step 3 to 4 is `frontend/src/main.tsx`, which is four lines of real work:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

`createRoot(...).render(...)` hands React that empty div and says "this is
yours now". React then creates the actual elements — headings, buttons, the
editor — inside it. **React** is a library for describing what the page should
look like for a given set of data, and then keeping the real page in step when
the data changes.

Notice what step 6 means: the first time any of your six services is involved
is *after* the page is already on screen. That is why the roadmap appears with
its layout first and its content a moment later.

# Part 3 — The file in the repo is not the file that ships

Two different things run, from the same source.

**`make web` runs Vite's development server.** It serves `/src/main.tsx`
directly, converting TypeScript and JSX to plain JavaScript as the browser asks
for each file, and pushing changes into the open page when you save. Convenient,
and nothing like production.

**`pnpm build` produces the files that actually deploy.** Same source, rewritten
for delivery. This is the built `index.html`, and the differences are the whole
point:

```html
    <title>deepcs</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' http://localhost:8080 …" />
    <script type="module" crossorigin src="/assets/index-CuimWudV.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-rcFrx00Z.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
```

Three changes:

- **The script now points at a bundle**, not at `/src/main.tsx`. Vite followed
  every import from `main.tsx` and packed the lot — React, the router, all your
  screens, the Yjs client, Monaco — into one file.
- **The filename contains a hash of the contents** (`index-CuimWudV.js`). Change
  one character of source and the name changes. This is deliberate: the browser
  can cache a hashed file for ever, because a new version arrives under a new
  name rather than as a stale copy of the old one.
- **A Content-Security-Policy was injected** by a plugin in
  `frontend/vite.config.ts`. A CSP is a list, enforced by the browser, of which
  addresses this page is allowed to talk to. It exists because the Gateway
  deliberately does not set one — it serves JSON, not HTML.

# Part 4 — What is in the four files

| File | What it is |
|---|---|
| `index.html` | the empty shell above |
| `index-*.js` | React, the router, every screen, the API client, the Yjs collab client, and Monaco |
| `index-*.css` | every style, including the `:root` colour variables that make light and dark two lists of values rather than two stylesheets |
| `editor.worker-*.js` | Monaco's language work, run in a **web worker** — a second thread the browser gives you, so tokenising a large document cannot freeze typing |

# Part 5 — The browser talks to two different backends

This surprises people, and it is worth being able to say clearly:

```
                  ┌─────────────────────────────┐
   the browser ───┤ Firebase Auth (Google)      │  sign in, receive an ID token
        │         └─────────────────────────────┘
        │
        │  every API call carries that token
        ▼
   ┌──────────────────────────────────────────┐
   │ our Gateway                              │  verifies the token, injects
   │  → Users, Questions, Matching, Collab    │  X-User-Id, routes onward
   └──────────────────────────────────────────┘
```

Signing in never touches our code. The Firebase SDK in the bundle talks to
Google, gets back an **ID token** (a signed statement that this person is who
they say), and from then on the app attaches that token to every request. Our
Gateway checks the signature and turns it into `X-User-Id`. That is ADR-04: we
never hold passwords, because we never see them.

The collab editor is the exception in shape but not in principle — it opens a
WebSocket to the Gateway with the token in the query string, because a browser's
WebSocket constructor cannot set an Authorization header.

# Part 6 — The bundle is public, and one thing in it looks like a secret

Anyone can open developer tools and read every line of `index-*.js`. So the
question worth being able to answer is: what is in there, and is any of it
sensitive?

**In there, and fine:** the Firebase web API key. It identifies which Firebase
project to talk to; it authorises nothing. The Gateway still verifies every
token's signature and audience, so possessing the key gets you exactly as far
as not possessing it.

**Deliberately not in there:** the answers. `reference_md` never reaches a
browser until Matching says both people consented — the reveal rule from phase
5. If the answers shipped in the bundle, "reveal" would be a UI state rather
than a permission, and anyone could read every answer with devtools open.

**Also not in there:** database credentials, Redis URLs, the addresses of the
five internal services. The browser knows one backend address, the Gateway's.

# Part 7 — Three ways the deploy will work in curl and fail in a browser

All three are browser-enforced rules, which is why they never show up in a
terminal test.

**1. CORS.** A browser will not let a page loaded from one address read a
response from a different one unless that other address says it is allowed.
The Gateway does say so, from `CORS_ORIGIN`, which is `http://localhost:5173`
today. Deploy without changing it and every call from the live site is blocked
while curl works perfectly. *Fix: set `CORS_ORIGIN` to the Hosting address.*

**2. The Content-Security-Policy, and this one is already a bug waiting.** The
policy in `frontend/vite.config.ts` is a hardcoded constant containing
`http://localhost:8080` and `ws://localhost:8080`. It is baked in at build time
and nothing parameterises it. Build the frontend for production as it stands and
the browser will refuse every call to the real Gateway — as a CSP violation in
the console, which does not look like a configuration problem. *Fix: make the
`connect-src` entry come from an environment variable at build time, the same
way `VITE_GATEWAY_URL` already does.*

**3. Unknown paths.** Every screen is a URL, and there is one HTML file. Opening
`/step/abc` directly asks the host for a file at that path. *Fix: the rewrite
rule in Part 6 of [cost.md](./cost.md) — serve `index.html` for anything not
found, and let the router sort it out.*

# Part 8 — How to say it in a minute

> The frontend is a React single-page application. The build produces four
> static files, and those are served from a CDN — there is no server rendering
> anything. The browser downloads an almost empty HTML shell and a JavaScript
> bundle, React builds the page on the client, and from then on the app calls
> our API Gateway for data, authenticating with a Firebase ID token it obtained
> directly from Google. The bundle is public by definition, so nothing secret is
> in it: the Firebase web key identifies a project rather than authorising
> anything, and the question answers are held behind a service that only
> releases them once both participants consent. The collab editor is the one
> piece that is not request/response — it holds a WebSocket open through the
> Gateway to the collab service, and a CRDT keeps the two documents converged.

Every clause in that paragraph is something you can then go one level deeper on,
which is what the rest of this page is for.
