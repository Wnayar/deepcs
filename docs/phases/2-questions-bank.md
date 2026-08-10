# Phase 2 — The question bank

**What this phase proves** (DESIGN.md §10):

- the bank can be browsed and read solo — list, filter, search, cursor-paginate, get by id
- repeat reads hit the cache — visible on the wire, not just faster
- `reference_md` never reaches a browser, even though it's sitting right there in the same row

Every heading below links to the code it describes. Open the file alongside this
page — the comments in the source explain *what*, this document explains *why*
and how the pieces connect.

---

# The three things — read this page, then stop if you're short on time

Phase 2 is ~180 lines of actual code plus a seed migration. Three ideas carry
the whole thing.

## 1. `reference_md` is absent by construction, not by filtering · ~5 min

📄 [`repository.ts:32`](../../services/questions/src/repository.ts#L32)

**The failure:** a question's answer key sits in the same table row as its
public fields. Some future endpoint does `SELECT *` for a quick feature, ships
it, and every visitor can read the answer to a question meant to be worked
through with a partner first.

**The mechanism:** `repository.ts` defines its own column list —
`id, title, difficulty, parts, tags, created_at` — and every query on the
public read path uses it. `reference_md` is never in that list, so there is no
row shape a route handler could accidentally forward it from. Tested at
[`repository.test.ts:41`](../../services/questions/src/repository.test.ts#L41).

**Say it as:** *"The safe way to keep a column off the wire isn't to remember
to strip it in the handler — it's to never select it in the first place."*

## 2. Cursor over offset · ~5 min

📄 [`repository.ts:47`](../../services/questions/src/repository.ts#L47)

**The failure:** `OFFSET 40 LIMIT 20` on a bank someone is actively paging
through. Postgres reads and discards the first 40 rows every time — wasted
work that grows with the offset — and if a row is inserted or deleted while a
client is mid-pagination, the next page silently skips or repeats a row.

**The mechanism:** `WHERE id > $last ORDER BY id LIMIT n`. Postgres jumps
straight to `$last` via the primary-key index; nothing is read and thrown
away. And because the cursor is a value, not a position, rows shifting around
elsewhere in the table can't shift what "the next 20" means.

**Say it as:** *"Offset pagination counts positions; cursor pagination
remembers a place. Only one of those survives the data changing underneath
it."*

## 3. The cache is a pure optimisation, unlike phase 1's Lua script · ~5 min

📄 [`cache.ts`](../../services/questions/src/cache.ts)

**The contrast worth having ready:** phase 1's rate limiter needed a Lua
script because *correctness* depended on atomicity — two Gateway instances
racing the same bucket is a real bug (lost update). This cache needs nothing
like that. The bank is read-heavy and essentially never written, so a stale
or missing cache entry just means one extra trip to Postgres, not a wrong
answer.

**The mechanism:** `cached()` tries Redis, computes from Postgres on a miss
*or on any Redis error*, and best-effort writes the result back. A Redis
outage degrades this endpoint to "no cache," not "broken."

**Say it as:** *"Not every Redis use needs the rate limiter's rigor. Ask what
happens on a miss — here, one extra query; there, an unenforced limit — and
match the mechanism to the actual cost of being wrong."*

---

# Read the code in this order

| # | File | What it is |
|---|---|---|
| 1 | [`packages/db/migrations/004_questions_bank.sql`](../../packages/db/migrations/004_questions_bank.sql) | The table. Start here — the row shape explains everything downstream. |
| 2 | [`services/questions/src/repository.ts`](../../services/questions/src/repository.ts) | List/filter/search/paginate/get, and the column list that keeps `reference_md` off the wire. |
| 3 | [`services/questions/src/cache.ts`](../../services/questions/src/cache.ts) | The read-through cache — ~25 lines, and the whole point is what happens when it fails. |
| 4 | [`services/questions/src/index.ts`](../../services/questions/src/index.ts) | Routes: `GET /questions`, `GET /questions/:id`. |
| 5 | [`packages/db/migrations/005_questions_seed.sql`](../../packages/db/migrations/005_questions_seed.sql) | The 27 seeded questions. Data, not logic — see Part 3 below for where it came from. |

---

# Part 1 — The bank's shape

📄 [`packages/db/migrations/004_questions_bank.sql`](../../packages/db/migrations/004_questions_bank.sql)

```sql
CREATE TABLE IF NOT EXISTS questions.bank (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  difficulty    text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  parts         jsonb NOT NULL,
  reference_md  text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_tags_idx ON questions.bank USING GIN (tags);
```

**No `topic` column.** DESIGN.md's row shape is `parts[]`, `reference_md`,
`tags text[]` (GIN-indexed), `difficulty` — filtering is entirely through
`tags`. A question's topic is just its first, most general tag — `os`,
`networking`, `databases`, `oop`, `system-design`, `security`, `debugging`,
`ai-tooling`, `behavioural`. One mechanism instead of two overlapping ones.

**`parts` is `jsonb`, not `text[]`.** Each entry is a short prompt string —
`"What is a mutex and how does it work?"` — and phase 4's Collab doc seeds one
heading per entry, in array order. `jsonb` round-trips as a plain JS array
through `pg`'s driver with no extra parsing in `repository.ts`.

**Same schema-and-role boundary as phase 1** (ADR-09) — `questions.bank` lives
in the `questions` schema, and the Questions service connects as `questions_svc`,
which was already granted `USAGE` on that schema by
[`002_service_roles.sql`](../../packages/db/migrations/002_service_roles.sql)
back in phase 1's role array. No new grant needed; only a new table.

---

# Part 2 — Reading the bank without leaking the answer

📄 [`services/questions/src/repository.ts`](../../services/questions/src/repository.ts)

## The column list is the whole guarantee

→ [`repository.ts:32`](../../services/questions/src/repository.ts#L32)

```ts
const SUMMARY_COLUMNS = 'id, title, difficulty, parts, tags, created_at';
```

Every query on the public read path — `listQuestions` and `getQuestion` —
selects exactly this list. `reference_md` isn't filtered out after the fact;
it's never fetched from Postgres in the first place. DESIGN.md is explicit
about why: the reference answer is released only to Matching, over the
internal network, once Matching has verified both participants consented to
reveal it (ADR-06) — and that consent flow still doesn't exist: phase 3
owns the state and deferred it, and phase 4 shipped without needing it, so it
arrives with the reveal UI in phase 5.
Questions has no way to know who consented, so for now the only safe answer is
*never*.

## Filter, search, paginate — one query

→ [`repository.ts:47-90`](../../services/questions/src/repository.ts#L47)

```sql
SELECT id, title, difficulty, parts, tags, created_at
FROM questions.bank
WHERE tags && $1::text[] AND difficulty = $2 AND title ILIKE $3 AND id > $4
ORDER BY id
LIMIT $5
```

Each filter is optional and only appears in `WHERE` if the caller supplied it
— `tags` uses array overlap (`&&`, matches on *any* shared tag), `difficulty`
is exact, search is a plain `ILIKE` on title. `LIMIT` asks for one row more
than requested; if that extra row shows up, its id becomes `nextCursor` and
it's trimmed from the page. No separate `COUNT` query, no "is there a next
page" flag to keep in sync by hand.

**Why `ILIKE` and not a full-text index.** DESIGN.md doesn't specify the
search mechanism, and the bank is 27 rows. A `tsvector` GIN index is the
right answer at scale; at this scale it's solving a problem this dataset
doesn't have. Worth revisiting if question authoring ever ships and the bank
grows past a few hundred rows.

---

# Part 3 — Where the seed content came from

📄 [`packages/db/migrations/005_questions_seed.sql`](../../packages/db/migrations/005_questions_seed.sql)

Question authoring is out of scope for this project (DESIGN.md) — there's no
endpoint that writes a row into `questions.bank`, ever. So the bank has to be
seeded once, by hand, the same way the schema itself is: a numbered migration
file, applied forward, never edited in place after it's run anywhere.

The content is adapted from a personal CS-fundamentals study repo, which comes
in two shapes. Five topics (OS, Networking, Databases, OOP, System Design) are
three-day curricula — 15 day-files, one bank row each. Four more (Security,
Debugging, AI Tooling, Behavioural) are single overview files, split into three
rows apiece along seams the notes already have.

Both shapes end the same way: a section pairing question headers with
full-paragraph answers — "Interview Questions Answered" in the day files,
"High-Value Interview Questions to Drill" in the overviews. That maps directly
onto this bank's shape: **the questions become `parts[]`, the answers become
`reference_md`.** 27 rows across 9 topics.

This is why every seeded question is multi-part rather than a single Q&A
pair: DESIGN.md's domain is "a bank of multi-part CS fundamentals
questions," and phase 4's Collab doc is seeded from `parts[]` — a
single-question row would give Collab nothing to scaffold.

**`difficulty` is the day's position within its own topic, not an absolute
rating** — day 1 easy, day 2 medium, day 3 hard. The notes are a curriculum
where day 3 assumes days 1 and 2, so that is what the source actually encodes,
and it reads correctly to someone working through a single topic. It does mean
the labels are not comparable *across* topics: databases' "hard" (NoSQL and
CAP) is not claimed to be harder than its own "medium" (transactions and MVCC)
in any absolute sense, only later in the sequence.

The reason it matters is downstream. Matching pairs people by topic **and**
difficulty and refuses the match when nothing fits, so a combination with no
question behind it is a pair of users who can never be matched — a dead end
they meet only after choosing. Nine topics × three lands exactly on the grid,
one question per cell:

| | easy | medium | hard |
|---|---|---|---|
| ai-tooling | LLMs, prompts & context | agents, RAG & fine-tuning | hallucination & responsible AI |
| behavioural | STAR & what each company tests | the competencies | delivering an answer |
| databases | SQL foundations | transactions & MVCC | NoSQL & CAP |
| debugging | a systematic method | common bug types | debugging in production |
| networking | the stack & TCP/IP | HTTP | DNS, LB & API design |
| oop | the 4 pillars | SOLID & patterns | behavioural patterns |
| os | processes & threads | synchronization | memory & I/O |
| security | authN, authZ & passwords | sessions, tokens & HTTPS | attacks & safe defaults |
| system-design | foundations | classic HLD | LLD & trade-offs |

An earlier ad-hoc assignment of difficulties left five cells empty. It is
asserted now rather than assumed, in
[`clients.test.ts`](../../services/matching/src/clients.test.ts) — the test
walks all twenty-seven combinations, because the failure is invisible until a
user picks the one that isn't there.

**Behavioural is shaped differently, on purpose.** The other eight topics have
a reference answer because the source notes have one. Behavioural is a *story
scaffold*: the answers are the author's own experiences and the slots are
deliberately blank, so there is nothing to import and inventing one would be
exactly what those notes warn against. Its `parts[]` are therefore real
questions to expect ("tell me about a time you failed") and its `reference_md`
describes what a strong answer has to contain rather than supplying one. That
still works for the product — two people take turns answering, and the
reference is the rubric they check each other against — but it is a different
contract from the rest of the bank, and the migration says so where the rows
are defined.

---

# Part 4 — The cache

📄 [`services/questions/src/cache.ts`](../../services/questions/src/cache.ts)

```ts
export async function cached<T>(redis, key, ttlSeconds, compute): Promise<CacheResult<T>> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return { value: JSON.parse(hit) as T, hit: true };
  } catch { /* fall through to Postgres */ }

  const value = await compute();
  try { await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch { /* best-effort */ }
  return { value, hit: false };
}
```

Wired into `GET /questions` only — `GET /questions/:id` is a single indexed
primary-key lookup, cheap enough that DESIGN.md doesn't ask for it to be
cached, and adding it would be scope the phase doesn't need.

**The cache key is the filter set.** `` `questions:list:${JSON.stringify(filters)}` `` —
two requests with the same tags/difficulty/search/cursor/limit hit the same
key. TTL is 60s: short enough that a future write path (there isn't one yet)
can't go stale for long by accident, long enough that repeat demo traffic
visibly hits it.

**The hit is surfaced, not just felt.** `index.ts` sets `X-Cache: HIT` or
`X-Cache: MISS` on every `GET /questions` response. DESIGN.md's phase 2
demoable claim is literally "cache hits visible" — a header is the only way
that's actually true for someone running the demo, as opposed to just being
faster.

---

# Part 5 — What this phase deliberately did not build

Stated so a green demo doesn't imply more than it covers — same reasoning as
phase 1's Part 7.

- **No browser UI.** DESIGN.md's phase 2 row says "public bank UI," but phase
  5 is where the actual React app (including the question list) gets built,
  and there's no frontend package anywhere in this repo yet. Building one now
  would mean standing up bundler/dev-server infrastructure that phase 5
  replaces days later. This phase proves the read path the same way phase 1
  proved auth — `curl`, in Part 6 below.
- **No Questions-specific rate limiting.** The Gateway's per-user/per-IP token
  bucket (phase 1) already covers every route, including these — phase 1's
  demo noted Questions had "no routes until phase 2," and now it does. No new
  limiter needed.
- **No `reference_md` release path.** The column exists and is seeded, but
  nothing serves it, internally or otherwise — that's Matching's consent
  check in phase 3 (ADR-06).
- **No write path.** Question authoring is out of scope for the whole
  project; the bank is migration-seeded, full stop.
- **No full-text search index.** See Part 2 — `ILIKE` is the honest answer at
  27 rows.

---

# Part 6 — Demonstrating the three claims

```bash
docker compose up -d --build
```

`migrate` picks up `004_questions_bank.sql` and `005_questions_seed.sql`
alongside phase 1's migrations, same as always — nothing new to run by hand.

## Claim 1 — browse, filter, search, paginate, get by id

```bash
curl -s http://localhost:8080/questions | jq '.items | length'          # 20 — the default limit, of 27
curl -s "http://localhost:8080/questions?tags=os" | jq '.items[].title'  # the 3 OS days
curl -s "http://localhost:8080/questions?difficulty=hard" | jq '.items[].title'
curl -s "http://localhost:8080/questions?q=memory" | jq '.items[].title' # title search
curl -s "http://localhost:8080/questions?limit=5" | jq '.nextCursor'     # a uuid, not null
```

No `Authorization` header on any of these — the bank is public (phase 1's
Part 2, the three-case table). `GET /questions/<id>` from any id above
returns one question; a random uuid returns `404`.

## Claim 2 — cache hits are visible

```bash
curl -si "http://localhost:8080/questions?tags=os" | grep -i x-cache   # MISS (first time)
curl -si "http://localhost:8080/questions?tags=os" | grep -i x-cache   # HIT (within 60s)
```

## Claim 3 — `reference_md` never appears

```bash
curl -s http://localhost:8080/questions | jq '.items[0]' | grep -i reference   # nothing
curl -s "http://localhost:8080/questions?limit=1" | jq -r '.items[0].id' | \
  xargs -I{} curl -s http://localhost:8080/questions/{} | grep -i reference    # nothing
```

## Running the tests yourself

```bash
export DATABASE_URL=postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs
export QUESTIONS_DATABASE_URL=postgresql://questions_svc:questions_svc@127.0.0.1:5432/deepcs
pnpm --filter @deepcs/questions test
```

Same real-Postgres convention as phase 1 (§8) — cursor pagination not
skipping or duplicating rows, and `questions_svc` being refused another
schema, are database semantics a mock would only prove agrees with itself.
