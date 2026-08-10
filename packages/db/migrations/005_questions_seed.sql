-- Seed content for questions.bank.
--
-- Question authoring is out of scope for the whole project (DESIGN.md), so the
-- bank is seeded once here rather than written through an API. Content is
-- adapted from a personal CS-fundamentals study repo: each entry below is one
-- day's worth of notes, and each day's notes already close with an
-- "Interview Questions Answered" section — that section's questions become
-- `parts`, and its answers (plus the day's "Quick Mental Models" where one
-- exists) become `reference_md`.
--
-- `difficulty` is the day's position inside its own topic, not an absolute
-- rating: day 1 is easy, day 2 medium, day 3 hard. The notes are a curriculum
-- — day 3 assumes days 1 and 2 — so this is what the source material actually
-- encodes, and it reads correctly to someone working through one topic.
--
-- It also has a property the product depends on. Matching pairs people by
-- topic *and* difficulty, and refuses the match when no question fits. Five
-- topics × three days lands exactly on the five-by-three grid, one question
-- per cell, so every combination a user can pick has something behind it. The
-- earlier ad-hoc ratings left five of those fifteen cells empty, and each
-- empty cell was a pair of users who could never be matched.

-- Re-runnable, which the other migrations get from `IF NOT EXISTS` and this
-- one cannot: an INSERT has nothing to be idempotent about on its own. Without
-- a key to conflict on, re-running against a database whose bookkeeping table
-- was wiped (or restored from a dump taken without it) silently doubles every
-- question. Titles are unique within a seeded bank of fifteen, so they are the
-- key; `DO UPDATE` additionally means editing the content above and re-running
-- refreshes the row rather than being ignored.
CREATE UNIQUE INDEX IF NOT EXISTS bank_title_key ON questions.bank (title);

INSERT INTO questions.bank (title, difficulty, parts, reference_md, tags) VALUES

-- ── OS — Day 1 ────────────────────────────────────────────────────────────
(
  'Processes & Threads',
  'easy',
  $parts$["Process vs thread?", "What happens on fork()?", "Why are threads cheaper than processes?", "What is a zombie process?", "What is a race condition? Example?", "What is a context switch and why is it expensive?"]$parts$,
  $md$## Process vs thread?

A process is an isolated running program with its own address space, page tables, file descriptors, and PCB (process control block). A thread runs inside a process with its own stack and registers but shares everything else. Threads share memory (cheap communication, needs synchronization); processes are isolated (safe, but need IPC). Thread creation is cheap; process creation is expensive. Same-process thread switches skip the TLB flush.

## What happens on fork()?

The OS makes a child that's a near-exact copy of the parent. Both continue after `fork()` — it returns twice; the parent gets the child's PID, the child gets 0. The child's address space is copy-on-write — pages are shared read-only until one side writes, then just that page is copied.

## Why are threads cheaper than processes?

Shared address space: no new page tables, no heap copy, no TLB flush on switch. Creation is just a stack + Thread Control Block, and communication is a memory read/write instead of a pipe or socket.

## What is a zombie process?

A process that exited but whose parent hasn't called `wait()`. It uses no CPU/memory, but its PCB entry stays so the parent can read the exit status; `wait()` removes it. An orphan (parent exits first) is re-parented to PID 1, which reaps it.

## What is a race condition? Example?

When correctness depends on thread timing. Two threads doing `counter++` (load/add/store): a switch between one thread's load and store loses the other's update. Non-deterministic, so it's hard to reproduce and debug.

## What is a context switch and why is it expensive?

The OS stops one process/thread and starts another, saving the current registers to its PCB and restoring the next's. Costs: register save/restore, cache thrash (the new process starts cold), and — for process switches — a TLB flush causing page-table walks until mappings re-cache.

## Mental models

- **Process = house; thread = person in it.** Own bedroom (stack), shared kitchen (heap, globals). People can trip over each other.
- **fork() = photocopier; exec() = body snatcher.** Fork duplicates the process; exec keeps the same body (PID) but swaps the personality (code).
- **Trap = a supervised phone call to the kernel.** You dial an extension (syscall number); the kernel does the work and hangs up. You can't dial its private lines.
- **Race condition = two chefs, one recipe, no coordination.** Both read, both add salt, both pour — double salt.
$md$,
  ARRAY['os', 'processes', 'threads', 'fork', 'context-switch']
),

-- ── OS — Day 2 ────────────────────────────────────────────────────────────
(
  'Synchronization & Concurrency',
  'medium',
  $parts$["What is a mutex and how does it work?", "What is a deadlock? The four conditions?", "Mutex vs. semaphore?", "What is a condition variable? When?", "What is a race condition? Example?", "How do you prevent deadlock?", "Implement producer-consumer from memory"]$parts$,
  $md$## What is a mutex and how does it work?

A primitive giving mutual exclusion — one holder at a time. Built on atomics (test-and-set / CAS): if free, atomically mark it held and proceed; if held, the thread sleeps (off the run queue). `unlock()` wakes one waiter. Sleeping (vs spinning) avoids wasting CPU.

## What is a deadlock? The four conditions?

Threads permanently blocked waiting on each other. Needs all four Coffman conditions: mutual exclusion, hold-and-wait, no preemption, circular wait. Most practical fix: lock ordering (breaks circular wait).

## Mutex vs. semaphore?

A mutex has ownership (the locker unlocks) and is binary. A semaphore is an ownerless counter; any thread can post. A semaphore init to 1 mimics a mutex, but it can also count (init N for N concurrent) or signal (init 0 to make one thread wait for another). Prefer a mutex for plain mutual exclusion — ownership prevents another thread from accidentally unlocking it.

## What is a condition variable? When?

Lets a thread sleep until a condition holds, always paired with a mutex. Hold the mutex, check the condition in a `while`, and if false call `cond_wait` (atomically releases the mutex and sleeps). Another thread updates state, takes the mutex, and `signal`s (or `broadcast`s). Classic use: producer-consumer.

## What is a race condition? Example?

Correctness depends on thread timing. Two threads do `balance += amount` (load/add/store). If T1 loads $100, is preempted, T2 loads $100 → adds $50 → stores $150, then T1 resumes with its stale $100 → adds $30 → stores $130, T2's update is lost (should be $180). Fix: a mutex around the critical section.

## How do you prevent deadlock?

Mainly **lock ordering**: a total order over locks, always acquired in that order — breaks circular wait. When you don't control order, order by address. Others: trylock + backoff (no-preemption), acquire all locks atomically (hold-and-wait), lock-free structures (mutual exclusion).

## Implement producer-consumer from memory

One mutex, two condition variables ("has space" / "has items"), a circular buffer plus a `count`:

```c
pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t  empty = PTHREAD_COND_INITIALIZER; // "has space"
pthread_cond_t  fill  = PTHREAD_COND_INITIALIZER; // "has items"
int buffer[MAX], fill_ptr = 0, use_ptr = 0, count = 0;

void producer(int item) {
    pthread_mutex_lock(&mutex);
    while (count == MAX) pthread_cond_wait(&empty, &mutex);
    buffer[fill_ptr] = item; fill_ptr = (fill_ptr+1)%MAX; count++;
    pthread_cond_signal(&fill);
    pthread_mutex_unlock(&mutex);
}
void consumer() {
    pthread_mutex_lock(&mutex);
    while (count == 0) pthread_cond_wait(&fill, &mutex);
    int item = buffer[use_ptr]; use_ptr = (use_ptr+1)%MAX; count--;
    pthread_cond_signal(&empty);
    pthread_mutex_unlock(&mutex);
}
```

While coding, say out loud: mutex for exclusion, two CVs to avoid waking the wrong thread type, `while` not `if` (spurious wakeups + stale conditions), signal after updating state. With one CV, a waking consumer might wake another consumer instead of a producer — it finds the buffer empty and sleeps again, and the producer is never woken.

## Mental models

- **Lock = a bathroom key.** One person at a time; if it's taken, you wait outside.
- **Condition variable = an elevator call button.** Press it (wait), sleep, get woken when the elevator (your condition) arrives — all while holding the lobby key (mutex) so it can't arrive and leave before you press.
- **Semaphore = a bouncer with N wristbands.** Take one (wait), return it (post); if all N are out, wait. Init 1 = exclusive; init 0 = wait for a post; init N = N allowed in.
- **Deadlock = two people in a hallway, each waiting for the other to step aside** (dining philosophers: all grab the left fork, all wait for the right). Fix: a shared rule for who yields — lock ordering.
$md$,
  ARRAY['os', 'concurrency', 'locks', 'deadlock', 'semaphores']
),

-- ── OS — Day 3 ────────────────────────────────────────────────────────────
(
  'Memory & I/O',
  'hard',
  $parts$["What is virtual memory and why?", "What is a page fault?", "Stack vs heap?", "What is memory fragmentation?", "Blocking vs non-blocking I/O?", "How does Node handle 10k connections on one thread?", "Thread pool vs thread per request?", "What is a context switch and why expensive?"]$parts$,
  $md$## What is virtual memory and why?

The OS abstraction giving each process its own private, contiguous address space, mapped to physical RAM via page tables. Reasons: isolation (no cross-process corruption), transparency (processes ignore physical layout), efficiency (sharing, overcommit, swapping to disk).

## What is a page fault?

A hardware exception when a process accesses a page whose PTE present bit = 0 (not in RAM). The OS handler finds the page on disk, loads it into a free frame, updates the page table, and resumes. If the page was never mapped, the OS kills the process with a segfault.

## Stack vs heap?

Stack: locals, params, return addresses; auto push/pop per call; fast but ~8MB. Heap: dynamic memory (`malloc`/`new`), manual in C/C++ or GC'd elsewhere; large but slower and fragmentable. Locals go on the stack; `new`/`malloc` objects on the heap.

## What is memory fragmentation?

External: free memory split into non-contiguous pieces so a large request fails despite enough total free; caused by variable-sized alloc/free over time; paging eliminates it. Internal: wasted space inside a block (asked 100B, got 128B → 28B wasted).

## Blocking vs non-blocking I/O?

Blocking: the thread sleeps until the op completes — simple but one thread per concurrent op, doesn't scale. Non-blocking: returns immediately (data or `EAGAIN`); paired with `epoll`, one thread monitors thousands of sockets and handles whichever are ready — the basis of the event loop.

## How does Node handle 10k connections on one thread?

An **event loop** via `libuv` (Node's C I/O library) over `epoll`/`kqueue`. A request registers a callback and returns; when its I/O completes, the OS fires an epoll event and Node runs the callback. The thread never blocks — always running a callback or in `epoll_wait`. Works because the workload is I/O-bound: the OS does the waiting.

## Thread pool vs thread per request?

Thread per request is simple but doesn't scale — ~1–8MB stack each and linear switch overhead. A fixed pool (e.g., 4× cores) caps memory and switch cost, good for bounded work — but if all threads block on slow I/O the pool starves. For I/O-heavy services prefer an event loop; common hybrid: small pool for CPU work + async I/O for network.

## What is a context switch and why expensive?

The OS stops one process/thread and starts another, saving/restoring registers via the PCB; on process switches it also swaps the page-table base and flushes the TLB. Costs: register save/restore (cheap), TLB flush (page-table walks until warm), cache invalidation (cold caches), scheduler overhead. ~1–10 µs direct, plus an indirect tail from cold TLB/caches that often dominates.

## Mental models

- **Virtual memory = postal addressing.** You write "123 Main St" (virtual); the post office (OS+hardware) translates it to GPS coordinates (physical). Two cities can share the same street name with no conflict.
- **Page table = a book's index; TLB = a sticky note of recent lookups.** "Chapter 5 → page 78" maps VPN → frame. A TLB miss is a cache miss for translation — walk the index in RAM.
- **Page fault = the page is in the filing cabinet (disk), not on your desk.** You must fetch it before reading — slow.
- **Event loop = one efficient waiter.** Takes an order (registers a callback), tells the kitchen (kernel), takes more orders; when the bell rings (`epoll_wait` returns), delivers the ready dishes. Never just stands waiting.
$md$,
  ARRAY['os', 'memory', 'virtual-memory', 'io', 'event-loop']
),

-- ── Networking — Day 1 ───────────────────────────────────────────────────
(
  'The Network Stack & TCP/IP',
  'easy',
  $parts$["What happens when a client connects to a server at the network level?", "TCP vs UDP — when would you use UDP?", "What is the TCP three-way handshake?", "What is head-of-line blocking?", "What happens during a TLS handshake?"]$parts$,
  $md$## What happens when a client connects to a server at the network level?

DNS resolves the hostname to an IP. The client OS picks an ephemeral port and sends a TCP SYN to the server's IP:port; the server replies SYN-ACK; the client sends ACK — handshake done, both sides have a socket. The client sends its request (e.g. HTTP) over the connection; data flows in ACKed segments. When done, one side sends FIN to tear down.

## TCP vs UDP — when would you use UDP?

UDP for video (drop a frame rather than retransmit), VoIP (stale audio is useless), DNS (tiny, easy to retry), and gaming (latest position matters). TCP for anything needing complete, correct delivery: HTTP/1.1 and 2, SSH, DB connections, file transfers.

## What is the TCP three-way handshake?

Client sends SYN with its ISN (initial sequence number); server replies SYN-ACK with its own ISN plus an ACK of the client's; client sends ACK. Now both sides agree on sequence numbers and can exchange data. Three steps are needed so each side proves it can both send and receive.

## What is head-of-line blocking?

In HTTP/1.1 a connection handles one request at a time, so a large in-flight response blocks smaller ready ones. Browsers work around it with ~6 parallel connections per domain. HTTP/2 multiplexes many streams over one TCP connection, but a lost TCP segment still stalls all streams (TCP-level HOL blocking). HTTP/3 (QUIC over UDP) makes each stream independent, removing that.

## What happens during a TLS handshake?

After the TCP handshake: client sends `ClientHello` (TLS version, cipher suites, random); server replies `ServerHello` (chosen cipher, random) plus its certificate. The client verifies the cert against a trusted CA. Both run a key exchange (e.g. ECDHE) to derive a shared session key without sending it, then confirm with encrypted `Finished` messages. All later data uses fast symmetric encryption; the key was exchanged via slow-but-secure asymmetric math.
$md$,
  ARRAY['networking', 'tcp', 'udp', 'handshake']
),

-- ── Networking — Day 2 ───────────────────────────────────────────────────
(
  'HTTP Deep Dive',
  'medium',
  $parts$["What's the difference between PUT and PATCH?", "How does HTTP caching work?", "What is CORS and why does it exist?", "When would you use WebSockets vs HTTP polling?", "What HTTP status codes should you know?"]$parts$,
  $md$## What's the difference between PUT and PATCH?

PUT replaces the whole resource — fields you omit get cleared. PATCH updates only the fields you send. PUT is idempotent; PATCH isn't guaranteed to be (e.g. an increment patch).

## How does HTTP caching work?

`Cache-Control: max-age=3600` lets the browser serve from cache for an hour without hitting the server. After expiry it revalidates with `If-None-Match` and the cached ETag: unchanged → `304` (no body), changed → new `200` with a new ETag. `no-store` forbids caching; `no-cache` allows caching but forces revalidation first.

## What is CORS and why does it exist?

CORS is a browser rule that stops JS from reading responses from a different origin (scheme+host+port) than the page, preventing malicious scripts from silently using a user's credentials. Servers send `Access-Control-Allow-Origin` to whitelist origins. Non-simple requests (PUT/DELETE, custom headers, JSON content type) trigger a preflight `OPTIONS` check first.

## When would you use WebSockets vs HTTP polling?

WebSockets for real-time bidirectional needs (chat, multiplayer, collaboration) where the server must push and latency must be low. Polling for infrequent updates where a few seconds' lag is fine, or where WS is blocked. SSE (server-sent events) for server-to-client-only push over HTTP with auto-reconnect.

## What HTTP status codes should you know?

200 OK, 201 Created, 204 No Content, 301 permanent / 302 temporary redirect, 400 Bad Request, 401 unauthenticated, 403 unauthorized, 404 Not Found, 409 Conflict, 429 rate limited, 500 server error, 503 unavailable. 401 vs 403 is the classic point: 401 = "tell me who you are"; 403 = "I know you, but you can't."
$md$,
  ARRAY['networking', 'http', 'caching', 'cors', 'websockets']
),

-- ── Networking — Day 3 ───────────────────────────────────────────────────
(
  'DNS, Load Balancing & API Design',
  'hard',
  $parts$["What happens when you type a URL and hit enter?", "Walk me through a DNS lookup", "What is TTL in DNS and why does it matter?", "L4 vs L7 load balancer — when each?", "REST vs gRPC — when pick gRPC?", "How do you version a REST API?", "What makes an API idempotent?", "How would you paginate a large API response?"]$parts$,
  $md$## What happens when you type a URL and hit enter?

1. **DNS:** browser cache → OS cache → recursive resolver → root → TLD → authoritative → IP (cached per TTL).
2. **TCP:** three-way handshake (SYN, SYN-ACK, ACK) with that IP on port 443.
3. **TLS:** hellos + certificate verified against a CA; key exchange derives the symmetric session key.
4. **HTTP:** browser sends `GET /`; the request typically hits a CDN edge or L7 load balancer, which routes it to an app server; the response returns status + headers (caching, cookies) + body.
5. **Render:** browser parses the HTML and fetches referenced assets over the same connection (HTTP/2 multiplexes them); JS executes.

## Walk me through a DNS lookup

Browser cache → OS cache (checks `/etc/hosts`) → recursive resolver (ISP/8.8.8.8). On a resolver miss: ask a root server for the TLD server, the TLD server for the authoritative server, then the authoritative server for the A record. The resolver caches it for the TTL and returns the IP; the browser opens a TCP connection.

## What is TTL in DNS and why does it matter?

TTL is how long resolvers cache a record. High TTL (86400s) cuts query volume but makes changes take up to 24h to propagate; low TTL (60s) flips that. Before a migration, lower TTL a day ahead so old records expire quickly.

## L4 vs L7 load balancer — when each?

L4 for very high throughput or raw TCP services (DBs, streaming) with no need for content-aware routing. L7 for HTTP routing by URL/host (route `/api/` vs `/static/`), SSL termination, cookie session affinity, HTTP health checks, and canary releases.

## REST vs gRPC — when pick gRPC?

Internal service-to-service calls where you own both ends and need max performance or streaming. Binary protobuf is smaller/faster than JSON and the strict schema prevents type mismatches. For public, browser-facing APIs, prefer REST (or GraphQL) since browsers can't call gRPC natively.

## How do you version a REST API?

URL versioning (`/v1/`, `/v2/`) is most common and explicit — easy to route, test, document. Header versioning is cleaner but less practical. Core rule: never break a live version. Removing a field, changing its type, or changing behaviour is breaking; adding optional fields is safe. When you must break, ship a new version and support both during a migration window.

## What makes an API idempotent?

Repeating it N times equals doing it once. GET (reads don't change state), PUT (re-replacing with the same data), and DELETE (deleting an already-deleted thing) are idempotent. POST isn't — each `POST /orders` creates a new order. For retry-safe POSTs (payments), use idempotency keys.

## How would you paginate a large API response?

Prefer cursor over offset. Offset duplicates or skips rows when data changes mid-pagination and gets slow at high offsets. Cursor uses a stable reference (last ID/timestamp) — `?after=ord_xyz&limit=20` — so it's fast and stable. Trade-off: no jumping to an arbitrary page.
$md$,
  ARRAY['networking', 'dns', 'load-balancing', 'api-design', 'rest']
),

-- ── Databases — Day 1 ────────────────────────────────────────────────────
(
  'SQL Foundations & Indexing',
  'easy',
  $parts$["Clustered vs non-clustered index?", "Why does column order matter in a composite index?", "When would a query NOT use an index?", "What is a covering index?", "WHERE vs HAVING?", "Second highest salary — window function vs subquery"]$parts$,
  $md$## Clustered vs non-clustered index?

Clustered sets the physical row order — one per table, usually the primary key. Non-clustered is a separate structure of values + pointers to rows, and you can have many. Clustered is faster for range scans (rows are sequential); non-clustered needs an extra hop per row.

## Why does column order matter in a composite index?

A B-tree is sorted left-to-right, so an index on `(A,B,C)` answers filters on `A`, `A+B`, or `A+B+C` — but not `B` or `C` alone. Put equality columns before range columns, high-selectivity columns first.

## When would a query NOT use an index?

A function wrapping the column (`WHERE UPPER(email) = ...`), low selectivity (`WHERE is_active = true` when 95% match), skipping the leading composite column, a leading `%` in `LIKE`, or a tiny table where the planner prefers a scan. Confirm with `EXPLAIN`.

## What is a covering index?

One that holds every column the query needs, so the engine reads only the index — the fastest read path. Build it from the SELECT + WHERE + JOIN columns. `EXPLAIN` shows this as an "Index Only Scan."

## WHERE vs HAVING?

WHERE filters rows before grouping; HAVING filters groups after aggregation.

## Second highest salary — window function vs subquery

```sql
SELECT salary FROM (
    SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk FROM employees
) t WHERE rnk = 2;

SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary) FROM employees);
```

Choose `DENSE_RANK` over `RANK`: if two people tie for highest, `RANK` skips rank 2 while `DENSE_RANK` doesn't, so the next distinct salary is correctly rank 2.
$md$,
  ARRAY['databases', 'sql', 'indexing']
),

-- ── Databases — Day 2 ────────────────────────────────────────────────────
(
  'Transactions, Concurrency & Internals',
  'medium',
  $parts$["What does ACID mean? Example of each.", "Dirty read vs phantom read?", "How does MVCC work?", "Optimistic vs pessimistic locking?", "How do you handle a deadlock?", "Postgres default isolation level?"]$parts$,
  $md$## What does ACID mean? Example of each.

**Atomicity:** a transfer debits and credits, or neither — enforced by the WAL (write-ahead log). **Consistency:** a `CHECK (balance >= 0)` constraint is never broken. **Isolation:** two people booking the last ticket — only one succeeds. **Durability:** a committed payment survives a crash because it's on the WAL, fsynced before commit is acknowledged.

## Dirty read vs phantom read?

Dirty read: reading another transaction's uncommitted write; if it rolls back you read data that never existed (prevented at Read Committed and above). Phantom read: a range query returns extra rows because another transaction inserted into that range and committed (prevented at Serializable).

## How does MVCC work?

Each row version carries a creating transaction ID (`xmin`) and a deleting one (`xmax`). A transaction's snapshot shows only versions whose `xmin` committed before it and whose `xmax` is empty or committed later. Readers get a consistent point-in-time view without locks; writers just append versions; nobody blocks. `VACUUM` removes dead versions.

## Optimistic vs pessimistic locking?

Pessimistic: lock on read (`SELECT ... FOR UPDATE`) until commit — good for high contention. Optimistic: no lock; carry a version, check it on update, retry if it changed — good for low contention where locking would waste time waiting.

## How do you handle a deadlock?

The DB detects the cycle automatically (Postgres after ~1s) and aborts one transaction (the victim) with an error; the app retries. Prevent it by acquiring locks in a consistent order, and add retry-with-backoff in app code.

## Postgres default isolation level?

Read Committed — each statement sees a fresh snapshot of committed data. It prevents dirty reads but allows non-repeatable and phantom reads. Escalate to Repeatable Read or Serializable when you need a stable view across statements.
$md$,
  ARRAY['databases', 'transactions', 'acid', 'mvcc', 'isolation-levels']
),

-- ── Databases — Day 3 ────────────────────────────────────────────────────
(
  'NoSQL, CAP Theorem & When to Use What',
  'hard',
  $parts$["MongoDB over Postgres?", "When Cassandra?", "Eventual consistency in practice?", "Redis vs a database?", "Hotspot in sharding, and prevention?", "CAP theorem, with examples?"]$parts$,
  $md$## MongoDB over Postgres?

When data is document-centric with varying fields (e.g. a product catalogue), when related data is naturally embedded and read together, or when rapid schema iteration matters. Not for complex multi-collection joins or strongly relational data; multi-document transactions exist but are costly, so heavy cross-document ACID points to SQL.

## When Cassandra?

Write-heavy at massive scale (IoT, activity streams, metrics), when you need linear horizontal scaling, when availability beats strong consistency (AP), and when access is always by a known partition key. Not for ad-hoc queries, aggregations, or joins.

## Eventual consistency in practice?

After a write, replicas sync asynchronously over ms–seconds; a read to another replica meanwhile returns the old value. Don't assume writes are instantly visible everywhere. Workarounds: route reads-after-writes to the same node, or read at `QUORUM` for critical data.

## Redis vs a database?

Redis keeps data in RAM — 100–1000× faster than disk but memory-bound and pricier per GB, with no complex queries. It targets caching, sessions, counters, and queues via native structures; persistence is optional and adds write cost. Use it as a cache in front of a durable store, not as the system of record.

## Hotspot in sharding, and prevention?

A hotspot is one shard taking disproportionate traffic, usually from a poor shard key (e.g. a few power users all mapping to one shard). Prevent it with a high-cardinality key (many distinct values, e.g. hash the ID) so writes spread evenly, consistent hashing so resharding remaps few keys, and a random suffix to split hot keys.

## CAP theorem, with examples?

Guarantee only two of Consistency, Availability, Partition tolerance; since partitions are inevitable, the choice is CP vs AP. CP: a payment DB returns an error during a partition rather than risk a double charge. AP: a social feed keeps serving (slightly stale) content because availability wins. DNS is AP — it serves cached records during a partition.
$md$,
  ARRAY['databases', 'nosql', 'cap-theorem', 'sharding']
),

-- ── OOP — Day 1 ───────────────────────────────────────────────────────────
(
  'The 4 Pillars & Class Relationships',
  'easy',
  $parts$["Explain encapsulation. Why is it important?", "Abstraction vs encapsulation?", "When choose composition over inheritance?", "Abstract class vs interface?", "What is runtime polymorphism and how does it work?"]$parts$,
  $md$## Explain encapsulation. Why is it important?

It bundles data with the methods that act on it and uses access modifiers to control access. This enforces invariants (rules that must always hold, like a balance never going negative), reduces coupling (callers depend on the interface, not internals), and lets you refactor internals without breaking callers.

## Abstraction vs encapsulation?

Abstraction is the design goal — expose only what's needed. Encapsulation is the mechanism — access modifiers that hide internal data. Abstraction is what you show; encapsulation is how you hide the rest.

## When choose composition over inheritance?

For "has-a" relationships, when you need runtime flexibility (you can swap a composed object but not inheritance), or to avoid the fragile base class problem — changing a parent, even harmlessly, can break subclasses because inheritance is tight coupling. Composition depends on an interface, so any implementation can be swapped in.

## Abstract class vs interface?

Abstract class: state, constructor, partial implementation; extend only one (avoids the diamond problem — if a class could extend two parents overriding the same method, which version wins?); use to share code among related classes. Interface: pure contract, no state; implement many; use for a capability unrelated classes share. Core: abstract class = shared identity and code; interface = contract.

## What is runtime polymorphism and how does it work?

A parent-type reference points to a child object and the overridden method is chosen at runtime via a **vtable** — a per-class array of method pointers. Calling `a.speak()` looks up the real type's vtable and calls its implementation. This is dynamic dispatch: binding happens at runtime, not compile time — so `void makeNoise(Animal a) { a.speak(); }` works for any subtype with no `instanceof` chains.
$md$,
  ARRAY['oop', 'pillars', 'polymorphism', 'inheritance']
),

-- ── OOP — Day 2 ───────────────────────────────────────────────────────────
(
  'SOLID Principles + Creational & Structural Patterns',
  'medium',
  $parts$["An SRP violation and its fix?", "What does Open/Closed mean in practice?", "Explain LSP with a concrete violation.", "How does DIP relate to dependency injection?", "Why is Singleton an antipattern?", "Decorator vs inheritance?"]$parts$,
  $md$## An SRP violation and its fix?

A `UserService` that does user CRUD, sends emails, and generates reports has three reasons to change. Split into `UserService`, `EmailService`, `ReportService`, each with one job. SRP applies to microservices too — a service handling both orders and payments violates it at the architecture level.

## What does Open/Closed mean in practice?

"Open for extension, closed for modification." Add a crypto payment by creating a `CryptoPayment` class implementing `PaymentStrategy`, not by editing `PaymentProcessor`. Tested code stays closed; new behaviour comes from new code — this is why we "program to an interface."

## Explain LSP with a concrete violation.

`Square extends Rectangle`: `setWidth(5)` also sets height, but Rectangle callers expect the two to be independent — `r.setWidth(5); r.setHeight(3); r.area()` expects 15, gets 9. Code written for Rectangle breaks when a Square is substituted — the hierarchy is wrong. Fix: drop the inheritance, give both a `Shape` interface with `area()`, or use composition.

## How does DIP relate to dependency injection?

DIP says high-level and low-level modules should both depend on abstractions, not concretions. DI is the mechanism: instead of `new`-ing a concrete dependency inside a class (`private MySQLDatabase db = new MySQLDatabase();`), you depend on an interface and pass the implementation in via the constructor. Prod injects the real thing; tests inject a mock.

## Why is Singleton an antipattern?

Global mutable state (any code can change it), hidden dependencies (callers just call `getInstance()` without declaring they need it), and broken testability (shared instance, can't inject a mock). Acceptable for truly shared infrastructure with no mutable business state — connection pools, loggers, immutable config loaded once at startup.

## Decorator vs inheritance?

Decorator composes behaviour at runtime by wrapping an object behind the same interface, avoiding class explosion (`EncryptedCompressedLoggedMessage`-style subclasses for every combination). Inheritance is fixed at compile time — use it only for a genuine, shallow "is-a" relationship. Examples: Java I/O (`new BufferedReader(new FileReader(...))`), HTTP middleware chains.
$md$,
  ARRAY['oop', 'solid', 'design-patterns', 'singleton']
),

-- ── OOP — Day 3 ───────────────────────────────────────────────────────────
(
  'Behavioural Patterns + Composition vs Inheritance',
  'hard',
  $parts$["Observer vs pub/sub — same thing?", "Strategy — a real backend example?", "When use Command?", "Where does Proxy appear in backends?", "Factory vs Factory Method vs Abstract Factory?", "Design a parking lot — classes, relationships, patterns?"]$parts$,
  $md$## Observer vs pub/sub — same thing?

No. Observer is direct, synchronous, in-process — observers hold a reference to the subject, which notifies them on change. Pub/Sub adds a broker (Kafka, RabbitMQ) in the middle: publisher and subscriber don't know each other, communication is async, and it can span processes/machines. Observer is a design pattern; pub/sub is a messaging architecture.

## Strategy — a real backend example?

Auth middleware: an `AuthStrategy` interface with `authenticate(request)`, implemented by `JWTStrategy`, `APIKeyStrategy`, `OAuth2Strategy`. The router picks one per endpoint — no conditionals in core logic, and a new method is just a new class. Strategy replaces `if/else` chains over algorithm variants with polymorphism.

## When use Command?

Undo/redo (each command implements `execute()` and `undo()`), job queues (serialise a Command, enqueue, a worker calls `execute()`), audit logging, and transactional sequences you may need to roll back. The Invoker holds/runs commands; the Receiver does the actual work.

## Where does Proxy appear in backends?

Caching in front of a DB/API call (avoid repeated expensive lookups), an API gateway validating JWTs before forwarding (auth check before delegating), ORM lazy loading of relationships (defer the query until the field is actually accessed — Hibernate/JPA does this), and circuit breakers that stop forwarding to a failing service. Proxy controls access to the real object behind the same interface; Decorator adds behaviour instead.

## Factory vs Factory Method vs Abstract Factory?

Simple Factory: a static helper that creates by parameter — not a Gang-of-Four pattern, just a helper. Factory Method: an abstract method subclasses override to create one product (`DogFactory.create() → new Dog()`). Abstract Factory: creates *families* of related products that must be used together (`MacFactory` makes `MacButton` + `MacTextBox`; `WindowsFactory` makes the Windows set).

## Design a parking lot — classes, relationships, patterns?

Classes: `ParkingLot`, `Floor`, `ParkingSpot` (compact/large/handicapped), `Vehicle` (abstract → `Car`, `Truck`, `Motorcycle`), `Ticket`, `Payment`. Relationships: `ParkingLot` composes `Floor`, `Floor` composes `ParkingSpot`; `Ticket` associates a `Spot` and a `Vehicle`. Patterns: Strategy for payment method, Observer to signal a full floor, Factory Method to create spot types, Singleton for the lot manager. Model spot status as a state machine: Available → Reserved → Occupied → Available.
$md$,
  ARRAY['oop', 'design-patterns', 'observer', 'strategy']
),

-- ── System Design — Day 1 ────────────────────────────────────────────────
(
  'Foundations & Building Blocks',
  'easy',
  $parts$["Scale a system from 1 user to 10M?", "Horizontal vs vertical scaling?", "How does consistent hashing work and why use it?", "How does a CDN work?", "SQL vs NoSQL?"]$parts$,
  $md$## Scale a system from 1 user to 10M?

Single server → split app/DB so each scales independently → load balancer + stateless app servers (sessions in Redis, not on the box) → Redis cache in front of the DB → read replicas → CDN for static assets → shard the DB when writes bottleneck. Measure and find the real bottleneck before each step rather than pre-optimising.

## Horizontal vs vertical scaling?

Vertical: more CPU/RAM on one box — simple, no code change, but a hard ceiling, single point of failure, and expensive. Horizontal: more machines — needs stateless design, scales ~indefinitely, survives a single node dying, more ops complexity. Preferred for production.

## How does consistent hashing work and why use it?

Servers and keys map onto a hash ring; each key goes to the next server clockwise. Adding or removing a server remaps only ~1/N keys (the ones between it and its ring neighbour), instead of nearly everything the way plain `hash % N` does on resize — which also causes a thundering herd against the cache/DB behind it. Used in Memcached client sharding, Cassandra/Dynamo-style stores, and CDN routing. Virtual nodes (many ring positions per physical server) even out the load further.

## How does a CDN work?

A globally distributed fleet of edge servers caching content close to users. DNS/anycast routes a user to the nearest edge. Cache hit → served immediately from the edge; miss → the edge fetches from the origin, caches it per `Cache-Control`, and serves later requests from cache. Cuts latency (short round trip to the edge), offloads the origin, and absorbs traffic spikes/DDoS at the edge instead of at your servers.

## SQL vs NoSQL?

SQL (Postgres, MySQL): ACID transactions, joins, stable schema, relational integrity — banking, payments, inventory. NoSQL: massive write throughput (Cassandra, time-series/IoT), flexible documents (MongoDB, varying schema), sub-millisecond cache (Redis), full-text search (Elasticsearch). Most real systems use both — SQL for transactional data, Redis for cache, maybe Elasticsearch for search — rather than picking one for everything.
$md$,
  ARRAY['system-design', 'scaling', 'caching', 'consistent-hashing']
),

-- ── System Design — Day 2 ────────────────────────────────────────────────
(
  'Classic HLD Problems',
  'medium',
  $parts$["Design a rate limiter?", "Fan-out on write vs read?", "Design a URL shortener?", "Design a key-value store — partitioning, replication, quorum?", "Design a notification system — why a queue?"]$parts$,
  $md$## Design a rate limiter?

Sliding-window counter in Redis, per-minute keys `rate:{user_id}:{minute}`: `INCR` the current minute (`EXPIRE` to auto-clean), add the previous minute weighted by overlap, reject with `429` + `Retry-After` when over the limit. A fixed-window counter is simpler but has a boundary flaw (100 requests at 11:59 + 100 at 12:00 = 200 in 2 seconds across the boundary); sliding window fixes that with no extra memory cost. Distributed gateways must share one Redis — per-node local counters let each node independently allow the full limit, multiplying the effective cap by the node count. Need bursts specifically? Use a token bucket instead.

## Fan-out on write vs read?

Write (push): on post, precompute it into every follower's feed (Redis sorted sets). Reads are instant, but a 10M-follower celebrity means 10M writes per post — too much. Read (pull): build the feed at load time by querying followed users and merging. Writes are cheap; reads degrade as a user follows more people. Hybrid (Twitter/Meta): fan-out on write for regular users (<~10K followers), fan-out on read for celebrities, merged at load — fast reads for most, bounded write amplification.

## Design a URL shortener?

Short code: base62-encode an auto-increment BIGINT id (62^7 ≈ 3.5T codes) rather than hashing — no collisions, no retry logic, at the cost of sequential codes being guessable. Redirect: Redis lookup for `short_code → long_url` (reads vastly outnumber writes) → DB on a cache miss. 302 (temporary) hits your server every time, useful for click analytics; 301 (permanent) gets browser-cached, saving load but losing that visibility — name the trade-off.

## Design a key-value store — partitioning, replication, quorum?

**Partitioning:** consistent hashing — each key maps to the first node clockwise on the ring; adding/removing a node remaps only ~1/N keys. **Replication:** store each key on N nodes (e.g. 3) — the primary plus the next N-1 clockwise — so the store survives node loss. **Quorum:** N = replica count, W = write acks required, R = read responses required. W + R > N gives strong consistency (e.g. N=3, W=2, R=2 tolerates one failure); W + R ≤ N gives eventual consistency but is faster (W=1, R=1). **Conflict resolution:** last-write-wins by timestamp (simple, risks clock skew) or vector clocks (track causality, return concurrent versions for the client to resolve). **Membership:** gossip — nodes periodically share state with random peers, spreading changes in O(log N) rounds with no central coordinator (used by Cassandra and Dynamo).

## Design a notification system — why a queue?

Producers (order/user services) publish events to a queue (Kafka); a notification service consumes, looks up preferences, and routes to push (APNs/FCM), email (SendGrid), or SMS (Twilio). The queue decouples producers from delivery, buffers traffic spikes, lets consumers drain at their own pace instead of being flooded, and enables retry-from-the-queue. Retry with exponential backoff (1s, 2s, 4s, 8s... up to ~5 tries) then a dead-letter queue. Dedup retried sends by tracking a `notification_id` with an atomic check-then-mark (Redis `SETNX` or a DB unique constraint), since a retry can otherwise double-send.
$md$,
  ARRAY['system-design', 'rate-limiting', 'key-value-store', 'news-feed']
),

-- ── System Design — Day 3 ────────────────────────────────────────────────
(
  'More Systems + LLD + Trade-offs',
  'hard',
  $parts$["Design a chat system?", "Design search autocomplete?", "Design YouTube upload?", "Consistency vs availability — when?", "Design a parking lot — LLD classes and patterns?"]$parts$,
  $md$## Design a chat system?

WebSocket for real-time full-duplex delivery — HTTP polling is high-latency and wasteful. At scale, clients land on different chat servers, so servers route between each other via a message queue (Kafka) or a Redis presence lookup. Storage: Cassandra, partitioned by `conversation_id` with a `TIMEUUID` clustering key — colocates a conversation and keeps it time-sorted for fast `WHERE conversation_id = ? LIMIT 20` reads (write-heavy, always read by conversation + time range — a bad fit for a relational join-heavy store). Message IDs: Snowflake (timestamp + datacenter + machine + sequence packed into 64 bits) — unique and roughly time-sortable with no central coordinator, unlike auto-increment. Presence: each connection heartbeats every ~5s into `presence:{user_id}` in Redis with a short TTL; no heartbeat, the key expires, self-cleaning. Offline users get a push (APNs/FCM) and fetch missed messages by last-seen timestamp on reconnect.

## Design search autocomplete?

A trie (prefix tree) stores strings by character path, but walking a deep subtree per keystroke is too slow for a <100ms budget — so each trie node caches its own top-K completions, and a Redis cache in front (`prefix → [suggestions]`) serves most traffic without touching the trie at all. The trie itself isn't updated per search; query logs are aggregated (e.g. via Kafka → Spark, counting frequency and filtering spam) and a new trie is built periodically and swapped in atomically.

## Design YouTube upload?

Chunked, resumable upload: split multi-GB videos into 5–10MB chunks uploaded independently and reassembled server-side — a failure only requires re-uploading the failed chunk. On "all chunks received," enqueue a transcoding job; a worker pool runs FFmpeg per target resolution in parallel (transcoding is CPU-heavy — a 1-hour video can take 30+ minutes) and writes to S3/CDN. Adaptive bitrate (HLS/DASH) splits the output into short segments with a manifest so the player switches resolution as the network changes, without rebuffering. View counts are hot-row writes at scale — increment in Redis and flush to the metadata DB periodically instead of updating the row on every view.

## Consistency vs availability — when?

Pick consistency (CP) when stale data costs money: payments, inventory ("1 left in stock"), seat booking — return an error during a partition rather than risk a double-charge or overselling. Pick availability (AP) when slight staleness is harmless: social feeds, view counts, DNS, search indexes — keep serving rather than error out. Most real systems are AP by default and carve out CP only for the specific write paths where being wrong is expensive.

## Design a parking lot — LLD classes and patterns?

Classes: `ParkingLot` (composes `Floor`), `Floor` (composes `ParkingSpot`), `ParkingSpot` (compact/large/handicapped/motorcycle; state Available/Reserved/Occupied), `Vehicle` (abstract → `Car`, `Truck`, `Motorcycle`), `Ticket` (associates a `Spot` and a `Vehicle`, tracks entry/exit time), `PaymentStrategy` (`CashPayment`, `CardPayment`). Patterns: Strategy for the payment method, Singleton for the lot manager, Factory Method to create spot types, Observer to notify admins when a floor fills. This is the same design as OOP Day 3's parking-lot question — LLD questions and OOP pattern questions converge on the same worked example for a reason: they're testing the same skill from two directions.
$md$,
  ARRAY['system-design', 'chat-system', 'lld', 'trade-offs']
)
ON CONFLICT (title) DO UPDATE SET
  difficulty   = EXCLUDED.difficulty,
  parts        = EXCLUDED.parts,
  reference_md = EXCLUDED.reference_md,
  tags         = EXCLUDED.tags;
