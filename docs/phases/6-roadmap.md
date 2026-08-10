# Phase 6 — The roadmap, and fixing content at the source

Phases 1 to 5 built a question bank and a way to solve one with a stranger.
What they did not build was a reason to be there before you could already
answer things. The bank was the front page, which put the drills in front of
the material, and the Learn section added afterwards sat beside it as a second
list of the same nine topics.

This phase merges them into one map. Topics are laid out by what makes what
easier to read, clicking one opens its three steps, and a step is a page
holding a lesson and the questions it prepares you for.

Most of the work is in the database, because most of the problem was there.

---

# The four things — read this page, then stop if you're short on time

## 1. Fix the source, not the view · ~10 min

Three separate things were being corrected in the browser at render time, and
each one was a symptom of stored data being in the wrong shape:

| Stored | Corrected in the browser | Now |
|---|---|---|
| `## Process vs thread?` | `numberReference()` rewrote headings to `1.` on every render | Stored as `### 1. Process vs thread?` |
| One lesson per topic, headed `Day 1`, `Day 2` | Nothing could fix this, so it just showed | One lesson per step, no day headings |
| Em dashes in every string | Nothing yet, and that is the point | Removed from the seed |

The argument against display-time fixes is not that they are slow. It is that
they have to be remembered at every place the text is displayed, and the place
that gets forgotten is the one nobody looks at. `numberReference` was applied
on the step page and in the session reveal, and would have needed applying
again anywhere else an answer appeared.

`repository.test.ts` asserts both properties against the database, so the
question is settled where the data is rather than where it is drawn.

## 2. The extraction cut in the wrong place, and published the answers · ~10 min

The lessons and the questions come from the same source files. Each file
teaches a topic and then ends with its drill questions *and their answers*,
which is where `reference_md` came from. Extracting a lesson means cutting each
file before that section, and the cut is the whole security boundary:
everything above it is public teaching material, everything below it is the
answer key the reveal rule exists to withhold.

The first pattern anchored the phrase to the start of a heading:

```js
/^#{1,3}\s*\**\s*(high-value interview questions|interview questions)/i
```

That matches the overview files, headed `# **High-Value Interview Questions to
Drill**`. It does not match the day files, headed `## Part 6 — The Interview
Questions, Answered`. Three topics' worth of answers went into a table served
on a route with no authentication.

Nothing about it was visible in review. The migration applied, the tests
passed, the pages rendered, and the leaked text sat below the fold of a long
lesson. What found it was asking the database a question nobody had asked:
does any slice of any answer appear in the lesson for its topic?

That question is now a test, and since a lesson and its answers are the same
row it is tighter than it was. Six slices from each of the 27 answers are
looked for in the lesson that teaches it. Slices containing `;{}()=` are
excluded, because the notes legitimately teach the code snippet they later
reference: the producer and consumer `pthread_cond_wait` example is in both,
correctly.

Put the old pattern back and the test names the topics that leak.

## 3. A lesson belongs to a step, not to a topic · ~5 min

The first version keyed lessons by topic, which gave nine rows and a 33KB
Operating Systems page covering all three question sets at once. Keying them by
step gives 27, each holding exactly the material for the questions beside it.

Five topics have one source file per step already, so they map straight across.
Four are a single file that the bank had itself split three ways, and their
sections line up with those three: Security's concepts 1 and 2 are
"Authentication, Authorization & Password Storage", 3 and 4 are "Sessions,
Tokens & HTTPS", 5 and 6 are "Common Attacks & Safe Defaults".

AI Tooling is the one that does not divide at a heading. Its glossary covers
both step 1 and step 2 in one list, so that split is by term: Prompt, Context,
Token and Context window go to step 1, RAG, Agent, Orchestration and
fine-tuning to step 2, Hallucination to step 3 with Responsible AI.

`step` and `difficulty` are separate columns holding the same information by
construction, and that is deliberate. They answer different questions: one is
"what do I read next", the other is "who can I be matched with". Collapsing
them would mean the reading order could not change without changing who gets
paired with whom.

## 4. The lines are a recommendation, not a dependency graph · ~5 min

`depends_on`, `grid_x` and `grid_y` are seeded rather than computed in the
browser. A layout algorithm over the graph would have been the obvious move and
the wrong one: where a topic sits is a claim about what to read first, which is
a judgement about the material, not something a spring simulation should decide.

The name `depends_on` is slightly stronger than what the column means, and the
screen is careful not to repeat the overstatement. Nothing is locked and nothing
is checked. A line says "this is the order I would read them in", so the lines
only have to lead the eye downward, and the curves are deliberately loose
rather than routed around obstacles.

The shape is one tree with a single root, widening and narrowing as it goes
down:

```
                        Operating Systems
                       /                 \
              Networking          Object-Oriented Programming
              /         \                        |
      Databases      Security                Debugging
              \          |                   /
                    System Design
                   /             \
            AI Tooling        Behavioural
```

Operating Systems is the root because nearly everything below leans on knowing
what a process, a thread and memory are. It splits into a machine side and a
code side, widens to three, and converges on System Design, which is mostly
everything above it applied at scale.

AI Tooling and Behavioural close it out, and that placement is honest about
something: neither actually requires anything above it. They are last because
they are the two you can pick up whenever you like, not because they are hard.

The one property worth enforcing is that every line points downward, so a topic
always sits below whatever precedes it. A test checks it, because seeded
coordinates make it something a typo can break and an upward line reads as a
cycle.

---

# Read the code in this order

| File | Why |
|---|---|
| `packages/db/migrations/009_roadmap.sql` | The topics, their prerequisites and positions, and 27 lessons. |
| `services/questions/src/repository.ts` | `getRoadmap` and `getStep`: one query per screen. |
| `services/questions/src/index.ts` | The two routes, and which one is cached. |
| `services/gateway/src/index.ts` | `ROUTES`: three prefixes reach Questions, one per screen. |
| `frontend/src/roadmap-layout.ts` | The geometry, kept out of the component so it can be tested. |
| `frontend/src/pages/Roadmap.tsx` | Pan, zoom, and why a press is not captured on pointerdown. |
| `frontend/src/pages/Step.tsx` | Questions, then lesson, then the answer. |
| `frontend/src/App.tsx` | The route table, and why nav entries are links. |
| `frontend/src/styles.css` | The tokens both themes are built from. |
| `services/questions/src/repository.test.ts` | The guards for all of the above. |

---

# Part 1 — One query per screen

`getRoadmap` returns nine topics each carrying its three steps, and `getStep`
returns one step with its lesson, its questions and its sibling steps. Each is
a single request because each is a single screen, and both use a lateral
subquery rather than a join plus grouping in JavaScript.

The roadmap is one call rather than nine for a reason beyond convenience: the
screen draws arrows between topics, so a partly loaded roadmap is a wrong
roadmap rather than a short one. There is nothing sensible to render from half
the graph.

The roadmap is cached for 60 seconds and a step is not. The lesson bodies are
around 400KB together and each is read once per visit, so caching them would
trade a primary key lookup for holding the whole corpus in Redis.

---

# Part 2 — Pan and zoom without a library

Nodes never move. The whole interaction is one `translate` and one `scale`
applied to a single SVG group, which is why there is no graph library here: a
node editor solves a problem this screen does not have, at the cost of a
dependency and a large API to review.

Three details separate that from being unusable, and all three were wrong in
the first attempt:

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

A fourth was subtler and produced a page that looked simply empty. The canvas
had `height: 100%`, but `main` is a flex item with `flex: 1`, so its basis is
zero and any `height` set on it is ignored for layout. The percentage then had
nothing definite to resolve against and the canvas measured zero, so fitting the
tree to it worked out `(0 - padding) / treeHeight`: a *negative* scale, drawing
everything mirrored and shrunk to a speck. Nothing threw and nothing warned.

That is why the geometry now lives in `roadmap-layout.ts` rather than inside the
component. `fitView` returns `null` for a canvas too small to have been laid out
instead of answering with a number that renders nothing, and it is tested across
every plausible window size, including ones too small to fit the tree at all.

Scrolling zooms, and dragging moves. A trackpad pinch arrives as a wheel event
with `ctrlKey` set, which is the only way a browser reports one, so both gestures
zoom but at their own sensitivity: a shared constant makes a pinch move in leaps
or a wheel barely move at all.

Beyond those, the part worth reading is the zoom. Scaling towards the origin
makes the map slide away as it grows, which feels like the zoom is fighting
you. Scaling towards the pointer keeps whatever is under the cursor under the
cursor, and the correction is three lines:

```js
const ratio = scale / v.scale;
x: pointer.x - (pointer.x - v.x) * ratio,
y: pointer.y - (pointer.y - v.y) * ratio,
```

Edges leave the bottom of one box and arrive at the top of another rather than
running centre to centre, which would draw the line through the boxes
themselves. Control points sit directly above and below those ends, so every
arrow reads as travelling downward even when two topics are far apart sideways.

---

# Part 3 — URLs, and what a URL promises

The app navigated with a `useState` switch until this phase. That was fine at
three screens and stopped being fine at six, and the symptom was one people
notice immediately: the whole site lived at a single address, so the browser
held one history entry for it and **Back left the site entirely**. Refreshing
lost your place, reloading mid-session dropped you out of the room, and no
lesson could be linked to.

React Router rather than about sixty lines on the History API, and the
comparison with the pan and zoom on this same page is the reason. That was
arithmetic with no edge cases and nothing else depending on it, so hand-writing
it cost a dependency and bought full control. A router is not a leaf: it touches
every screen, and its failure modes are the tedious kind to find, such as double
history entries, state drifting out of step with the URL, and Back landing on a
screen whose data was never fetched.

The routes:

| Path | Screen |
|---|---|
| `/` | the roadmap |
| `/topic/:topic` | the roadmap with a topic panel open |
| `/step/:id` | a lesson and its questions |
| `/match`, `/match?topic=os&difficulty=easy` | find a partner, optionally preset |
| `/session/:id` | the shared editor |
| `/signin` | the sign-in form |

Two of those are worth explaining.

**An open topic panel has its own URL.** The panel sits over the map and is part
of the same screen, so it could have been component state. Giving it an address
means Back closes the panel instead of leaving the site, which is the behaviour
anyone on a phone will reach for.

**A session rebuilds itself from its id.** `SessionRoute` asks the server which
session the caller is in and checks it against the path, rather than trusting
either the id or a session object handed to it by whatever navigated there. That
is what makes a refresh rejoin the same document, and it makes a stale link to
an ended session land on the roadmap instead of on a broken page.

The general rule the routes are held to: **a URL is a promise that the page can
be rebuilt from it.** The summary screen cannot keep that promise, so it does
not get one.

One deployment consequence for phase 6: a static host must rewrite unknown paths
to `index.html`, or `/step/<id>` returns a 404 from the CDN before the app ever
loads. Vite's dev server and `vite preview` both do this already.

---

# Part 4 — Themes as tokens

Every colour is a custom property defined once on `:root` and redefined once
under `[data-theme='dark']`. No component names a colour, so a theme is a list
of variables rather than a second copy of the stylesheet, and there is no rule
that can be updated for one theme and forgotten for the other.

An explicit choice is stored and wins. With no choice made the system setting
is followed and *keeps* being followed, which is what makes the app go dark at
sunset along with everything else on the machine. `localStorage` is wrapped in
a try/catch because private browsing can refuse it outright, and losing the
preference between visits is a smaller problem than the page failing to render.

---

# Part 5 — What this phase deliberately did not build

- **No progress tracking.** There is no completed state and nothing to store it
  in. It needs a table, a route, and an opinion about what finishing means.
- **No summary URL.** Every other screen can be rebuilt from its address; the
  summary is assembled from what the session page happened to know when End was
  pressed, and no endpoint returns it. It travels in history state instead, and
  a refresh on `/summary` goes to the roadmap. Giving it a real URL means
  building a summary endpoint, which is the same work as the session history
  question below.
- **No search.** Nine topics fit on one screen.
- **No history of your own past sessions.** The data exists in
  `matching.sessions` and `collab.snapshots`, but nothing reads it back, and a
  page for it needs an endpoint on each of two services because neither role
  may read the other's schema.

---

# Part 6 — Demonstrating the claims

## Claim 1 — no answer text sits in a lesson

```bash
pnpm --filter @deepcs/questions test -t "keeps the answers out of the lessons"
```

Then break it deliberately: anchor the `DRILLS` pattern used to build
`009_roadmap.sql` at the start of a heading, re-seed, and the same test names
the topics that leak.

## Claim 2 — the map flows downward and every arrow lands somewhere

```bash
pnpm --filter @deepcs/questions test -t "points every arrow downward"
pnpm --filter @deepcs/questions test -t "gives every topic three steps"
```

## Claim 3 — the content is fixed in the database, not in the browser

```bash
pnpm --filter @deepcs/questions test -t "holds no em dashes"

docker compose exec postgres psql -U deepcs -d deepcs -At \
  -c "SELECT left(reference_md, 25) FROM questions.bank WHERE title = 'Processes & Threads';"
# ### 1. Process vs thread?
```

The numbering is in the stored text. Nothing in `frontend/` rewrites it, and
`grep -r numberReference frontend/` finds nothing, because the module that did
was deleted rather than left unused.

## Claim 4 — the two routes are shaped as documented

```bash
curl -s http://localhost:8080/roadmap | head -c 90
# {"topics":[{"topic":"os","title":"Operating Systems", …

curl -s "http://localhost:8080/steps/$STEP_ID" | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print(d["topicTitle"], "step", d["step"], "|", len(d["parts"]), "questions |", len(d["lessonMd"]), "bytes |", "referenceMd" in d)'
# Operating Systems step 1 | 6 questions | 10416 bytes | False

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/steps/not-a-uuid
# 400
```

The `False` is the point: a step is public and carries no answer. The answer
has its own route, which checks who is asking.
