# The frontend

The frontend is a set of files a browser downloads. That is the whole difference
between it and the six services, and it is worth being explicit about before any
of the detail, because everything else follows from it.

**A service computes an answer per request.** `GET /roadmap` runs Questions'
code, which queries Postgres and builds JSON. Ask twice a minute apart and the
answer can differ, because the database can.

**The frontend is *static*** — the bytes are identical for every visitor, and no
code of ours runs to produce them:

```
GET /roadmap               Questions runs code, queries Postgres, builds JSON.
                           The answer depends on the database right now.

GET /assets/index-*.js     A file is handed over unchanged. Same bytes for
                           everyone, nothing of ours executes to produce it.
```

The program *inside* that file then runs on the visitor's own machine, and that
is what calls the six services for data. So our code does run — just not on our
side of the wire.

**Which means serving it is a job for anything that can return a file:** a CDN
(a network of caches near the visitor), an nginx container, an object store with
static hosting switched on. It is not a Node process. It has no database, no
port in `SERVICES`, and no `/health/ready`, which is why it is not under
`services/` and gets no Docker image
([`10-the-workspace.md`](10-the-workspace.md) §1).

**What serves it here: `make web`, and nothing else.** That is Vite's
development server. There is no production server for the frontend anywhere in
this repo — no image, no compose service, no Kubernetes manifest — because there
is nothing deployed for it to serve to
([ADR-05](../adr/05-kubernetes-locally-no-deployment.md)).
`pnpm --filter @deepcs/web build` produces the files that *would* be served, and
Part 3 is what changes between the two.

**The one obligation a static server still has**, and the one that gets missed:
answer `index.html` for paths it has never heard of, or every link into the app
except the root returns 404. Part 13 has why.

The rest of this page is the detail underneath all of that, using the real files
in this repo. Parts 1 to 6 are the mechanics: what a visitor receives and what is
in it. Parts 7 onward are the parts with a contract to break — the reveal rule,
the browser's half of the collab protocol, and what a URL is required to promise.

---

# Part 1 — The page a visitor receives is nearly empty

This is `frontend/index.html`, all of it bar a comment:

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

Notice what step 6 means: the first time any of the six services is involved is
*after* the page is already on screen. That is why the roadmap appears with its
layout first and its content a moment later.

# Part 3 — The file in the repo is not the file that ships

Two different things run, from the same source.

**`make web` runs Vite's development server.** It serves `/src/main.tsx`
directly, converting TypeScript and JSX to plain JavaScript as the browser asks
for each file, and pushing changes into the open page when you save. Convenient,
and nothing like a built bundle.

**`pnpm build` produces the four files that would actually be served.** Same
source, rewritten for delivery. This is the built `index.html`, and the
differences are the whole point:

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
  every import from `main.tsx` and packed the lot — React, the router, all the
  screens, the Yjs client, Monaco — into one file.
- **The filename contains a hash of the contents** (`index-CuimWudV.js`). Change
  one character of source and the name changes. This is deliberate: the browser
  can cache a hashed file for ever, because a new version arrives under a new
  name rather than as a stale copy of the old one.
- **A Content-Security-Policy was injected** by a plugin in
  `frontend/vite.config.ts`. A CSP is a list, enforced by the browser, of which
  addresses this page is allowed to talk to. It exists because the Gateway
  deliberately does not set one — it serves JSON, not HTML.

The CSP is injected **on build only**. The dev server needs inline scripts for
hot reload, and a policy loose enough to permit those is not a policy worth
having; the built bundle has no inline scripts, so it gets the strict version.
A `<meta>` tag is also the weaker form: it cannot express `frame-ancestors` or a
report endpoint, both of which need a response header from whatever serves the
files.

# Part 4 — What is in the files

| File | What it is |
|---|---|
| `index.html` | the empty shell above |
| `index-*.js` | React, the router, every screen, the API client, the Yjs collab client, and Monaco |
| `index-*.css` | every style, including the `:root` colour variables that make light and dark two lists of values rather than two stylesheets |
| `editor.worker-*.js` | Monaco's language work, run in a **web worker** — a second thread the browser gives you, so tokenising a large document cannot freeze typing |
| `inter-*.woff2` (×7) | the Inter reading face, split by script subset; the CSS names each file's `unicode-range`, so a browser fetches only the subset the page actually renders (latin, in practice) and the rest are never requested |

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
they say), and from then on the app attaches that token to every request. The
Gateway checks the signature and turns it into `X-User-Id`. That is
[`../adr/04-managed-auth.md`](../adr/04-managed-auth.md): we never hold
passwords, because we never see them.

Locally the SDK is pointed at the Auth emulator instead, and its *presence* is
the switch — `VITE_FIREBASE_AUTH_EMULATOR`, mirroring how the Gateway treats
`FIREBASE_AUTH_EMULATOR_HOST`. Note it is `localhost:9099` rather than compose's
`firebase-auth:9099`: the browser resolves that name from the host, not from
inside the container network.

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
as not possessing it. Vite only exposes variables prefixed `VITE_` to client
code, which makes it hard to leak a server-side value into a bundle by accident.

**Deliberately not in there:** the answers. `reference_md` never reaches a
browser through a session until Matching says both people consented — Part 7.
If the answers shipped in the bundle, "reveal" would be a UI state rather than a
permission, and anyone could read every answer with devtools open.

**Also not in there:** database credentials, Redis URLs, the addresses of the
five internal services. The browser knows one backend address, the Gateway's.

---

# Part 7 — The reveal rule, from the browser's side

The answer key lives in the same table row as the question, and two people are
supposed to see it only after both agree. **The obvious design puts the decision
in the one place an attacker controls**: let the browser ask Questions for the
answer once the UI decides it is allowed.

So the browser does not ask Questions. It asks **Matching**, which checks both
uids are in `reveal_consents` and only then fetches the text over the internal
network. Questions holds `reference_md` and has no idea who is in a session;
Matching knows exactly who consented and never stores the answer. Neither
service can release it alone, and that is a property of the data each one holds
rather than of a check either could forget
([`../adr/06-answers-never-enter-the-shared-doc.md`](../adr/06-answers-never-enter-the-shared-doc.md)).

Split the secret from the authority to release it, and a bug in either service is
not enough on its own.

Three things follow for the UI:

- **Until both consent there is no `referenceMd` field at all** — not an empty
  string, not a null, absent. A UI that trusted `revealed: false` while the text
  sat in the payload would have leaked it to anyone with developer tools open.
- **The response is `{ you, partner, revealed }`**, which is what the screen is
  actually asking, and it names nobody. The earlier shape returned the list of
  uids that had consented, so the moment your partner agreed you held their id.
- **The answer never enters the Yjs document.** A document replicates to every
  peer, so putting it there would hand it to both people the instant one
  consented. It arrives over HTTP, to one browser, as the result of a check.

Studying alone is a different route and a deliberately weaker check: signed in is
enough ([`03-questions.md`](03-questions.md) §4). Mutual consent is about
coordination inside a session, not secrecy — the lesson teaching that question is
public.

# Part 8 — The browser's half of the collab protocol

`frontend/src/collab.ts` has no `y-websocket` in
it, for the same reason the server does not use its server package: the framing
is this project's own, so a stock provider would not speak it. Writing it keeps
the wire format visible.

The two branches are **not symmetric**, and this is the detail that costs an
afternoon if missed — a sync message writes its body directly, an awareness
message is length-prefixed:

```ts
// sync
encoding.writeVarUint(encoder, MESSAGE_SYNC);   // 0
syncProtocol.writeUpdate(encoder, update);
// awareness
encoding.writeVarUint(encoder, MESSAGE_AWARENESS);   // 1
encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(...));
```

On open the client sends sync step 1; the server's step 2 reply is how the
scaffold and everything typed before now arrives. Anything whose origin is
`'server'` is not echoed back, or two clients would bounce one edit between them
for ever.

**`CollabStatus` has five values rather than a boolean**, because a rejection
looks different depending on who rejected. A bad token is refused by the Gateway
and the socket never opens. A refusal from Collab — not a participant, or the
session ended — arrives as a socket that *opens* and then closes having delivered
nothing, because `@fastify/http-proxy` completes the client handshake before
dialling upstream. The client tells them apart by whether `open` fired and
whether any bytes arrived, and only retries the case that can succeed. Close code
**4001** is a sixth outcome and terminal: the partner pressed End, the document on
screen is the final one, and reconnecting would loop for ever against a session
that will never accept it.

An ordinary drop reconnects after 1.5 seconds and resumes from the server's
snapshot, which is what makes a replaced Collab pod cost a reconnect and not any
edits ([`05-collab.md`](05-collab.md) §7).

**Nothing identifying goes into awareness.** It is broadcast to everyone else in
the room, so putting an email in it would hand your address to whoever you were
matched with, and a coloured caret already says the only thing the other person
needs to know. `y-monaco` publishes the selection itself; the client only marks
itself present.

**This client is tested against the real server**
(`frontend/src/collab.test.ts`). The server's framing already had tests, but
those ship their own reference client — `collab.ts` is a second implementation of
the same format, and until that suite existed nothing proved the two agreed.

# Part 9 — Monaco, bound to a document it does not own

```ts
const text: Y.Text = collab.doc.getText('content');
new MonacoBinding(text, editor.getModel()!, new Set([editor]), collab.awareness);
```

`"content"` is not a name chosen here — it is the field the Collab service seeds
the scaffold into, so binding to anything else yields an empty editor that syncs
with nobody. Passing `awareness` as the fourth argument is what makes remote
cursors appear; presence needed no code of its own.

**One effect owns the socket, the document, the editor and the binding**, because
they have exactly one lifetime between them. Splitting them is how you end up
with an editor bound to a destroyed document after a re-render, which is also why
the `react-hooks` lint rules are enabled.

**Monaco is imported as `editor.api`, not the package root.** The root registers
every language it ships with, and building against it emitted a 6.9 MB TypeScript
worker, a 1 MB CSS worker and a 740 kB HTML worker for a document that is prose.
The core is 792 kB gzipped, which is most of the bundle and inherent to the
editor chosen.

One dependency workaround lives next to it in `vite.config.ts`: `y-monaco`
imports `monaco-editor/esm/vs/editor/editor.api.js`, and Monaco 0.56 added an
`exports` map that rewrites `./*` to `./esm/vs/*`, so that specifier now resolves
to `esm/vs/esm/vs/...` and the build fails on a path that does not exist. A
two-line alias to the specifier the map does accept keeps both packages current;
the alternative was pinning Monaco back to suit one dependency's import style.

# Part 10 — Every screen is a URL

| Path | Screen |
|---|---|
| `/` | the roadmap |
| `/topic/:topic` | the roadmap with a topic panel open |
| `/step/:id`, `/step/:id?s=3`, `/step/:id?s=check` | a lesson, one section per screen; `s` names the section (or the closing check-yourself screen), so refresh keeps your place and Back is "previous section" |
| `/match`, `/match?topic=os&difficulty=easy` | find a partner, optionally preset |
| `/session/:id` | the shared editor |
| `/signin` | the sign-in form |
| `/summary` | the one screen with no promise to keep — see below |

The app navigated with a `useState` switch until there were six screens, and the
symptom people notice immediately is not the one you would predict: the whole
site lived at a single address, so the browser held **one history entry** for it
and Back left the site entirely. Refreshing lost your place, reloading
mid-session dropped you out of the room, and no lesson could be linked to.

**The rule every route is held to: a URL is a promise that the page can be
rebuilt from it.** So a route refetches rather than relying on state it was handed.
`SessionRoute` asks the server which session the caller is in and checks it
against the path, rather than trusting either the id or a session object handed
to it by whatever navigated there. That is what makes a refresh rejoin the same
document, and it makes a stale link to an ended session land on the roadmap
instead of on a broken page.

**An open topic panel has its own URL.** The panel sits over the map and is part
of the same screen, so it could have been component state. Giving it an address
means Back closes the panel instead of leaving the site, which is what anyone on
a phone will reach for.

**`/summary` cannot keep the promise, so it is the documented exception.** It is
assembled from what the session page knew when End was pressed and no endpoint
returns it, so it travels in history state and a refresh goes to the roadmap.
Giving it a real URL means building a summary endpoint.

*Why React Router rather than sixty lines on the History API?* The comparison
with the pan and zoom below is the reason. That is arithmetic with no edge cases
and nothing else depending on it, so hand-writing it cost a dependency and bought
full control. A router is not a leaf: it touches every screen, and its failure
modes are the tedious kind to find — double history entries, state drifting out
of step with the URL, Back landing on a screen whose data was never fetched.

**Navigation is `<NavLink className="navlink">`, never a `<button>` inside it.**
Interactive elements do not nest: a `<button>` inside an `<a>`, or an `<h3>`
inside a `<button>`, is invalid markup that React builds through the DOM, so
nothing visibly breaks and then clicks land unpredictably and assistive tech
reads it wrong. Both shipped here before being caught. A clickable card is a
`<button>` containing spans.

Routing also exposed a bug that had been there since matching was built and only
became visible once leaving a screen was easy: the match screen asked for a
result and unmounted when you navigated away, so somebody who queued and then
went to read a lesson was put into a session nobody told them about, while their
partner sat alone in the editor. The asking moved into the app shell, where it
runs from any page: `GET /match/status` every three seconds for as long as the
`localStorage` queued flag says this browser is waiting, and not one request
past the minute that flag expires after. Storage rather than React state is the
whole trick, because navigation and refresh both discard state and neither
discards this. `GET /match/session` takes no topic or difficulty, which is what
lets a client that has forgotten what it queued for still find its way back.

The header then has three states rather than two, and the third is the one worth
having. "Return to session" is right for someone who stepped out of a room they
have been in, and wrong for someone who has never seen it: nothing has happened
that they could return from. They are told a partner turned up instead.

# Part 11 — The roadmap canvas

Nodes never move. The whole interaction is one `translate` and one `scale`
applied to a single SVG group, which is why there is no graph library here: a
node editor solves a problem this screen does not have, at the cost of a
dependency and a large API to review.

Three details separate that from being unusable, and all three were wrong first
time:

1. **The pointer is not captured when a press starts.** Calling
   `setPointerCapture` on `pointerdown` routes every later event to the canvas,
   so the click never reaches the topic under the cursor and clicking a box did
   nothing at all. Movement is tracked on `window` instead, and a press that
   moves less than four pixels stays an ordinary click.
2. **The wheel listener is attached natively with `passive: false`.** React's
   `onWheel` cannot call `preventDefault`, so the page scrolled out from under
   the zoom and the map appeared to hit a boundary.
3. **`user-select: none` on the canvas.** Otherwise a drag across a label turns
   into a text highlight partway through and the pan stops.

A fourth was subtler and produced a page that looked simply empty. The canvas had
`height: 100%`, but `main` is a flex item with `flex: 1`, so its basis is zero
and any `height` set on it is ignored for layout. The percentage then had nothing
definite to resolve against and the canvas measured zero, so fitting the tree to
it worked out `(0 - padding) / treeHeight`: a **negative** scale, drawing
everything mirrored and shrunk to a speck. Nothing threw and nothing warned.

That is why the geometry lives in `roadmap-layout.ts` rather than inside the
component. `fitView` returns `null` for a canvas too small to have been laid out,
instead of answering with a number that renders nothing, and it is tested across
every plausible window size including ones too small to fit the tree at all.

**Scaling towards the pointer** is the part worth reading. Scaling towards the
origin makes the map slide away as it grows, which feels like the zoom is
fighting you; keeping whatever is under the cursor under the cursor is three
lines:

```js
const ratio = scale / v.scale;
x: pointer.x - (pointer.x - v.x) * ratio,
y: pointer.y - (pointer.y - v.y) * ratio,
```

A trackpad pinch arrives as a wheel event with `ctrlKey` set, which is the only
way a browser reports one, so both gestures zoom but at their own sensitivity: a
shared constant makes a pinch move in leaps or a wheel barely move at all.

Edges leave the bottom of one box and arrive at the top of another rather than
running centre to centre, which would draw the line through the boxes
themselves. Control points sit directly above and below those ends, so every
arrow reads as travelling downward even when two topics are far apart sideways.

# Part 12 — Themes are two lists of variables

Every colour is a custom property defined once on `:root` and redefined once
under `[data-theme='dark']`. **No component names a colour**, so a theme is a
list of variables rather than a second copy of the stylesheet, and there is no
rule that can be updated for one theme and forgotten for the other.

An explicit choice is stored and wins. With no choice made the system setting is
followed and *keeps* being followed, which is what makes the app go dark at
sunset along with everything else on the machine. `localStorage` is wrapped in a
try/catch because private browsing can refuse it outright, and losing the
preference between visits is a smaller problem than the page failing to render.

# Part 13 — Three rules only a browser enforces

None of these shows up in a terminal test, which is exactly why they are written
down. All three are properties of the code as it stands.

**1. CORS.** A browser will not let a page loaded from one address read a
response from a different one unless that other address says it is allowed. The
Gateway says so from `CORS_ORIGIN`, which defaults to `http://localhost:5173`.
Serve the bundle from any other origin without changing it and every call from
the page is blocked while curl works perfectly.

**2. The CSP is a hardcoded constant.** The policy in `frontend/vite.config.ts`
contains `http://localhost:8080` and `ws://localhost:8080` literally, baked in at
build time with nothing parameterising it. Build the bundle for any other Gateway
address and the browser refuses every call to it — as a CSP violation in the
console, which does not look like a configuration problem. Making `connect-src`
come from an environment variable at build time, the way `VITE_GATEWAY_URL`
already does, is the fix and is not done.

**3. Unknown paths need a rewrite.** Every screen is a URL and there is one HTML
file, so `/step/<uuid>` exists only once the bundle is running. Whatever serves
the files has to answer `index.html` for anything it does not find, or every link
into the app except the root returns 404. Vite's dev server and `vite preview`
both do this already, which is exactly why it is easy to miss: the failure shows
up only for shared links and refreshes, never while clicking around.

# Part 14 — How to say it in a minute

> The frontend is a React single-page application. The build produces four
> static files and there is no server rendering anything. The browser downloads
> an almost empty HTML shell and a JavaScript bundle, React builds the page on
> the client, and from then on the app calls the API Gateway for data,
> authenticating with a Firebase ID token it obtained directly from Google. The
> bundle is public by definition, so nothing secret is in it: the Firebase web
> key identifies a project rather than authorising anything, and the question
> answers are held behind a service that only releases them once both
> participants consent. The collab editor is the one piece that is not
> request/response — it holds a WebSocket open through the Gateway to the collab
> service, and a CRDT keeps the two documents converged.

Every clause in that paragraph is something you can then go one level deeper on,
which is what the rest of this page is for.

---

## Known gaps

- **No component tests.** The suites that exist test the protocol client and the
  queued-flag expiry, which are the parts with a contract to break. The pages are
  thin enough that a render test would mostly assert that React renders. The
  poll's *contract* is covered from the other side —
  [`reveal.test.ts`](../../services/matching/src/reveal.test.ts) drives a waiter
  from `waiting` to `matched` across a partner's join — but the React effect
  that runs it on a timer is not, so a broken interval or a missed cleanup would
  not fail a test.
- **No progress tracking.** There is no completed state and nothing to store it
  in. It needs a table, a route, and an opinion about what finishing means.
- **No history of your own past sessions.** The data exists in
  `matching.sessions` and `collab.snapshots`, but nothing reads it back, and a
  page for it needs an endpoint on each of two services because neither role may
  read the other's schema.
- **No search.** Nine topics fit on one screen.
- **Nothing serves the built bundle.** `make web` is the dev server; there is no
  production server for it here, for the reason at the top of this page.
