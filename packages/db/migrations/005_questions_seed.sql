-- Seed content for questions.bank.
--
-- Question authoring is out of scope for the whole project (DESIGN.md), so the
-- bank is seeded once here rather than written through an API. Content is
-- adapted from a personal CS-fundamentals study repo. Each notes file closes
-- with its questions already paired to answers — "Interview Questions
-- Answered" in the day files, "High-Value Interview Questions to Drill" in the
-- overviews — so the questions become `parts` and the answers (plus any
-- "Quick Mental Models" section) become `reference_md`.
--
-- Nine topics. Five of them (OS, Networking, Databases, OOP, System Design)
-- are three-day curricula, one row per day. The other four (Security,
-- Debugging, AI Tooling, Behavioural) are single overview files, split into
-- three rows each along the seams the notes already have.
--
-- `difficulty` is a row's position inside its own topic, not an absolute
-- rating: first easy, second medium, third hard. The notes are a curriculum
-- where the later material assumes the earlier, so that is what the source
-- actually encodes, and it reads correctly to someone working through one
-- topic. It does mean the labels are not comparable across topics.
--
-- It also has a property the product depends on. Matching pairs people by
-- topic *and* difficulty, and refuses the match when no question fits, so a
-- combination with nothing behind it is a pair of users who can never be
-- matched — a dead end they meet only after choosing. Nine topics × three
-- lands exactly on the grid, one question per cell. An earlier ad-hoc
-- assignment left five of the then-fifteen cells empty.
--
-- Behavioural is shaped differently on purpose; see the note above its rows.

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
  $parts$["Process vs thread?","What happens on fork()?","Why are threads cheaper than processes?","What is a zombie process?","What is a race condition? Example?","What is a context switch and why is it expensive?"]$parts$,
  $md$### 1. Process vs thread?

A process is an isolated running program with its own address space, page tables, file descriptors, and PCB (process control block). A thread runs inside a process with its own stack and registers but shares everything else. Threads share memory (cheap communication, needs synchronization); processes are isolated (safe, but need IPC). Thread creation is cheap; process creation is expensive. Same-process thread switches skip the TLB flush.

### 2. What happens on fork()?

The OS makes a child that's a near-exact copy of the parent. Both continue after `fork()`. It returns twice; the parent gets the child's PID, the child gets 0. The child's address space is copy-on-write. Pages are shared read-only until one side writes, then just that page is copied.

### 3. Why are threads cheaper than processes?

Shared address space: no new page tables, no heap copy, no TLB flush on switch. Creation is just a stack + Thread Control Block, and communication is a memory read/write instead of a pipe or socket.

### 4. What is a zombie process?

A process that exited but whose parent hasn't called `wait()`. It uses no CPU/memory, but its PCB entry stays so the parent can read the exit status; `wait()` removes it. An orphan (parent exits first) is re-parented to PID 1, which reaps it.

### 5. What is a race condition? Example?

When correctness depends on thread timing. Two threads doing `counter++` (load/add/store): a switch between one thread's load and store loses the other's update. Non-deterministic, so it's hard to reproduce and debug.

### 6. What is a context switch and why is it expensive?

The OS stops one process/thread and starts another, saving the current registers to its PCB and restoring the next's. Costs: register save/restore, cache thrash (the new process starts cold), and, for process switches, a TLB flush causing page-table walks until mappings re-cache.

### Mental models

- **Process = house; thread = person in it.** Own bedroom (stack), shared kitchen (heap, globals). People can trip over each other.
- **fork() = photocopier; exec() = body snatcher.** Fork duplicates the process; exec keeps the same body (PID) but swaps the personality (code).
- **Trap = a supervised phone call to the kernel.** You dial an extension (syscall number); the kernel does the work and hangs up. You can't dial its private lines.
- **Race condition = two chefs, one recipe, no coordination.** Both read, both add salt, both pour, double salt.
$md$,
  ARRAY['os', 'processes', 'threads', 'fork', 'context-switch']
),

-- ── OS — Day 2 ────────────────────────────────────────────────────────────
(
  'Synchronization & Concurrency',
  'medium',
  $parts$["What is a mutex and how does it work?","What is a deadlock? The four conditions?","Mutex vs. semaphore?","What is a condition variable? When?","What is a race condition? Example?","How do you prevent deadlock?","Implement producer-consumer from memory"]$parts$,
  $md$### 1. What is a mutex and how does it work?

A primitive giving mutual exclusion, one holder at a time. Built on atomics (test-and-set / CAS): if free, atomically mark it held and proceed; if held, the thread sleeps (off the run queue). `unlock()` wakes one waiter. Sleeping (vs spinning) avoids wasting CPU.

### 2. What is a deadlock? The four conditions?

Threads permanently blocked waiting on each other. Needs all four Coffman conditions: mutual exclusion, hold-and-wait, no preemption, circular wait. Most practical fix: lock ordering (breaks circular wait).

### 3. Mutex vs. semaphore?

A mutex has ownership (the locker unlocks) and is binary. A semaphore is an ownerless counter; any thread can post. A semaphore init to 1 mimics a mutex, but it can also count (init N for N concurrent) or signal (init 0 to make one thread wait for another). Prefer a mutex for plain mutual exclusion. Ownership prevents another thread from accidentally unlocking it.

### 4. What is a condition variable? When?

Lets a thread sleep until a condition holds, always paired with a mutex. Hold the mutex, check the condition in a `while`, and if false call `cond_wait` (atomically releases the mutex and sleeps). Another thread updates state, takes the mutex, and `signal`s (or `broadcast`s). Classic use: producer-consumer.

### 5. What is a race condition? Example?

Correctness depends on thread timing. Two threads do `balance += amount` (load/add/store). If T1 loads $100, is preempted, T2 loads $100 → adds $50 → stores $150, then T1 resumes with its stale $100 → adds $30 → stores $130, T2's update is lost (should be $180). Fix: a mutex around the critical section.

### 6. How do you prevent deadlock?

Mainly **lock ordering**: a total order over locks, always acquired in that order, breaks circular wait. When you don't control order, order by address. Others: trylock + backoff (no-preemption), acquire all locks atomically (hold-and-wait), lock-free structures (mutual exclusion).

### 7. Implement producer-consumer from memory

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

While coding, say out loud: mutex for exclusion, two CVs to avoid waking the wrong thread type, `while` not `if` (spurious wakeups + stale conditions), signal after updating state. With one CV, a waking consumer might wake another consumer instead of a producer. It finds the buffer empty and sleeps again, and the producer is never woken.

### Mental models

- **Lock = a bathroom key.** One person at a time; if it's taken, you wait outside.
- **Condition variable = an elevator call button.** Press it (wait), sleep, get woken when the elevator (your condition) arrives. All while holding the lobby key (mutex) so it can't arrive and leave before you press.
- **Semaphore = a bouncer with N wristbands.** Take one (wait), return it (post); if all N are out, wait. Init 1 = exclusive; init 0 = wait for a post; init N = N allowed in.
- **Deadlock = two people in a hallway, each waiting for the other to step aside** (dining philosophers: all grab the left fork, all wait for the right). Fix: a shared rule for who yields, lock ordering.
$md$,
  ARRAY['os', 'concurrency', 'locks', 'deadlock', 'semaphores']
),

-- ── OS — Day 3 ────────────────────────────────────────────────────────────
(
  'Memory & I/O',
  'hard',
  $parts$["What is virtual memory and why?","What is a page fault?","Stack vs heap?","What is memory fragmentation?","Blocking vs non-blocking I/O?","How does Node handle 10k connections on one thread?","Thread pool vs thread per request?","What is a context switch and why expensive?"]$parts$,
  $md$### 1. What is virtual memory and why?

The OS abstraction giving each process its own private, contiguous address space, mapped to physical RAM via page tables. Reasons: isolation (no cross-process corruption), transparency (processes ignore physical layout), efficiency (sharing, overcommit, swapping to disk).

### 2. What is a page fault?

A hardware exception when a process accesses a page whose PTE present bit = 0 (not in RAM). The OS handler finds the page on disk, loads it into a free frame, updates the page table, and resumes. If the page was never mapped, the OS kills the process with a segfault.

### 3. Stack vs heap?

Stack: locals, params, return addresses; auto push/pop per call; fast but ~8MB. Heap: dynamic memory (`malloc`/`new`), manual in C/C++ or GC'd elsewhere; large but slower and fragmentable. Locals go on the stack; `new`/`malloc` objects on the heap.

### 4. What is memory fragmentation?

External: free memory split into non-contiguous pieces so a large request fails despite enough total free; caused by variable-sized alloc/free over time; paging eliminates it. Internal: wasted space inside a block (asked 100B, got 128B → 28B wasted).

### 5. Blocking vs non-blocking I/O?

Blocking: the thread sleeps until the op completes. Simple but one thread per concurrent op, doesn't scale. Non-blocking: returns immediately (data or `EAGAIN`); paired with `epoll`, one thread monitors thousands of sockets and handles whichever are ready, the basis of the event loop.

### 6. How does Node handle 10k connections on one thread?

An **event loop** via `libuv` (Node's C I/O library) over `epoll`/`kqueue`. A request registers a callback and returns; when its I/O completes, the OS fires an epoll event and Node runs the callback. The thread never blocks. Always running a callback or in `epoll_wait`. Works because the workload is I/O-bound: the OS does the waiting.

### 7. Thread pool vs thread per request?

Thread per request is simple but doesn't scale. ~1-8MB stack each and linear switch overhead. A fixed pool (e.g., 4× cores) caps memory and switch cost, good for bounded work. But if all threads block on slow I/O the pool starves. For I/O-heavy services prefer an event loop; common hybrid: small pool for CPU work + async I/O for network.

### 8. What is a context switch and why expensive?

The OS stops one process/thread and starts another, saving/restoring registers via the PCB; on process switches it also swaps the page-table base and flushes the TLB. Costs: register save/restore (cheap), TLB flush (page-table walks until warm), cache invalidation (cold caches), scheduler overhead. ~1-10 µs direct, plus an indirect tail from cold TLB/caches that often dominates.

### Mental models

- **Virtual memory = postal addressing.** You write "123 Main St" (virtual); the post office (OS+hardware) translates it to GPS coordinates (physical). Two cities can share the same street name with no conflict.
- **Page table = a book's index; TLB = a sticky note of recent lookups.** "Chapter 5 → page 78" maps VPN → frame. A TLB miss is a cache miss for translation, walk the index in RAM.
- **Page fault = the page is in the filing cabinet (disk), not on your desk.** You must fetch it before reading, slow.
- **Event loop = one efficient waiter.** Takes an order (registers a callback), tells the kitchen (kernel), takes more orders; when the bell rings (`epoll_wait` returns), delivers the ready dishes. Never just stands waiting.
$md$,
  ARRAY['os', 'memory', 'virtual-memory', 'io', 'event-loop']
),

-- ── Networking — Day 1 ───────────────────────────────────────────────────
(
  'The Network Stack & TCP/IP',
  'easy',
  $parts$["What happens when a client connects to a server at the network level?","TCP vs UDP, when would you use UDP?","What is the TCP three-way handshake?","What is head-of-line blocking?","What happens during a TLS handshake?"]$parts$,
  $md$### 1. What happens when a client connects to a server at the network level?

DNS resolves the hostname to an IP. The client OS picks an ephemeral port and sends a TCP SYN to the server's IP:port; the server replies SYN-ACK; the client sends ACK. Handshake done, both sides have a socket. The client sends its request (e.g. HTTP) over the connection; data flows in ACKed segments. When done, one side sends FIN to tear down.

### 2. TCP vs UDP, when would you use UDP?

UDP for video (drop a frame rather than retransmit), VoIP (stale audio is useless), DNS (tiny, easy to retry), and gaming (latest position matters). TCP for anything needing complete, correct delivery: HTTP/1.1 and 2, SSH, DB connections, file transfers.

### 3. What is the TCP three-way handshake?

Client sends SYN with its ISN (initial sequence number); server replies SYN-ACK with its own ISN plus an ACK of the client's; client sends ACK. Now both sides agree on sequence numbers and can exchange data. Three steps are needed so each side proves it can both send and receive.

### 4. What is head-of-line blocking?

In HTTP/1.1 a connection handles one request at a time, so a large in-flight response blocks smaller ready ones. Browsers work around it with ~6 parallel connections per domain. HTTP/2 multiplexes many streams over one TCP connection, but a lost TCP segment still stalls all streams (TCP-level HOL blocking). HTTP/3 (QUIC over UDP) makes each stream independent, removing that.

### 5. What happens during a TLS handshake?

After the TCP handshake: client sends `ClientHello` (TLS version, cipher suites, random); server replies `ServerHello` (chosen cipher, random) plus its certificate. The client verifies the cert against a trusted CA. Both run a key exchange (e.g. ECDHE) to derive a shared session key without sending it, then confirm with encrypted `Finished` messages. All later data uses fast symmetric encryption; the key was exchanged via slow-but-secure asymmetric math.
$md$,
  ARRAY['networking', 'tcp', 'udp', 'handshake']
),

-- ── Networking — Day 2 ───────────────────────────────────────────────────
(
  'HTTP Deep Dive',
  'medium',
  $parts$["What's the difference between PUT and PATCH?","How does HTTP caching work?","What is CORS and why does it exist?","When would you use WebSockets vs HTTP polling?","What HTTP status codes should you know?"]$parts$,
  $md$### 1. What's the difference between PUT and PATCH?

PUT replaces the whole resource, fields you omit get cleared. PATCH updates only the fields you send. PUT is idempotent; PATCH isn't guaranteed to be (e.g. an increment patch).

### 2. How does HTTP caching work?

`Cache-Control: max-age=3600` lets the browser serve from cache for an hour without hitting the server. After expiry it revalidates with `If-None-Match` and the cached ETag: unchanged → `304` (no body), changed → new `200` with a new ETag. `no-store` forbids caching; `no-cache` allows caching but forces revalidation first.

### 3. What is CORS and why does it exist?

CORS is a browser rule that stops JS from reading responses from a different origin (scheme+host+port) than the page, preventing malicious scripts from silently using a user's credentials. Servers send `Access-Control-Allow-Origin` to whitelist origins. Non-simple requests (PUT/DELETE, custom headers, JSON content type) trigger a preflight `OPTIONS` check first.

### 4. When would you use WebSockets vs HTTP polling?

WebSockets for real-time bidirectional needs (chat, multiplayer, collaboration) where the server must push and latency must be low. Polling for infrequent updates where a few seconds' lag is fine, or where WS is blocked. SSE (server-sent events) for server-to-client-only push over HTTP with auto-reconnect.

### 5. What HTTP status codes should you know?

200 OK, 201 Created, 204 No Content, 301 permanent / 302 temporary redirect, 400 Bad Request, 401 unauthenticated, 403 unauthorized, 404 Not Found, 409 Conflict, 429 rate limited, 500 server error, 503 unavailable. 401 vs 403 is the classic point: 401 = "tell me who you are"; 403 = "I know you, but you can't."
$md$,
  ARRAY['networking', 'http', 'caching', 'cors', 'websockets']
),

-- ── Networking — Day 3 ───────────────────────────────────────────────────
(
  'DNS, Load Balancing & API Design',
  'hard',
  $parts$["What happens when you type a URL and hit enter?","Walk me through a DNS lookup","What is TTL in DNS and why does it matter?","L4 vs L7 load balancer, when each?","REST vs gRPC, when pick gRPC?","How do you version a REST API?","What makes an API idempotent?","How would you paginate a large API response?"]$parts$,
  $md$### 1. What happens when you type a URL and hit enter?

1. **DNS:** browser cache → OS cache → recursive resolver → root → TLD → authoritative → IP (cached per TTL).
2. **TCP:** three-way handshake (SYN, SYN-ACK, ACK) with that IP on port 443.
3. **TLS:** hellos + certificate verified against a CA; key exchange derives the symmetric session key.
4. **HTTP:** browser sends `GET /`; the request typically hits a CDN edge or L7 load balancer, which routes it to an app server; the response returns status + headers (caching, cookies) + body.
5. **Render:** browser parses the HTML and fetches referenced assets over the same connection (HTTP/2 multiplexes them); JS executes.

### 2. Walk me through a DNS lookup

Browser cache → OS cache (checks `/etc/hosts`) → recursive resolver (ISP/8.8.8.8). On a resolver miss: ask a root server for the TLD server, the TLD server for the authoritative server, then the authoritative server for the A record. The resolver caches it for the TTL and returns the IP; the browser opens a TCP connection.

### 3. What is TTL in DNS and why does it matter?

TTL is how long resolvers cache a record. High TTL (86400s) cuts query volume but makes changes take up to 24h to propagate; low TTL (60s) flips that. Before a migration, lower TTL a day ahead so old records expire quickly.

### 4. L4 vs L7 load balancer, when each?

L4 for very high throughput or raw TCP services (DBs, streaming) with no need for content-aware routing. L7 for HTTP routing by URL/host (route `/api/` vs `/static/`), SSL termination, cookie session affinity, HTTP health checks, and canary releases.

### 5. REST vs gRPC, when pick gRPC?

Internal service-to-service calls where you own both ends and need max performance or streaming. Binary protobuf is smaller/faster than JSON and the strict schema prevents type mismatches. For public, browser-facing APIs, prefer REST (or GraphQL) since browsers can't call gRPC natively.

### 6. How do you version a REST API?

URL versioning (`/v1/`, `/v2/`) is most common and explicit. Easy to route, test, document. Header versioning is cleaner but less practical. Core rule: never break a live version. Removing a field, changing its type, or changing behaviour is breaking; adding optional fields is safe. When you must break, ship a new version and support both during a migration window.

### 7. What makes an API idempotent?

Repeating it N times equals doing it once. GET (reads don't change state), PUT (re-replacing with the same data), and DELETE (deleting an already-deleted thing) are idempotent. POST isn't. Each `POST /orders` creates a new order. For retry-safe POSTs (payments), use idempotency keys.

### 8. How would you paginate a large API response?

Prefer cursor over offset. Offset duplicates or skips rows when data changes mid-pagination and gets slow at high offsets. Cursor uses a stable reference (last ID/timestamp). `?after=ord_xyz&limit=20`, so it's fast and stable. Trade-off: no jumping to an arbitrary page.
$md$,
  ARRAY['networking', 'dns', 'load-balancing', 'api-design', 'rest']
),

-- ── Databases — Day 1 ────────────────────────────────────────────────────
(
  'SQL Foundations & Indexing',
  'easy',
  $parts$["Clustered vs non-clustered index?","Why does column order matter in a composite index?","When would a query NOT use an index?","What is a covering index?","WHERE vs HAVING?","Second highest salary, window function vs subquery"]$parts$,
  $md$### 1. Clustered vs non-clustered index?

Clustered sets the physical row order. One per table, usually the primary key. Non-clustered is a separate structure of values + pointers to rows, and you can have many. Clustered is faster for range scans (rows are sequential); non-clustered needs an extra hop per row.

### 2. Why does column order matter in a composite index?

A B-tree is sorted left-to-right, so an index on `(A,B,C)` answers filters on `A`, `A+B`, or `A+B+C`, but not `B` or `C` alone. Put equality columns before range columns, high-selectivity columns first.

### 3. When would a query NOT use an index?

A function wrapping the column (`WHERE UPPER(email) = ...`), low selectivity (`WHERE is_active = true` when 95% match), skipping the leading composite column, a leading `%` in `LIKE`, or a tiny table where the planner prefers a scan. Confirm with `EXPLAIN`.

### 4. What is a covering index?

One that holds every column the query needs, so the engine reads only the index, the fastest read path. Build it from the SELECT + WHERE + JOIN columns. `EXPLAIN` shows this as an "Index Only Scan."

### 5. WHERE vs HAVING?

WHERE filters rows before grouping; HAVING filters groups after aggregation.

### 6. Second highest salary, window function vs subquery

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
  $parts$["What does ACID mean? Example of each.","Dirty read vs phantom read?","How does MVCC work?","Optimistic vs pessimistic locking?","How do you handle a deadlock?","Postgres default isolation level?"]$parts$,
  $md$### 1. What does ACID mean? Example of each.

**Atomicity:** a transfer debits and credits, or neither. Enforced by the WAL (write-ahead log). **Consistency:** a `CHECK (balance >= 0)` constraint is never broken. **Isolation:** two people booking the last ticket, only one succeeds. **Durability:** a committed payment survives a crash because it's on the WAL, fsynced before commit is acknowledged.

### 2. Dirty read vs phantom read?

Dirty read: reading another transaction's uncommitted write; if it rolls back you read data that never existed (prevented at Read Committed and above). Phantom read: a range query returns extra rows because another transaction inserted into that range and committed (prevented at Serializable).

### 3. How does MVCC work?

Each row version carries a creating transaction ID (`xmin`) and a deleting one (`xmax`). A transaction's snapshot shows only versions whose `xmin` committed before it and whose `xmax` is empty or committed later. Readers get a consistent point-in-time view without locks; writers just append versions; nobody blocks. `VACUUM` removes dead versions.

### 4. Optimistic vs pessimistic locking?

Pessimistic: lock on read (`SELECT ... FOR UPDATE`) until commit, good for high contention. Optimistic: no lock; carry a version, check it on update, retry if it changed. Good for low contention where locking would waste time waiting.

### 5. How do you handle a deadlock?

The DB detects the cycle automatically (Postgres after ~1s) and aborts one transaction (the victim) with an error; the app retries. Prevent it by acquiring locks in a consistent order, and add retry-with-backoff in app code.

### 6. Postgres default isolation level?

Read Committed. Each statement sees a fresh snapshot of committed data. It prevents dirty reads but allows non-repeatable and phantom reads. Escalate to Repeatable Read or Serializable when you need a stable view across statements.
$md$,
  ARRAY['databases', 'transactions', 'acid', 'mvcc', 'isolation-levels']
),

-- ── Databases — Day 3 ────────────────────────────────────────────────────
(
  'NoSQL, CAP Theorem & When to Use What',
  'hard',
  $parts$["MongoDB over Postgres?","When Cassandra?","Eventual consistency in practice?","Redis vs a database?","Hotspot in sharding, and prevention?","CAP theorem, with examples?"]$parts$,
  $md$### 1. MongoDB over Postgres?

When data is document-centric with varying fields (e.g. a product catalogue), when related data is naturally embedded and read together, or when rapid schema iteration matters. Not for complex multi-collection joins or strongly relational data; multi-document transactions exist but are costly, so heavy cross-document ACID points to SQL.

### 2. When Cassandra?

Write-heavy at massive scale (IoT, activity streams, metrics), when you need linear horizontal scaling, when availability beats strong consistency (AP), and when access is always by a known partition key. Not for ad-hoc queries, aggregations, or joins.

### 3. Eventual consistency in practice?

After a write, replicas sync asynchronously over ms–seconds; a read to another replica meanwhile returns the old value. Don't assume writes are instantly visible everywhere. Workarounds: route reads-after-writes to the same node, or read at `QUORUM` for critical data.

### 4. Redis vs a database?

Redis keeps data in RAM. 100-1000× faster than disk but memory-bound and pricier per GB, with no complex queries. It targets caching, sessions, counters, and queues via native structures; persistence is optional and adds write cost. Use it as a cache in front of a durable store, not as the system of record.

### 5. Hotspot in sharding, and prevention?

A hotspot is one shard taking disproportionate traffic, usually from a poor shard key (e.g. a few power users all mapping to one shard). Prevent it with a high-cardinality key (many distinct values, e.g. hash the ID) so writes spread evenly, consistent hashing so resharding remaps few keys, and a random suffix to split hot keys.

### 6. CAP theorem, with examples?

Guarantee only two of Consistency, Availability, Partition tolerance; since partitions are inevitable, the choice is CP vs AP. CP: a payment DB returns an error during a partition rather than risk a double charge. AP: a social feed keeps serving (slightly stale) content because availability wins. DNS is AP. It serves cached records during a partition.
$md$,
  ARRAY['databases', 'nosql', 'cap-theorem', 'sharding']
),

-- ── OOP — Day 1 ───────────────────────────────────────────────────────────
(
  'The 4 Pillars & Class Relationships',
  'easy',
  $parts$["Explain encapsulation. Why is it important?","Abstraction vs encapsulation?","When choose composition over inheritance?","Abstract class vs interface?","What is runtime polymorphism and how does it work?"]$parts$,
  $md$### 1. Explain encapsulation. Why is it important?

It bundles data with the methods that act on it and uses access modifiers to control access. This enforces invariants (rules that must always hold, like a balance never going negative), reduces coupling (callers depend on the interface, not internals), and lets you refactor internals without breaking callers.

### 2. Abstraction vs encapsulation?

Abstraction is the design goal, expose only what's needed. Encapsulation is the mechanism. Access modifiers that hide internal data. Abstraction is what you show; encapsulation is how you hide the rest.

### 3. When choose composition over inheritance?

For "has-a" relationships, when you need runtime flexibility (you can swap a composed object but not inheritance), or to avoid the fragile base class problem. Changing a parent, even harmlessly, can break subclasses because inheritance is tight coupling. Composition depends on an interface, so any implementation can be swapped in.

### 4. Abstract class vs interface?

Abstract class: state, constructor, partial implementation; extend only one (avoids the diamond problem. If a class could extend two parents overriding the same method, which version wins?); use to share code among related classes. Interface: pure contract, no state; implement many; use for a capability unrelated classes share. Core: abstract class = shared identity and code; interface = contract.

### 5. What is runtime polymorphism and how does it work?

A parent-type reference points to a child object and the overridden method is chosen at runtime via a **vtable**. A per-class array of method pointers. Calling `a.speak()` looks up the real type's vtable and calls its implementation. This is dynamic dispatch: binding happens at runtime, not compile time. So `void makeNoise(Animal a) { a.speak(); }` works for any subtype with no `instanceof` chains.
$md$,
  ARRAY['oop', 'pillars', 'polymorphism', 'inheritance']
),

-- ── OOP — Day 2 ───────────────────────────────────────────────────────────
(
  'SOLID Principles + Creational & Structural Patterns',
  'medium',
  $parts$["An SRP violation and its fix?","What does Open/Closed mean in practice?","Explain LSP with a concrete violation.","How does DIP relate to dependency injection?","Why is Singleton an antipattern?","Decorator vs inheritance?"]$parts$,
  $md$### 1. An SRP violation and its fix?

A `UserService` that does user CRUD, sends emails, and generates reports has three reasons to change. Split into `UserService`, `EmailService`, `ReportService`, each with one job. SRP applies to microservices too. A service handling both orders and payments violates it at the architecture level.

### 2. What does Open/Closed mean in practice?

"Open for extension, closed for modification." Add a crypto payment by creating a `CryptoPayment` class implementing `PaymentStrategy`, not by editing `PaymentProcessor`. Tested code stays closed; new behaviour comes from new code. This is why we "program to an interface."

### 3. Explain LSP with a concrete violation.

`Square extends Rectangle`: `setWidth(5)` also sets height, but Rectangle callers expect the two to be independent. `r.setWidth(5); r.setHeight(3); r.area()` expects 15, gets 9. Code written for Rectangle breaks when a Square is substituted, the hierarchy is wrong. Fix: drop the inheritance, give both a `Shape` interface with `area()`, or use composition.

### 4. How does DIP relate to dependency injection?

DIP says high-level and low-level modules should both depend on abstractions, not concretions. DI is the mechanism: instead of `new`-ing a concrete dependency inside a class (`private MySQLDatabase db = new MySQLDatabase();`), you depend on an interface and pass the implementation in via the constructor. Prod injects the real thing; tests inject a mock.

### 5. Why is Singleton an antipattern?

Global mutable state (any code can change it), hidden dependencies (callers just call `getInstance()` without declaring they need it), and broken testability (shared instance, can't inject a mock). Acceptable for truly shared infrastructure with no mutable business state. Connection pools, loggers, immutable config loaded once at startup.

### 6. Decorator vs inheritance?

Decorator composes behaviour at runtime by wrapping an object behind the same interface, avoiding class explosion (`EncryptedCompressedLoggedMessage`-style subclasses for every combination). Inheritance is fixed at compile time. Use it only for a genuine, shallow "is-a" relationship. Examples: Java I/O (`new BufferedReader(new FileReader(...))`), HTTP middleware chains.
$md$,
  ARRAY['oop', 'solid', 'design-patterns', 'singleton']
),

-- ── OOP — Day 3 ───────────────────────────────────────────────────────────
(
  'Behavioural Patterns + Composition vs Inheritance',
  'hard',
  $parts$["Observer vs pub/sub, same thing?","Strategy, a real backend example?","When use Command?","Where does Proxy appear in backends?","Factory vs Factory Method vs Abstract Factory?","Design a parking lot. Classes, relationships, patterns?"]$parts$,
  $md$### 1. Observer vs pub/sub, same thing?

No. Observer is direct, synchronous, in-process. Observers hold a reference to the subject, which notifies them on change. Pub/Sub adds a broker (Kafka, RabbitMQ) in the middle: publisher and subscriber don't know each other, communication is async, and it can span processes/machines. Observer is a design pattern; pub/sub is a messaging architecture.

### 2. Strategy, a real backend example?

Auth middleware: an `AuthStrategy` interface with `authenticate(request)`, implemented by `JWTStrategy`, `APIKeyStrategy`, `OAuth2Strategy`. The router picks one per endpoint. No conditionals in core logic, and a new method is just a new class. Strategy replaces `if/else` chains over algorithm variants with polymorphism.

### 3. When use Command?

Undo/redo (each command implements `execute()` and `undo()`), job queues (serialise a Command, enqueue, a worker calls `execute()`), audit logging, and transactional sequences you may need to roll back. The Invoker holds/runs commands; the Receiver does the actual work.

### 4. Where does Proxy appear in backends?

Caching in front of a DB/API call (avoid repeated expensive lookups), an API gateway validating JWTs before forwarding (auth check before delegating), ORM lazy loading of relationships (defer the query until the field is actually accessed. Hibernate/JPA does this), and circuit breakers that stop forwarding to a failing service. Proxy controls access to the real object behind the same interface; Decorator adds behaviour instead.

### 5. Factory vs Factory Method vs Abstract Factory?

Simple Factory: a static helper that creates by parameter. Not a Gang-of-Four pattern, just a helper. Factory Method: an abstract method subclasses override to create one product (`DogFactory.create() → new Dog()`). Abstract Factory: creates *families* of related products that must be used together (`MacFactory` makes `MacButton` + `MacTextBox`; `WindowsFactory` makes the Windows set).

### 6. Design a parking lot. Classes, relationships, patterns?

Classes: `ParkingLot`, `Floor`, `ParkingSpot` (compact/large/handicapped), `Vehicle` (abstract → `Car`, `Truck`, `Motorcycle`), `Ticket`, `Payment`. Relationships: `ParkingLot` composes `Floor`, `Floor` composes `ParkingSpot`; `Ticket` associates a `Spot` and a `Vehicle`. Patterns: Strategy for payment method, Observer to signal a full floor, Factory Method to create spot types, Singleton for the lot manager. Model spot status as a state machine: Available → Reserved → Occupied → Available.
$md$,
  ARRAY['oop', 'design-patterns', 'observer', 'strategy']
),

-- ── System Design — Day 1 ────────────────────────────────────────────────
(
  'Foundations & Building Blocks',
  'easy',
  $parts$["Scale a system from 1 user to 10M?","Horizontal vs vertical scaling?","How does consistent hashing work and why use it?","How does a CDN work?","SQL vs NoSQL?"]$parts$,
  $md$### 1. Scale a system from 1 user to 10M?

Single server → split app/DB so each scales independently → load balancer + stateless app servers (sessions in Redis, not on the box) → Redis cache in front of the DB → read replicas → CDN for static assets → shard the DB when writes bottleneck. Measure and find the real bottleneck before each step rather than pre-optimising.

### 2. Horizontal vs vertical scaling?

Vertical: more CPU/RAM on one box. Simple, no code change, but a hard ceiling, single point of failure, and expensive. Horizontal: more machines. Needs stateless design, scales ~indefinitely, survives a single node dying, more ops complexity. Preferred for production.

### 3. How does consistent hashing work and why use it?

Servers and keys map onto a hash ring; each key goes to the next server clockwise. Adding or removing a server remaps only ~1/N keys (the ones between it and its ring neighbour), instead of nearly everything the way plain `hash % N` does on resize. Which also causes a thundering herd against the cache/DB behind it. Used in Memcached client sharding, Cassandra/Dynamo-style stores, and CDN routing. Virtual nodes (many ring positions per physical server) even out the load further.

### 4. How does a CDN work?

A globally distributed fleet of edge servers caching content close to users. DNS/anycast routes a user to the nearest edge. Cache hit → served immediately from the edge; miss → the edge fetches from the origin, caches it per `Cache-Control`, and serves later requests from cache. Cuts latency (short round trip to the edge), offloads the origin, and absorbs traffic spikes/DDoS at the edge instead of at your servers.

### 5. SQL vs NoSQL?

SQL (Postgres, MySQL): ACID transactions, joins, stable schema, relational integrity, banking, payments, inventory. NoSQL: massive write throughput (Cassandra, time-series/IoT), flexible documents (MongoDB, varying schema), sub-millisecond cache (Redis), full-text search (Elasticsearch). Most real systems use both. SQL for transactional data, Redis for cache, maybe Elasticsearch for search. Rather than picking one for everything.
$md$,
  ARRAY['system-design', 'scaling', 'caching', 'consistent-hashing']
),

-- ── System Design — Day 2 ────────────────────────────────────────────────
(
  'Classic HLD Problems',
  'medium',
  $parts$["Design a rate limiter?","Fan-out on write vs read?","Design a URL shortener?","Design a key-value store. Partitioning, replication, quorum?","Design a notification system, why a queue?"]$parts$,
  $md$### 1. Design a rate limiter?

Sliding-window counter in Redis, per-minute keys `rate:{user_id}:{minute}`: `INCR` the current minute (`EXPIRE` to auto-clean), add the previous minute weighted by overlap, reject with `429` + `Retry-After` when over the limit. A fixed-window counter is simpler but has a boundary flaw (100 requests at 11:59 + 100 at 12:00 = 200 in 2 seconds across the boundary); sliding window fixes that with no extra memory cost. Distributed gateways must share one Redis. Per-node local counters let each node independently allow the full limit, multiplying the effective cap by the node count. Need bursts specifically? Use a token bucket instead.

### 2. Fan-out on write vs read?

Write (push): on post, precompute it into every follower's feed (Redis sorted sets). Reads are instant, but a 10M-follower celebrity means 10M writes per post, too much. Read (pull): build the feed at load time by querying followed users and merging. Writes are cheap; reads degrade as a user follows more people. Hybrid (Twitter/Meta): fan-out on write for regular users (<~10K followers), fan-out on read for celebrities, merged at load. Fast reads for most, bounded write amplification.

### 3. Design a URL shortener?

Short code: base62-encode an auto-increment BIGINT id (62^7 ≈ 3.5T codes) rather than hashing. No collisions, no retry logic, at the cost of sequential codes being guessable. Redirect: Redis lookup for `short_code → long_url` (reads vastly outnumber writes) → DB on a cache miss. 302 (temporary) hits your server every time, useful for click analytics; 301 (permanent) gets browser-cached, saving load but losing that visibility, name the trade-off.

### 4. Design a key-value store. Partitioning, replication, quorum?

**Partitioning:** consistent hashing. Each key maps to the first node clockwise on the ring; adding/removing a node remaps only ~1/N keys. **Replication:** store each key on N nodes (e.g. 3), the primary plus the next N-1 clockwise, so the store survives node loss. **Quorum:** N = replica count, W = write acks required, R = read responses required. W + R > N gives strong consistency (e.g. N=3, W=2, R=2 tolerates one failure); W + R ≤ N gives eventual consistency but is faster (W=1, R=1). **Conflict resolution:** last-write-wins by timestamp (simple, risks clock skew) or vector clocks (track causality, return concurrent versions for the client to resolve). **Membership:** gossip. Nodes periodically share state with random peers, spreading changes in O(log N) rounds with no central coordinator (used by Cassandra and Dynamo).

### 5. Design a notification system, why a queue?

Producers (order/user services) publish events to a queue (Kafka); a notification service consumes, looks up preferences, and routes to push (APNs/FCM), email (SendGrid), or SMS (Twilio). The queue decouples producers from delivery, buffers traffic spikes, lets consumers drain at their own pace instead of being flooded, and enables retry-from-the-queue. Retry with exponential backoff (1s, 2s, 4s, 8s... up to ~5 tries) then a dead-letter queue. Dedup retried sends by tracking a `notification_id` with an atomic check-then-mark (Redis `SETNX` or a DB unique constraint), since a retry can otherwise double-send.
$md$,
  ARRAY['system-design', 'rate-limiting', 'key-value-store', 'news-feed']
),

-- ── System Design — Day 3 ────────────────────────────────────────────────
(
  'More Systems + LLD + Trade-offs',
  'hard',
  $parts$["Design a chat system?","Design search autocomplete?","Design YouTube upload?","Consistency vs availability, when?","Design a parking lot, LLD classes and patterns?"]$parts$,
  $md$### 1. Design a chat system?

WebSocket for real-time full-duplex delivery. HTTP polling is high-latency and wasteful. At scale, clients land on different chat servers, so servers route between each other via a message queue (Kafka) or a Redis presence lookup. Storage: Cassandra, partitioned by `conversation_id` with a `TIMEUUID` clustering key. Colocates a conversation and keeps it time-sorted for fast `WHERE conversation_id = ? LIMIT 20` reads (write-heavy, always read by conversation + time range. A bad fit for a relational join-heavy store). Message IDs: Snowflake (timestamp + datacenter + machine + sequence packed into 64 bits). Unique and roughly time-sortable with no central coordinator, unlike auto-increment. Presence: each connection heartbeats every ~5s into `presence:{user_id}` in Redis with a short TTL; no heartbeat, the key expires, self-cleaning. Offline users get a push (APNs/FCM) and fetch missed messages by last-seen timestamp on reconnect.

### 2. Design search autocomplete?

A trie (prefix tree) stores strings by character path, but walking a deep subtree per keystroke is too slow for a <100ms budget. So each trie node caches its own top-K completions, and a Redis cache in front (`prefix → [suggestions]`) serves most traffic without touching the trie at all. The trie itself isn't updated per search; query logs are aggregated (e.g. via Kafka → Spark, counting frequency and filtering spam) and a new trie is built periodically and swapped in atomically.

### 3. Design YouTube upload?

Chunked, resumable upload: split multi-GB videos into 5-10MB chunks uploaded independently and reassembled server-side. A failure only requires re-uploading the failed chunk. On "all chunks received," enqueue a transcoding job; a worker pool runs FFmpeg per target resolution in parallel (transcoding is CPU-heavy. A 1-hour video can take 30+ minutes) and writes to S3/CDN. Adaptive bitrate (HLS/DASH) splits the output into short segments with a manifest so the player switches resolution as the network changes, without rebuffering. View counts are hot-row writes at scale. Increment in Redis and flush to the metadata DB periodically instead of updating the row on every view.

### 4. Consistency vs availability, when?

Pick consistency (CP) when stale data costs money: payments, inventory ("1 left in stock"), seat booking. Return an error during a partition rather than risk a double-charge or overselling. Pick availability (AP) when slight staleness is harmless: social feeds, view counts, DNS, search indexes. Keep serving rather than error out. Most real systems are AP by default and carve out CP only for the specific write paths where being wrong is expensive.

### 5. Design a parking lot, LLD classes and patterns?

Classes: `ParkingLot` (composes `Floor`), `Floor` (composes `ParkingSpot`), `ParkingSpot` (compact/large/handicapped/motorcycle; state Available/Reserved/Occupied), `Vehicle` (abstract → `Car`, `Truck`, `Motorcycle`), `Ticket` (associates a `Spot` and a `Vehicle`, tracks entry/exit time), `PaymentStrategy` (`CashPayment`, `CardPayment`). Patterns: Strategy for the payment method, Singleton for the lot manager, Factory Method to create spot types, Observer to notify admins when a floor fills. This is the same design as OOP Day 3's parking-lot question. LLD questions and OOP pattern questions converge on the same worked example for a reason: they're testing the same skill from two directions.
$md$,
  ARRAY['system-design', 'chat-system', 'lld', 'trade-offs']
),

-- ── Security — Part 1 ─────────────────────────────────────────────────────
(
  'Authentication, Authorization & Password Storage',
  'easy',
  $parts$["Authentication vs authorization?","How do you store passwords?","Why hash rather than encrypt?","What is a salt, and which attack does it stop?","Why does a password hash need to be slow?"]$parts$,
  $md$### 1. Authentication vs authorization?

Authentication (authN) is *who are you*. Proving identity, usually by logging in. Authorization (authZ) is *what are you allowed to do*. Checking permissions once identity is established. They sound alike and are checked at different moments: a bouncer checking your ID at the door is authentication; whether your ticket admits you to the VIP area is authorization.

### 2. How do you store passwords?

Never in plaintext, and never encrypted. Store a **salted, slow hash**. Bcrypt, scrypt or Argon2 are the names to give. If the database is stolen, the attacker gets hashes rather than everyone's passwords.

### 3. Why hash rather than encrypt?

Encryption is reversible by design: whoever holds the key can recover the original. A hash is one-way. Cheap to compute forwards, impractical to invert. You never need to read a password back; you only need to check whether a submitted one matches, and hashing the submission and comparing does that.

### 4. What is a salt, and which attack does it stop?

A random value mixed into each password before hashing, stored alongside the hash. It makes two users with the same password produce different hashes, which defeats precomputed lookup tables (rainbow tables). The attacker cannot reuse one table across accounts, or even across two users in the same database.

### 5. Why does a password hash need to be slow?

Because the attacker's cost scales with it. A fast hash lets someone who steals the database try billions of guesses per second offline. A deliberately slow, tunable one drops that to a rate where brute force stops being worth it, while costing a legitimate login a few milliseconds nobody notices.

### Mental models

- **Hashing is a blender.** You can turn fruit into a smoothie; you cannot turn the smoothie back into fruit.
- **Salt is a per-user recipe tweak.** Same fruit, different smoothie, so one cheat sheet no longer works for everyone.
$md$,
  ARRAY['security', 'authentication', 'authorization', 'passwords', 'hashing']
),

-- ── Security — Part 2 ─────────────────────────────────────────────────────
(
  'Sessions, Tokens & HTTPS',
  'medium',
  $parts$["Session vs JWT trade-offs?","Why mark a session cookie HttpOnly?","What is OAuth, and is it authentication or authorization?","How does HTTPS work, roughly?","Encryption in transit vs at rest?"]$parts$,
  $md$### 1. Session vs JWT trade-offs?

With a **session**, the server keeps the record ("user 42 is logged in") and hands the browser a session ID in a cookie. Revoking is trivial, delete the record, but the server has to store and look up state for every logged-in user.

With a **JWT** (JSON Web Token), the server hands over a signed token it can verify later without storing anything. It scales well precisely because there is no server-side state, but that is also why it is hard to cancel early: nothing is stored, so nothing can be deleted. The usual mitigation is to keep them short-lived and refresh often.

The trade-off in one line: sessions are easy to revoke and stateful; JWTs are stateless and hard to revoke.

### 2. Why mark a session cookie HttpOnly?

`HttpOnly` tells the browser that page JavaScript may not read the cookie. It is sent on requests as normal, but `document.cookie` cannot see it. So an XSS bug that manages to run a script on your page still cannot lift the session ID out of it. It is defence in depth: it does not stop XSS, it limits what XSS can steal.

### 3. What is OAuth, and is it authentication or authorization?

OAuth lets one application act on your behalf in another without ever seeing your password, delegated **authorization**. The common trap is calling it login: "Log in with Google" is **OpenID Connect (OIDC)**, an identity layer built on top of OAuth. OAuth grants access to something; OIDC tells you who the user is.

### 4. How does HTTPS work, roughly?

HTTPS is HTTP carried over **TLS**. Client and server perform a handshake that agrees on a shared secret key, then everything after is encrypted with it. A **certificate** issued by a trusted authority proves the server really is the host it claims to be, which is what stops an impostor from sitting in the middle and completing the handshake in its place.

### 5. Encryption in transit vs at rest?

In transit protects data while it moves across a network, that is TLS. At rest protects it while stored on a disk or in a database. They are separate concerns and you generally want both: TLS does nothing for a stolen backup, and disk encryption does nothing for a sniffed connection.
$md$,
  ARRAY['security', 'sessions', 'jwt', 'oauth', 'tls']
),

-- ── Security — Part 3 ─────────────────────────────────────────────────────
(
  'Common Attacks & Safe Defaults',
  'hard',
  $parts$["What is SQL injection and how do you stop it?","What is XSS and how do you stop it?","XSS vs CSRF?","What is broken access control?","How would you secure a REST API?","Where do you keep API keys and secrets?"]$parts$,
  $md$### 1. What is SQL injection and how do you stop it?

The application builds a query by gluing user input into a string, so input that contains SQL stops being data and becomes part of the command. Enough to dump a table or bypass a login. The fix is **parameterized queries** (prepared statements): the query structure is sent separately from the values, so the database treats input strictly as data no matter what it contains. Never build SQL by concatenation, even when the input "obviously" cannot be hostile.

### 2. What is XSS and how do you stop it?

Cross-Site Scripting: an attacker gets their script to execute inside another user's browser on your origin. Typically by submitting it somewhere that is later rendered, like a comment box. Because it runs on your page, it can read the DOM and reachable cookies. The fix is to escape or sanitize anything user-supplied at the point you render it, plus a Content-Security-Policy as a second layer.

### 3. XSS vs CSRF?

They are routinely confused and the distinction is clean. **XSS** runs the attacker's *script inside your page*. **CSRF** runs no script of yours at all. A malicious page simply causes the victim's browser to send a request to your site, which the browser helpfully attaches the existing login to. XSS is about code execution; CSRF is about riding an authenticated session. CSRF is countered with CSRF tokens and `SameSite` cookies, which make a request prove it originated from your own site.

### 4. What is broken access control?

A logged-in user reaches data that is not theirs. The classic being changing `?id=42` to `?id=43` and seeing someone else's record. Authentication succeeded; authorization was never checked, or was checked only in the UI. The fix is to check permissions on the server for every request against the authenticated identity. Hiding a button is not access control.

### 5. How would you secure a REST API?

Layered defaults rather than one trick: HTTPS everywhere; authenticate the caller; check authorization on every endpoint against that identity; validate and constrain input; rate-limit to blunt abuse and brute force; and keep internal details out of error messages, since a stack trace tells an attacker what to try next.

### 6. Where do you keep API keys and secrets?

In environment variables or a secrets manager. Never in source control, and never hardcoded. A key committed once lives in the history even after it is deleted, so the response to a leak is to rotate it, not to remove the line.

### Safe-default habits worth saying unprompted

- **Least privilege**: every user and service gets the minimum access it needs.
- **Never trust user input**: validate on the server, always.
- **Defense in depth**: several layers, so one failure is not total.
- **Don't invent your own crypto**: use battle-tested libraries.
$md$,
  ARRAY['security', 'owasp', 'sql-injection', 'xss', 'csrf']
),

-- ── Debugging — Part 1 ────────────────────────────────────────────────────
(
  'A Systematic Debugging Method',
  'easy',
  $parts$["How do you approach a bug you have never seen before?","What is a stack trace and how do you read one?","What are breakpoints and stepping?","Print statements or a debugger?"]$parts$,
  $md$### 1. How do you approach a bug you have never seen before?

Six steps, and the value is that it is a method rather than luck:

1. **Reproduce it.** A bug you cannot trigger on demand, you cannot fix or verify. Find the exact input or sequence, reliably.
2. **Read the error.** The stack trace says what and where. Start at the most recent frame that is in *your* code and skip the library frames above it.
3. **Form a hypothesis.** Specific and testable. "this value is empty by the time it reaches here", not "something's wrong with the parser".
4. **Isolate by binary search.** Check the midpoint: is the bug before or after? Halve the search space repeatedly until you are on the line. Same idea as `git bisect` across commits.
5. **Check your assumptions.** The bug is nearly always inside something you were certain of. Print the value you would not have bothered printing.
6. **Fix, verify, and add a test.** Confirm against the repro, ask whether the same mistake exists elsewhere, and leave a test so it cannot come back.

Compressed: reproduce, read the error, hypothesize, binary-search, check assumptions, fix and add a test.

### 2. What is a stack trace and how do you read one?

The report a program prints when it crashes: the chain of calls that led there, with files and line numbers. Order differs by language. Python prints the most recent call last, Java and JavaScript print it first. So find the recency direction before reading. Then scan for the first frame in your own code, because that is usually where your mistake is, even when the exception was raised deeper in a library.

### 3. What are breakpoints and stepping?

A **breakpoint** marks a line as "pause here"; when execution reaches it the program freezes and you can inspect everything in scope. **Stepping** then runs it one line at a time so you can watch values change and catch the exact moment state goes wrong. Which is far more precise than inferring it from output after the fact.

### 4. Print statements or a debugger?

Both, at different stages. Prints are fast, work anywhere including production, and need no setup, but they are noisy and require a re-run per guess. A debugger lets you inspect all state at once and step, which suits tricky local logic. The honest answer is the workflow: prints to narrow down roughly where it goes wrong, then a debugger to examine state once you are close.
$md$,
  ARRAY['debugging', 'method', 'stack-trace', 'breakpoints']
),

-- ── Debugging — Part 2 ────────────────────────────────────────────────────
(
  'Common Bug Types & Isolating Them',
  'medium',
  $parts$["What is an off-by-one error?","What is an aliasing bug?","Which edge cases should you always test?","Why are race conditions especially hard to debug?","How do you find a bug in a huge codebase?"]$parts$,
  $md$### 1. What is an off-by-one error?

Being one out in a count or an index. `<` where you needed `<=`, starting at 1 where the collection starts at 0, or reading one past the end. It is the most common bug in coding interviews because loop bounds are exactly where attention lapses, and it often produces a plausible-looking answer rather than a crash, which is what makes it slip through.

### 2. What is an aliasing bug?

Two names refer to the same underlying object, so mutating through one appears to change the other "by itself". It shows up constantly with lists, dictionaries and default arguments: copying the reference is not copying the value. The tell is a variable changing when nothing nearby touched it. At which point you look for who else holds a reference.

### 3. Which edge cases should you always test?

Empty input, exactly one item, duplicates, negatives, and the maximum size. Most logic is written with the comfortable middle case in mind, and these five are where the assumptions break. Adding them costs a line each and catches a large share of real bugs.

### 4. Why are race conditions especially hard to debug?

Because correctness depends on timing rather than input, so the same run can pass a hundred times and fail on the hundred-and-first. There is often no stable repro, which breaks step one of the method. And the act of observing (adding a print, attaching a debugger) changes the timing enough to hide it. Reasoning about the shared state and the interleaving usually beats trying to catch it live.

### 5. How do you find a bug in a huge codebase?

Narrow the space rather than reading the code. The stack trace points at a file. Binary-search within the flow using prints or breakpoints. If it used to work, `git bisect` finds the commit that introduced it in a logarithmic number of steps, which is often faster than understanding the code at all. The theme is the same at every scale: halve the search area, do not scan it.
$md$,
  ARRAY['debugging', 'off-by-one', 'edge-cases', 'race-conditions', 'bisect']
),

-- ── Debugging — Part 3 ────────────────────────────────────────────────────
(
  'Debugging in Production',
  'hard',
  $parts$["You cannot reproduce the bug, now what?","What do logs, metrics and distributed tracing each tell you?","Walk me through a hard bug you fixed.","Why add a test after fixing a bug?"]$parts$,
  $md$### 1. You cannot reproduce the bug, now what?

Work on making it reproducible rather than guessing at fixes. Add logging that captures the state at the moment it happens, so the next occurrence hands you the inputs. Hunt for what is special about the cases that fail. A particular user, payload, or time of day. And consider the two classic causes of "works on my machine": timing (a race that only loses under production load) and environment (different config, data volume, versions, or clock). A fix you cannot verify against a repro is a guess you will be back to revisit.

### 2. What do logs, metrics and distributed tracing each tell you?

Three different questions. **Logs** are the recorded detail of what happened, and are only useful for a specific request if they carry a request ID to correlate on. **Metrics** are aggregates, error rate, latency percentiles, and answer *when* something started and how bad it is, which is what you look at first. **Distributed tracing** follows one request across service boundaries and answers *which hop* is responsible, which is the question logs cannot answer once a request touches six services.

Roughly: metrics tell you something is wrong, tracing tells you where, logs tell you what.

### 3. Walk me through a hard bug you fixed.

This one is asked as a behavioural question, so answer in STAR shape and let the method show: what broke and what was at stake, how you isolated it (the binary search, the bisect, the log line that gave it away), what the root cause turned out to be, the fix, and the test you left behind. The signal being measured is that you were systematic rather than lucky. So narrate the narrowing, not just the answer. Having one real story ready serves double duty here and in the behavioural round.

### 4. Why add a test after fixing a bug?

It converts a fix into a guarantee. Without it you have addressed today's symptom and nothing stops a later refactor from reintroducing it. And regressions are dispiriting precisely because someone already paid to find that bug once. The test also documents the edge case for whoever reads the code next, and writing it forces you to confirm you actually understood the cause rather than perturbing the code until the symptom left.
$md$,
  ARRAY['debugging', 'production', 'observability', 'tracing', 'logging']
),

-- ── AI Tooling — Part 1 ───────────────────────────────────────────────────
(
  'LLMs, Prompts & Context',
  'easy',
  $parts$["What is an LLM, in one sentence?","What is a token, and what is a context window?","What makes a good prompt?","What does context engineering mean?"]$parts$,
  $md$### 1. What is an LLM, in one sentence?

A large language model is a program that predicts the next piece of text given what came before. Autocomplete taken far enough that, trained on enough text, it can write code, explain an error, or answer a question. An AI coding assistant is that model wired into an editor; you remain the one who reads the output and decides whether it is right.

### 2. What is a token, and what is a context window?

A **token** is the unit a model chops text into, roughly three-quarters of a word. A **context window** is how much text it can hold at once, measured in tokens. Effectively its short-term memory for this conversation. The practical consequence is that a window is a budget: filling it with material that is not relevant crowds out what is, and answer quality falls even though nothing has technically overflowed.

### 3. What makes a good prompt?

Being specific about the outcome and showing an example of the shape you want. Vague instructions get plausible but generic output, because the model has nothing to narrow against. Stating the constraints that matter. The language, the interfaces it must fit, what it must not change. Does more for the result than politeness or length.

### 4. What does context engineering mean?

Being deliberate about the information you hand the model alongside the instruction: the relevant file rather than the whole repository, the actual error text, the rules it has to respect. The model can only be as good as its context, so curating that is most of the skill. It is the same discipline as writing a good bug report for a colleague. Supply what is needed to decide, and leave out what is not.
$md$,
  ARRAY['ai-tooling', 'llm', 'prompting', 'context', 'tokens']
),

-- ── AI Tooling — Part 2 ───────────────────────────────────────────────────
(
  'Agents, RAG & Fine-tuning',
  'medium',
  $parts$["What is an AI agent?","What is RAG and what problem does it solve?","Prompting vs fine-tuning?","What is orchestration?"]$parts$,
  $md$### 1. What is an AI agent?

A model that works in a loop rather than answering once: it takes an action, read a file, run a command, looks at the result, and decides the next step, repeating until the task is done or it gives up. The distinction from a chatbot is the feedback loop; an agent can run your tests, see them fail, and try again, which is what makes multi-step work possible without a human between each step.

### 2. What is RAG and what problem does it solve?

Retrieval-Augmented Generation: rather than pasting an entire corpus into the prompt, you first retrieve the handful of relevant passages and pass only those. It solves two things at once. A context window too small for the whole corpus, and quality degrading when the window is padded with irrelevant material. It also reduces hallucination, because the model is answering from supplied text instead of from memory.

### 3. Prompting vs fine-tuning?

**Prompting**, asking well, with good context and retrieval, needs no training, costs nothing up front, and can be changed instantly. **Fine-tuning** retrains the model on your own data for a narrow task: expensive, slow to iterate on, and it fixes behaviour in place. Default to prompting and treat fine-tuning as the thing you reach for once prompting has genuinely been shown to be insufficient, not as the first step.

### 4. What is orchestration?

Coordinating multiple steps or multiple agents into one workflow. Deciding what runs in sequence, what runs in parallel, and what checks the output of something else. It matters because a single long prompt degrades on a complex task, whereas decomposing it into stages with defined inputs and outputs keeps each step small enough to be reliable.
$md$,
  ARRAY['ai-tooling', 'agents', 'rag', 'fine-tuning', 'orchestration']
),

-- ── AI Tooling — Part 3 ───────────────────────────────────────────────────
(
  'Hallucination & Responsible AI',
  'hard',
  $parts$["What is a hallucination and how do you handle it?","What are the risks of AI-generated code?","What does responsible AI mean day to day?","How do you use AI tools in your own work?"]$parts$,
  $md$### 1. What is a hallucination and how do you handle it?

When the model states something false with full confidence. Inventing a function that does not exist, or a flag with a plausible name. Confidence is the dangerous part: there is no signal in the output distinguishing it from a correct answer. You handle it by verifying against something authoritative rather than by trusting tone: run it, check the documentation, let the type checker and the tests fail. Better context reduces the rate, but nothing removes the need to verify.

### 2. What are the risks of AI-generated code?

Four worth naming: subtle bugs in code that reads fluently, which is harder to catch than obviously broken code; insecure patterns copied from the general shape of training data; invented APIs that fail at run time; and leaking secrets or customer data by pasting them into a prompt. The mitigations are unremarkable. Review it as you would a colleague's pull request, test it, and never paste anything sensitive.

### 3. What does responsible AI mean day to day?

Verify before you ship, because you own the code and the model does not. Never paste secrets, keys or customer data into a prompt. Keep a human in the loop on anything that matters, so the tool assists the decision rather than making it. And sanity-check outputs that affect people, since a model trained on internet text carries the biases of internet text. None of this is exotic; it is ordinary engineering care applied to a new tool.

### 4. How do you use AI tools in your own work?

The strong version of this answer is concrete and bounded: what you use it for, boilerplate, tests, understanding unfamiliar code, debugging, followed by how you check the result. The single line worth having ready is *I drive, I verify*: it signals that you use the tool with judgment rather than either avoiding it or trusting it blindly, and that is what the question is actually measuring. Claiming less than you might is more credible than overselling.
$md$,
  ARRAY['ai-tooling', 'responsible-ai', 'hallucination', 'code-review']
),

-- ── Behavioural — Part 1 ──────────────────────────────────────────────────
--
-- The behavioural entries are shaped differently from every other topic here,
-- deliberately. The source notes are a story *scaffold*: the answers are the
-- author's own experiences, and the slots are blank on purpose. So `parts` are
-- questions about the technique, and `reference_md` describes what a strong
-- answer contains rather than supplying one. A fabricated story would be
-- exactly the thing the notes warn against.
(
  'STAR & What Each Company Tests',
  'easy',
  $parts$["What is the STAR framework?","How long should each part of a STAR answer take?","What does Google's behavioural round evaluate?","What does Meta's behavioural round evaluate?"]$parts$,
  $md$### 1. What is the STAR framework?

A four-part shape for answering any "tell me about a time" question. **Situation** sets the scene. The project, what was at stake, what made it hard. **Task** is your specific responsibility, not the team's. **Action** is what you actually did, step by step, including the trade-offs you weighed; this is the bulk of it. **Result** is the outcome, quantified, plus what you learned or would do differently.

The structure exists because unstructured answers drift into context and never reach the point. It also gives the interviewer somewhere to probe, which is what they are there to do.

### 2. How long should each part of a STAR answer take?

Roughly: situation 20 seconds, task 10, action 90, result 30. Two to three minutes in total. The proportions carry the message. Most weak answers invert them, spending a minute on background and ten seconds on what the candidate personally did, which is the only part being assessed.

### 3. What does Google's behavioural round evaluate?

Googleyness and Leadership: collaboration, comfort with ambiguity, integrity, ownership and impact. The whole loop scores four attributes. General cognitive ability, role-related knowledge, leadership, and Googleyness. The tone is conversational and they probe how you think, so the differentiator is being humble and self-aware and defaulting to collaboration. Taking all the credit, blaming others, or failing to own a mistake is the red flag.

### 4. What does Meta's behavioural round evaluate?

The six core values: Move Fast, Focus on Long-Term Impact, Build Awesome Things, Live in the Future, Be Direct and Respect Your Colleagues, and Meta Metamates Me. Map each story to one. The tone is direct and outcome-focused, so lead with what changed and then explain how you got there. The red flag is a vague outcome. Process narrated with no measurable result.
$md$,
  ARRAY['behavioural', 'star', 'google', 'meta', 'interviewing']
),

-- ── Behavioural — Part 2 ──────────────────────────────────────────────────
(
  'The Competencies You Will Be Asked About',
  'medium',
  $parts$["Tell me about a time you took ownership of something outside your role.","Tell me about a technical decision you made with incomplete information.","Tell me about a time you failed.","Tell me about a disagreement with a teammate or manager.","Tell me about a time you made the people around you more effective."]$parts$,
  $md$These are the questions themselves. The answers are yours and cannot be supplied. What follows is what each one is probing and what a strong response has to contain, so you can check your own story against it.

### 1. Ownership / taking initiative

Probing whether you extend past your assigned scope without being asked. A strong answer names something you picked up that was not your job, why you judged it worth doing, and what you decided autonomously. Including the trade-offs, since "I did extra work" alone reads as busyness rather than judgment.

### 2. Technical trade-off under ambiguity

Probing how you decide without complete information. Needs the options you weighed, the unknowns that made it hard, and, the part usually missing, *when you stopped researching and committed*. Interviewers are looking for someone who converges, not someone who investigates indefinitely.

### 3. Failure

Probing self-awareness and whether you actually changed. It has to be a real failure: a spun non-failure ("I worked too hard") is transparent and costs more than the honest version. Say what went wrong, whether the cause was technical, process or judgment, how you course-corrected, and concretely what you do differently now. A vague lesson is worse than no story.

### 4. Disagreement / pushback

Probing whether you can hold a position without damaging the relationship. Needs the other side stated fairly, how you raised it and on what evidence, and how it resolved. Including whether you escalated or disagreed and committed. Being right is not the signal; handling it well is.

### 5. Collaboration / impact on the team

Probing whether you make others more effective, which is what separates a good new grad from a great one. Needs someone specific who was stuck or missing context, what you did, pairing, reviewing, documenting, restructuring, and the outcome for them, not just for the project.

### Two rules that apply to all five

**Always have a number.** "Improved performance" loses to "cut p99 from 800ms to 120ms". Approximate is fine; absent is weak.

**Use "I" for actions and "we" only for outcomes.** "We decided" surrenders the attribution the question exists to establish.
$md$,
  ARRAY['behavioural', 'competencies', 'ownership', 'failure', 'collaboration']
),

-- ── Behavioural — Part 3 ──────────────────────────────────────────────────
(
  'Delivering an Answer That Lands',
  'hard',
  $parts$["Why must every result have a number?","Why use I for actions and we only for outcomes?","What makes a failure story land instead of backfiring?","What follow-ups should you expect, and how do you prepare for them?","What should you ask the interviewer at the end?"]$parts$,
  $md$### 1. Why must every result have a number?

Because without one the interviewer has no way to distinguish a real outcome from a confident description of effort. "Improved performance" is unfalsifiable; "cut p99 latency from 800ms to 120ms" is a claim with a shape, and it implies you measured before and after, which is itself the signal. Approximate figures are fine. Pages, users, latency, uptime, hours saved, percentage improvement: force one into every story.

### 2. Why use "I" for actions and "we" only for outcomes?

The round exists to establish what *you* did. "We decided to shard the database" leaves the interviewer unable to tell whether you led it, argued against it, or watched. Use "we" for the shared result, which is honest and avoids sounding like you claim the team's work. The failure mode in the other direction, and a red flag at Google specifically.

### 3. What makes a failure story land instead of backfiring?

Choosing something that genuinely failed, and showing the change. Interviewers hear spun non-failures constantly and read them as an unwillingness to be honest, which is worse than the failure would have been. The story lands when the cause is named plainly, including if it was your judgment, and ends with something concrete that changed in how you work. A vague lesson ("I learned to communicate better") is the most common way to waste a good story.

### 4. What follow-ups should you expect, and how do you prepare for them?

Assume every section gets probed: "Why that approach?", "What would you do differently?", "What did others think?", "What was the hardest part?" This is why over-rehearsing hurts. A scripted answer collapses the moment it is pushed off its rails. Know the skeleton cold and improvise the wording, and make sure your preparation includes the depth behind each step, not just the narrative.

### 5. What should you ask the interviewer at the end?

Have two or three ready; asking nothing reads as low interest. Good ones surface real information: what separates a good new grad from a great one on this team, the hardest problem the team is working on now, how the team resolves technical disagreements, what surprised them after joining. Skip anything you could have googled, perks, levels, the process, because it spends your remaining signal on something you could have looked up.
$md$,
  ARRAY['behavioural', 'delivery', 'star', 'follow-ups', 'interviewing']
)
ON CONFLICT (title) DO UPDATE SET
  difficulty   = EXCLUDED.difficulty,
  parts        = EXCLUDED.parts,
  reference_md = EXCLUDED.reference_md,
  tags         = EXCLUDED.tags;
