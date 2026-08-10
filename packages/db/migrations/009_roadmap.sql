-- The roadmap, and one lesson per question set.
--
-- Replaces the per-topic lessons table added by the first version of this
-- migration. A lesson belonged to a whole topic there, which meant Operating
-- Systems was a single 33KB page covering all three of its question sets and
-- headed "Day 1", "Day 2", "Day 3". Splitting it means each question set has
-- exactly the material that prepares you for it, and the day numbering
-- disappears on its own: the reading order is now the step column below.
--
-- The topics table also carries what the roadmap draws. `depends_on` is the
-- edges and `grid_x`/`grid_y` the positions, both seeded rather than computed
-- in the browser, because they are content decisions about what to read first
-- and not layout the frontend should be inventing.

DROP TABLE IF EXISTS questions.lessons;

CREATE TABLE IF NOT EXISTS questions.topics (
  topic      text PRIMARY KEY,
  title      text NOT NULL,
  summary    text NOT NULL,
  -- Topics that make this one easier to read, drawn as an arrow pointing down
  -- into it. Not enforced: nothing stops anyone reading in any order.
  depends_on text[] NOT NULL DEFAULT '{}',
  grid_x     int NOT NULL,
  grid_y     int NOT NULL
);

ALTER TABLE questions.bank
  ADD COLUMN IF NOT EXISTS lesson_md text,
  -- 1, 2 or 3: where this set sits in its topic's reading order. The bank also
  -- has `difficulty`, which matching pairs people on, and the two agree by
  -- construction (easy is step 1). They are separate columns because they
  -- answer different questions: one is "what do I read next", the other is
  -- "who can I be matched with".
  ADD COLUMN IF NOT EXISTS step int;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('os', 'Operating Systems', 'How a computer runs more than one program at once, and what it costs. Start here: almost everything else on this map assumes you know what a process, a thread and memory actually are.', ARRAY[]::text[], 1, 0)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('oop', 'Object-Oriented Programming', 'How to organise code so it stays possible to change. This is the one topic here that is about the code you write rather than the machine underneath it.', ARRAY[]::text[], 3, 0)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('ai-tooling', 'AI Tooling', 'What the tools you already use are actually doing, and how to talk about using them well. Needs nothing else first, so it is a good one to pick up on a tired evening.', ARRAY[]::text[], 6, 0)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('networking', 'Networking', 'What happens between typing a web address and seeing a page. Reads much more easily once you know what a process and a socket are, which is why it sits under Operating Systems.', ARRAY['os']::text[], 0, 1)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('databases', 'Databases', 'How data is stored so it can be found again quickly and survives a crash. Indexes and transactions make far more sense after the memory and disk material in Operating Systems.', ARRAY['os']::text[], 2, 1)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('debugging', 'Debugging', 'A method for finding out why something is broken, instead of guessing. Short, practical, and the one topic that pays off the same day you read it.', ARRAY['os', 'oop']::text[], 4, 1)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('behavioural', 'Behavioural', 'How to tell a story about your own work so an interviewer can follow it. No technical prerequisites at all, and it is worth starting early because good answers come from remembering, not from cramming.', ARRAY[]::text[], 6, 1)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('security', 'Security', 'How accounts, passwords and connections are kept safe, and the handful of attacks worth being able to explain. Most of it is networking and databases seen from the attacker’s side.', ARRAY['networking', 'databases']::text[], 1, 2)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('system-design', 'System Design', 'Putting the pieces together into something that serves a lot of people at once. Last on purpose: it is mostly the earlier topics applied at scale, and it is hard to reason about without them.', ARRAY['networking', 'databases', 'oop']::text[], 3, 2)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

UPDATE questions.bank SET lesson_md = $body$## What Is a Process?

### The core problem
One CPU, many programs (Chrome, Spotify, Slack...). The OS creates the **illusion** of multiple CPUs via **time sharing**: run one process briefly, pause it, run another, switch fast enough to feel simultaneous. This is **CPU virtualization**.

### What a process is
A **process is a program in execution**. The OS's abstraction for a running program. The program on disk is just bytes; loading it into memory and running it on the CPU makes it a process.

### What a process is made of (machine state)
**1. Address space (memory)**
- **Code**: compiled instructions
- **Stack**: locals, params, return addresses. Grows down. Auto-managed per call/return.
- **Heap**: dynamic memory (`malloc`/`new`). Grows up. Managed manually.
- **Static/global data**: globals and initialized statics

**2. CPU registers**
- **Program Counter (PC)**: address of the next instruction
- **Stack pointer**: top of the stack
- **General-purpose registers**: intermediate values

**3. Open file descriptors**: files/sockets/pipes the process has open. Every UNIX process starts with stdin (0), stdout (1), stderr (2).

This list is exactly what the OS saves on a **context switch** so it can resume the process where it left off.

### How the OS creates a process
1. Load code and static data from disk (lazily, only what's needed).
2. Allocate a stack, set up `argc`/`argv`.
3. Allocate an initial heap (grows on demand via `malloc`).
4. Open stdin/stdout/stderr.
5. Jump to `main()`.

### Process states
A process is always in exactly one state:
```
RUNNING <-> READY     scheduled / descheduled
RUNNING  -> BLOCKED   issues I/O
BLOCKED  -> READY     I/O completes
```
- **Running**: on the CPU now
- **Ready**: could run; scheduler picked someone else
- **Blocked**: waiting on hardware (disk, network, timer); *cannot* run even if the CPU is free. On completion → Ready (not Running).
- **Zombie**: exited, but parent hasn't called `wait()`. The process-table entry lingers so the parent can read the exit code; `wait()` cleans it up.

**Key distinction:** blocked *cannot* run (waiting on hardware); ready *could* run (just not picked yet).

### Process Control Block (PCB)
The OS's per-process record (a.k.a. process descriptor): state, PID, saved register context, open files, memory limits, parent. All PCBs live in the **process list**. On pause, registers are saved into the PCB; on resume, restored from it.

> **Interview phrasing:** *"A context switch serializes CPU state into the outgoing process's PCB and deserializes the incoming one's."*

---

## Process API: fork, exec, wait

### fork()
Creates a near-exact copy of the calling process.
- Caller = **parent**, new process = **child**. Both continue from the line after `fork()`, it returns **twice**.
- Parent gets the child's **PID**; child gets **0**.
- The child gets its own address space via **copy-on-write**: pages are shared read-only and copied only when one side writes. Makes fork cheap.

```c
int pid = fork();
if (pid < 0)       { /* fork failed */ }
else if (pid == 0) { /* child */ }
else               { /* parent, pid = child PID */ }
```

**Ordering is non-deterministic**: parent or child may run first. Never assume order without `wait()`.

### wait()
Blocks the parent until a child finishes.
```c
if (fork() == 0) { /* child work */ exit(0); }
else             { wait(NULL); /* child done */ }
```
Without `wait()`, an exited child is a **zombie** until the parent collects its status. If the parent exits first, the child is an **orphan**, re-parented to `init` (PID 1), which reaps it.

### exec()
**Replaces** the current process's program. It does not create a new process.
```c
execvp("ls", args);
printf("never runs if exec succeeds\n");
```
On success `exec()` never returns: code/stack/heap are replaced, but the **PID stays** and **open FDs are kept** (key for I/O redirection).

### Why fork + exec (two calls)?
The gap lets the shell set things up before the new program runs:

**I/O redirection** (`ls > out.txt`):
```c
if (fork() == 0) {
    close(STDOUT_FILENO);
    open("out.txt", O_CREAT|O_WRONLY); // takes fd 1 (lowest free)
    execvp("ls", args);                // ls's stdout is now the file
}
```
**Pipes** (`ls | grep foo`): `pipe()` makes a connected fd pair; the shell forks twice and wires write-end → read-end before either child execs.

> **"What happens when you type `ls`?"** The shell `fork()`s; the child optionally sets up redirection, then `exec("ls")`; the parent `wait()`s until `ls` exits, then prints a new prompt.

---

## Limited Direct Execution: Syscalls & Context Switching

### The tension
Programs should run directly on the CPU (fast), but can't be trusted to do anything (read others' memory, hog the CPU). Solution: **Limited Direct Execution (LDE)**. Run directly, but with hardware-enforced limits.

### User mode vs. kernel mode
| | User mode | Kernel mode |
|---|---|---|
| Runs | User processes | OS kernel |
| Privileges | No direct I/O, restricted memory | Everything: I/O, memory, switching |

A privileged op in user mode traps to the OS. To do anything privileged, a process must make a **system call**.

### How a syscall works (trap)
1. Process puts the **syscall number** in a register and executes the `trap`/`syscall` instruction.
2. Hardware saves registers to the **kernel stack**, switches to kernel mode, jumps to the **trap handler**.
3. OS looks up the number in the **trap table** (set at boot) and runs the handler.
4. OS executes `return-from-trap`: hardware restores registers, switches back to user mode, resumes after the trap.

**Why a number, not an address?** Security. If a process could name a kernel address to jump to, it could skip permission checks. The kernel owns the trap table; the process can only request a service by number.

### How the OS regains the CPU
**Timer interrupt.** At boot the OS programs a hardware timer to fire every few ms. On fire, hardware saves state, switches to kernel mode, and runs the OS handler. Now the OS decides whether to keep running this process or switch. Without it, an infinite loop would own the CPU forever.

### Context switch
1. Save A's registers into A's PCB.
2. Restore B's registers from B's PCB.
3. Switch to B's kernel stack.
4. `return-from-trap` → CPU runs B.

Two save/restore events occur: **hardware** saves user registers to the kernel stack on the trap/interrupt; **OS software** saves kernel registers to the PCB when switching processes.

**Why expensive?**
- Saving/restoring registers takes time.
- **Cache thrash**: L1/L2/L3 were warm for A; B starts cold and misses.
- **TLB flush**: the virtual→physical mapping cache is invalidated, so B pays page-table lookups until it warms up.

This is why too many threads hurts: with 10,000 threads the OS spends more time switching than working.

---

## Threads

### What is a thread?
An independent execution path inside a process. Each thread has its **own registers and stack**, but all threads **share the address space** (code, heap, globals).

**Private per thread:** PC, registers, stack.
**Shared across threads:** code, heap, globals, open FDs.

### Thread vs. process
| | Process | Thread |
|---|---|---|
| Address space | Separate (isolated) | Shared within process |
| Creation cost | High (new address space, copy page tables) | Low (new stack + TCB) |
| Communication | Hard (IPC: pipes, sockets, shared mem) | Easy (shared variables) |
| Crash isolation | One crash doesn't affect others | One thread can kill the whole process |
| Context switch | Costlier (TLB flush, new page tables) | Cheaper (same address space) |

> **"Why are threads cheaper?"** They share the address space. No copying page tables/heap, no TLB flush on switch. Creating one is just a new stack + Thread Control Block. Communication is a plain memory read/write instead of IPC.

### Why use threads
1. **Parallelism**. Different threads run on different cores at once.
2. **Overlap I/O with compute**. While one thread waits on a DB query, another keeps working. The web-server model: a thread per request (or a pool) so one slow query doesn't block all.

*(Node skips threads for concurrency and uses async I/O instead, Day 3.)*

### The race condition problem
Two threads run `counter = counter + 1`, which is three machine instructions:
```
LOAD  counter → reg
ADD   1 → reg
STORE reg → counter
```
A switch mid-sequence loses an update:
```
T1: LOAD counter(50)→R1; ADD→R1(51)
  -- switch --
T2: LOAD counter(50)→R2; ADD→R2(51); STORE→counter(51)
  -- switch --
T1: STORE R1→counter(51)   // T2's update lost; should be 52
```
The result depends on scheduling timing. A **race condition**: non-deterministic, hard to debug. The shared-data region that must not run concurrently is the **critical section**; the guarantee you want is **mutual exclusion** (locks, Day 2).

### Thread Control Block (TCB)
Per-thread analog of the PCB: saved register state when the thread isn't running. Switching between threads in one process saves/restores TCBs and skips the address-space change, so it's faster.

---

## pthreads API

### Create and join
```c
void *worker(void *arg) {
    int *n = (int *)arg;
    return NULL;
}
int main() {
    pthread_t t; int v = 42;
    pthread_create(&t, NULL, worker, &v); // run worker(&v)
    pthread_join(t, NULL);                // block until it exits
}
```
`pthread_join` is `wait()` for threads. **Gotcha:** never return a pointer to a stack variable from a thread. Its stack is gone on exit (dangling pointer).

### Mutex
```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_lock(&lock);
counter++;                 // critical section: one thread at a time
pthread_mutex_unlock(&lock);
```
A thread calling `lock()` while it's held **blocks** until `unlock()`.

### Condition variable
Use when a thread must wait for a condition (not just a free lock).
```c
// waiter
pthread_mutex_lock(&lock);
while (queue_empty())
    pthread_cond_wait(&cond, &lock); // atomically release lock + sleep
// ... do work ...
pthread_mutex_unlock(&lock);

// producer
pthread_mutex_lock(&lock);
enqueue(item);
pthread_cond_signal(&cond);          // wake one waiter
pthread_mutex_unlock(&lock);
```
`cond_wait` atomically releases the lock and sleeps; on wake it re-acquires the lock. Always re-check with `while` (not `if`). The item may be gone, plus **spurious wakeups**.

---$body$, step = 1
  WHERE title = 'Processes & Threads';

UPDATE questions.bank SET lesson_md = $body$## The Problem We're Solving

Threads share the heap and globals, and `counter++` is three machine instructions. So a mid-sequence switch loses updates (a **race condition**). **Synchronization** is the set of tools that coordinate access to shared state. Day 2 covers those tools and the bugs from misusing them.

---

## Locks / Mutexes

### What a lock is
A lock (**mutex** = mutual exclusion) has two states: **free** and **held**. Only one thread holds it at a time; others that try to acquire it **block** until release. The protected region is the **critical section**; the guarantee is **mutual exclusion**.

```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_lock(&lock);
counter++;                 // critical section
pthread_mutex_unlock(&lock);
```

### Why a naive flag doesn't work
```c
// BROKEN
while (flag == 1) ;  // test
flag = 1;            // set
```
Test and set are separate instructions, so two threads can both see `0` and both enter. The check-and-set must be **atomic**.

### Test-and-set
CPUs provide an atomic instruction (`xchg` on x86) that reads and writes a location in one uninterruptible step:
```c
int TestAndSet(int *ptr, int new) {  // ONE atomic instruction
    int old = *ptr; *ptr = new; return old;
}
```
This builds a correct **spin lock**:
```c
void lock(lock_t *l)   { while (TestAndSet(&l->flag, 1) == 1) ; } // spin while held
void unlock(lock_t *l) { l->flag = 0; }
```
Free (flag=0): TestAndSet sets flag=1 and returns 0 in one atomic step → exit loop, acquired. Held (flag=1): returns 1, keep spinning.

**Compare-and-swap (CAS)** is the more powerful cousin: write only if the current value equals an expected value. It's the basis of lock-free data structures.

### Spin locks: correctness vs. performance
A spin lock is correct but **burns CPU while waiting**. Worst on a single CPU: if the holder is preempted (paused by the scheduler), the spinner wastes a full timeslice before the holder can run to release.

**Better. Yield:** give up the CPU on failure.
```c
while (TestAndSet(&l->flag, 1) == 1) yield();
```
Still pays a context switch per failed attempt. **Real locks** (`pthread_mutex`) go further: they **sleep** the waiter (off the run queue) and wake it on release, no wasted CPU.

### Coarse vs. fine-grained locking
- **Coarse:** one lock for everything. Simple/safe but serializes all threads.
- **Fine:** separate locks per structure (e.g., per hash bucket). More parallelism, more deadlock risk.

> **Interview tip:** for "make this thread-safe," discuss the trade-off. One global lock is easy but a bottleneck; fine-grained is faster but needs care.

### Reader-writer locks
Reads don't conflict with each other, only writes need exclusion. A **rwlock** (`pthread_rwlock_t`) admits many concurrent readers *or* one exclusive writer. Classic for read-heavy data (caches, config). Gotcha: **writer starvation**. A steady stream of readers can keep a writer waiting indefinitely.

---

## Condition Variables

### The problem
A lock answers "can I have exclusive access?" A **condition variable (CV)** answers "should I proceed, or wait for an event?" Example: worker threads sleep when there's no work; a dispatcher wakes them when work arrives. Spin-checking a queue wastes CPU. You need threads to sleep until woken.

A CV is a queue of sleeping threads with three ops:
- `wait()`: atomically release the lock and sleep
- `signal()`: wake one waiter
- `broadcast()`: wake all waiters

### The three-part rule
Always use a CV with: (1) a **mutex**, (2) the **CV**, (3) a **state variable** (the actual condition).
```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t  cond = PTHREAD_COND_INITIALIZER;
int ready = 0;   // state variable

// waiter
pthread_mutex_lock(&lock);
while (ready == 0)                    // WHILE, not if
    pthread_cond_wait(&cond, &lock);  // release lock + sleep
pthread_mutex_unlock(&lock);

// signaler
pthread_mutex_lock(&lock);
ready = 1;                            // update state FIRST
pthread_cond_signal(&cond);          // then wake
pthread_mutex_unlock(&lock);
```

### Why each piece
- **Mutex:** without it, the signaler can set `ready` and signal in the gap between the waiter's check and its `wait()`. The signal is lost and the waiter sleeps forever. `cond_wait` releases the lock and sleeps atomically, closing that gap.
- **State variable:** records that the event happened, so a late waiter checks it and skips sleeping.
- **`while` not `if`:** after waking, the condition may no longer hold (another thread consumed the resource, or a spurious wakeup). Re-check.

### Producer-Consumer (bounded buffer)
The key concurrency pattern. Producers add items, consumers remove them; producers wait when full, consumers wait when empty. **Use two CVs:**
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
**Why two CVs?** With one, a waking consumer might wake another consumer (not a producer); it finds the buffer empty and sleeps again, the producer is never woken → all sleep forever. Separate CVs ensure producers wake consumers and vice versa.

---

## Semaphores

### What it is
An integer counter with two atomic ops:
```
sem_wait:  s--; if s < 0: sleep
sem_post:  s++; if any waiting: wake one
```
Set the **initial value** to the number of resources you'll hand out immediately.

### Binary semaphore = mutex (init 1)
```c
sem_init(&m, 0, 1);
sem_wait(&m);   // s:1→0, proceed
// critical section
sem_post(&m);   // s:0→1, wake a waiter
```
A: wait 1→0, proceeds. B: wait 0→-1, sleeps. A: post -1→0, wakes B.

### Ordering (init 0)
Make one thread wait for another:
```c
sem_init(&done, 0, 0);
// child:  do_work(); sem_post(&done);   // 0→1
// parent: sem_wait(&done);              // if 0 block; if 1 proceed
```
Works regardless of order: if the child finishes first, post leaves s=1 and the parent doesn't block.

### Counting (init N)
Allow up to N through at once. Thread pools, connection limits:
```c
sem_init(&slots, 0, 5);   // max 5 concurrent
sem_wait(&slots); handle(); sem_post(&slots);
```

### Producer-consumer with semaphores
```c
sem_init(&empty, 0, MAX);  // empty slots
sem_init(&full,  0, 0);    // full slots
sem_init(&mutex, 0, 1);

// producer
sem_wait(&empty); sem_wait(&mutex);
put(item);
sem_post(&mutex); sem_post(&full);

// consumer
sem_wait(&full); sem_wait(&mutex);
item = get();
sem_post(&mutex); sem_post(&empty);
```
**Critical ordering:** wait on `empty`/`full` **before** `mutex`. Reverse it and you deadlock. A producer holding `mutex` sleeps waiting for space while the consumer can't get `mutex` to free any.

### Mutex vs. semaphore
| | Mutex | Semaphore |
|---|---|---|
| Owner | Yes, only the locker unlocks | No, any thread can post |
| Count | Binary (0/1) | Integer (0..N) |
| Use | Mutual exclusion | Exclusion + ordering + counting |

> **Interview phrasing:** *"A mutex has ownership, the locker must unlock. A semaphore is an ownerless counter; any thread can post. A binary semaphore acts like a mutex, but semaphores also do signaling and resource counting."*

---

## Deadlock

### What it is
Two+ threads each wait on a resource the other holds, stuck forever.
```
T1: lock(L1); lock(L2);   // holds L1, wants L2
T2: lock(L2); lock(L1);   // holds L2, wants L1
```

### Four conditions (Coffman), all must hold
1. **Mutual exclusion**, resources held exclusively. (Hard to remove, it's the point of locks.)
2. **Hold and wait**. Hold one resource while waiting for another.
3. **No preemption**. Can't forcibly take a lock away.
4. **Circular wait**, a cycle of waiting threads. (Most commonly attacked.)

Remove any one and deadlock is impossible.

### Prevention (attack one condition)
**Break circular wait. Lock ordering (most practical).** Always acquire locks in a global order; the cycle can't form.
```c
pthread_mutex_lock(&L1); pthread_mutex_lock(&L2);  // always L1 before L2
```
When you don't control order (locks passed in), order by address:
```c
if (m1 < m2) { lock(m1); lock(m2); } else { lock(m2); lock(m1); }
```
**Break hold-and-wait. Acquire all at once** under a global allocation lock (downside: serializes acquisition, less concurrency).

**Break no-preemption. Trylock + backoff.** `trylock` fails instead of blocking; if you can't get both, release and retry:
```c
retry:
  lock(L1);
  if (trylock(L2) != 0) { unlock(L1); goto retry; }
```
Risk: **livelock** (both retry in lockstep). Add a random delay to break symmetry.

### Deadlock vs. livelock vs. starvation
| | |
|---|---|
| **Deadlock** | Blocked forever, waiting on each other |
| **Livelock** | Running but no progress (retry and re-conflict) |
| **Starvation** | Never scheduled. Others always win the resource |

---

## Race Conditions in Real Code

### Atomicity violation
A sequence you assumed was atomic wasn't.
```c
// T1
if (thd->proc_info)
    fputs(thd->proc_info, ...);  // T2 may null it in between → crash
// T2
thd->proc_info = NULL;
```
Fix: lock the check **and** the use together.

### Order violation
You assumed A runs before B, but it's not guaranteed.
```c
// T1: mThread = create_thread(...);
// T2: mState = mThread->State;   // NULL deref if T2 runs first
```
Fix: use a condition variable so T2 waits until T1 signals init is done.

---$body$, step = 2
  WHERE title = 'Synchronization & Concurrency';

UPDATE questions.bank SET lesson_md = $body$## The Big Picture

Day 3 links memory internals (virtual memory, paging, allocation) to I/O models (blocking, non-blocking, async) and the **event loop**. How Node.js serves 10,000 connections on one thread. Heavy in backend system-design interviews.

---

## Virtual Memory & Address Spaces

### Why it exists
Many processes need memory at once. If they shared physical addresses, Process A writing `0x5000` would clobber Process B. And a bug could corrupt the OS. **Virtual memory** gives each process the illusion of its own private, contiguous space starting at 0. The OS + hardware map virtual addresses to physical RAM; processes can't see each other's memory.

Three goals:
- **Isolation**: a rogue process can't corrupt others or the OS.
- **Transparency**: a process just sees its own space.
- **Efficiency**: physical memory can be shared, overcommitted, and swapped.

> **Interview fact:** every pointer you print in C is a *virtual* address; the CPU/OS translate it to physical before touching RAM.

### Address space layout
```
high │ Stack   ↓ grows down  (locals, args, return addrs)
     │ (free)
     │ Heap    ↑ grows up     (malloc/new)
     │ Static/global data
low  │ Code    (read-only instructions)
```
- **Stack:** auto-managed. Each call pushes a **frame** (locals, params, return address); return pops it. Grows down. Overflow = stack collides with heap. One stack per thread.
- **Heap:** manual in C/C++ (`malloc`/`free`), GC-managed in Java/Go/Python. Grows up. Holds dynamic structures (lists, maps, trees).
- **Code:** read-only instructions, fixed size.
- **Static/global:** globals, string literals, initialized statics.

> **"Stack vs heap?"** Stack: locals, params, return addresses; auto allocated/freed per call; fast but small (~8MB). Heap: dynamic memory you (or the GC) manage; large but slower, and you must free it. Leaks if you don't, corruption on double-free.

---

## Paging

### Why
Giving each process one contiguous physical chunk causes:
1. **External fragmentation**. Many small gaps that can't satisfy a request.
2. **Inflexibility**. Stack and heap grow toward each other; you can't size them up front.

### Paging
Divide both virtual and physical memory into fixed-size chunks:
- **Virtual pages** (typically 4KB) and **page frames** (same size in physical RAM).
- Any page maps to any frame, they need not be contiguous. The OS keeps a **page table** per process recording the mappings.

### Address translation
Split a virtual address into a **VPN** (virtual page number, top bits) and **offset** (bottom bits). With 4KB pages, offset = bottom 12 bits (2^12 = 4096).
1. Split the virtual address into VPN + offset.
2. Look up VPN in the **page table** → **PFN** (physical frame number).
3. Physical address = PFN with the same offset appended (frame base + offset).

Each **page table entry (PTE)** holds the PFN plus bits:
- **Valid**: is this page mapped? Access an invalid page → segfault.
- **Present**: in RAM or on disk? On disk → page fault.
- **Dirty**: written since loaded?
- **Protection**: read/write/execute.

### TLB
Without caching, every memory access needs two: read the PTE, then the data. The **TLB (Translation Lookaside Buffer)** is a small, fast on-CPU cache of recent translations.
```
VPN in TLB?  hit  → get PFN directly (fast)
             miss → walk page table in RAM, fill TLB, retry (slow)
```
TLBs hold ~64-1024 entries with ~99% hit rates. **Context-switch cost (TLB angle):** switching to Process B invalidates A's TLB entries, so the TLB is flushed and B starts cold with many misses.

### Page fault
Raised when a process accesses a page whose PTE **present bit = 0** (not in RAM). Causes:
1. **Swapped to disk**, OS evicted it; load it back.
2. **Never mapped**. Invalid access → segfault, process killed.

On a swapped-page fault:
1. Hardware traps to the OS page-fault handler.
2. OS finds the page on disk, picks a free frame (evicting one if needed).
3. OS reads the page in (slow disk I/O), sets present=1 and the PFN.
4. OS resumes the process; the faulting instruction retries and succeeds.

This is **demand paging**, load pages only when accessed, and why programs can exceed physical RAM. Push it too far and you get **thrashing**: working sets (the pages processes actively use) don't fit in RAM, so the machine constantly page-faults and spends more time swapping than working.

> **Interview phrasing:** *"A page fault is accessing a virtual address not currently in RAM. The hardware traps to the OS, which loads the page from disk, updates the page table, and resumes. It's expensive because of disk I/O. Millions of times slower than RAM."*

### Fragmentation
- **External:** free memory split into non-contiguous pieces; a large request fails despite enough total free. **Paging eliminates this**, any page fits any frame.
- **Internal:** you allocate a whole 4KB page but use 100 bytes; the rest is wasted inside. Paging introduces this (page granularity).

---

## Heap Memory: malloc Internals

### What malloc does
`malloc` doesn't syscall every time (too slow). Instead:
1. At startup, grab a big chunk from the OS (`sbrk()`/`mmap()`).
2. Manage it with a **free list** tracking available regions.
3. `malloc(n)`: find a fit, split it, return a pointer.
4. `free(ptr)`: mark free and **coalesce** adjacent free chunks.

**Header trick:** `free(ptr)` knows the size because the allocator stores a **header** (size, etc.) just before the returned pointer; `free` reads `ptr - sizeof(header)`.

### Allocation strategies
- **First fit:** first chunk that fits. Fast; fragments the list head over time.
- **Best fit:** smallest chunk that fits. Less waste; must scan the whole list (slow).
- **Next fit:** first fit but resume from the last position; spreads allocations.

Best fit often leaves many tiny unusable fragments; first fit is frequently faster. Real allocators (glibc `ptmalloc`, jemalloc, tcmalloc) use **size-class segregation** (separate free lists per size) to be both fast and low-fragmentation.

### Coalescing
On `free`, merge adjacent free chunks into one. Without it the heap fills with tiny disconnected free chunks and large allocations start failing even when most of the heap is free.

---

## I/O Models

This explains Node.js, Nginx, and async. Very common in backend design interviews.

### What I/O is
Any communication outside CPU/RAM (disk, network, DB, file). It's **orders of magnitude slower** than compute:
| Operation | ~Latency |
|---|---|
| CPU register | <1 ns |
| L1 cache | ~1 ns |
| L3 cache | ~10 ns |
| RAM | ~100 ns |
| SSD random read | ~100 µs |
| Network RT (same datacenter) | ~500 µs |
| HDD seek | ~10 ms |

While waiting on I/O, a thread sits idle. Every I/O model addresses this.

### Blocking I/O
The call blocks (thread sleeps, uses no CPU) until the result arrives.
```c
int n = read(fd, buf, 1024);  // thread sleeps until data arrives
```
**Pro:** simple, sequential. **Con:** one thread per concurrent op. 10,000 concurrent requests = 10,000 threads, each ~1-8MB stack plus switch overhead, doesn't scale. (Apache's thread-per-request model.)

### Non-blocking I/O
The call returns immediately, with data or `EAGAIN` ("not ready").
```c
fcntl(fd, F_SETFL, O_NONBLOCK);
int n = read(fd, buf, 1024);
if (n == -1 && errno == EAGAIN) { /* try later */ }
```
**Pro:** thread doesn't block. **Con:** spin-checking wastes CPU. You need a smarter readiness mechanism.

### Async I/O / multiplexing
Tell the OS "watch these **fds** (file descriptors. Here, sockets); wake me when any is ready." The thread sleeps until notified.
- **`select()` / `poll()`**: older, simpler; pass the whole fd list each call and the kernel scans every fd (O(n)); `select` also caps at 1024 fds.
- **`epoll()`** (Linux) / **`kqueue()`** (BSD/macOS). Modern; register fds once in the kernel, then `epoll_wait()` blocks and returns **only the ready fds** (O(ready)). Scales to hundreds of thousands of fds.

Strictly, epoll reports **readiness**. Your thread still does the (non-blocking) `read()`. True **async I/O** (Linux `io_uring`, Windows IOCP) goes further: the kernel performs the operation itself and notifies on **completion**.

Pattern: register fds → `epoll_wait()` blocks → returns ready fds → process each → repeat. This is the **event loop**.

### The event loop (Node.js / Nginx)
One thread repeatedly asks "what's ready?" and handles it, never blocking on any single op.
```
while (true) {
    events = epoll_wait(watched_fds);   // block until something is ready
    for (e : events) handlers[e.fd](e); // run handler (must be fast!)
}
```
**How Node serves 10k connections on one thread:** a request registers a callback and returns; the thread handles others; when the I/O completes (epoll event), Node runs the callback. The thread is always working or waiting in `epoll_wait`.

**Critical requirement:** callbacks must be short and non-blocking. Heavy synchronous work (e.g., encrypting a big file) blocks the loop and stalls **all** requests. The classic "blocking the event loop" bug.

**Good for I/O-bound** (web servers): most time is waiting on DB/network; the OS does the waiting via epoll while the thread stays busy. **Bad for CPU-bound** (image/video/ML): no parallelism. You need multiple cores (Node uses worker threads; Go/Java suit CPU-bound backends).

### Thread pools, the middle ground
A fixed number of threads (often ~CPU cores) pull tasks off a queue.
**Pros:** bounded memory, thread reuse, can do blocking I/O per task. **Cons:** if all threads block (e.g., a slow DB), the pool starves, size it carefully.

| Workload | Best model |
|---|---|
| I/O-bound, many connections (web server, API gateway) | Event loop (Node, Nginx) |
| CPU-bound, parallel | Multiple threads/processes |
| Mixed | Thread pool + async I/O |
| Simple, low concurrency | Blocking, thread per request |

---

## Context Switching Cost (Full Picture)

### What happens (process A → B)
1. Timer interrupt → hardware saves A's registers to A's kernel stack.
2. OS saves A's kernel registers to A's PCB.
3. OS restores B's kernel registers from B's PCB.
4. OS switches to B's page table (loads CR3 on x86).
5. **TLB flush**. A's cached translations are invalid (some CPUs tag entries with an **ASID**, an address-space ID, to skip the flush).
6. OS restores B's CPU registers; B resumes.

### Why expensive
- **Register save/restore:** cheap (nanoseconds).
- **TLB flush:** B's first accesses miss and walk the page table; a warm TLB is 10-100× faster on memory-heavy code.
- **Cache invalidation:** caches were hot for A; B starts cold → many RAM fetches (~100× slower than L1).
- **Scheduler overhead:** ~1-10 µs direct per switch.

**Why too many threads kills throughput:** 10,000 threads → the OS mostly context-switches, thrashing TLB and caches; throughput collapses though the CPU looks "busy." Hence event loops and goroutines (Go's lightweight scheduler over a few OS threads).

---$body$, step = 3
  WHERE title = 'Memory & I/O';

UPDATE questions.bank SET lesson_md = $body$## The Relational Model

A relational database stores data in **tables** (relations) of rows and columns. Tables link through keys, and each fact is stored once.

### Keys

- **Primary key (PK):** uniquely identifies a row, never NULL. Usually an auto-increment int or UUID.
- **Foreign key (FK):** references a PK in another table, enforcing referential integrity (no order for a non-existent user).
- **Composite key:** a PK made of two or more columns (common in join tables).

```sql
CREATE TABLE orders (
    order_id INT PRIMARY KEY,
    user_id  INT REFERENCES users(user_id),  -- foreign key
    total    DECIMAL(10,2)
);
```

### Normalisation

Goal: store each fact exactly once, removing redundancy.

- **1NF:** atomic column values (no arrays/CSV in a cell); rows unique.
- **2NF:** every non-key column depends on the *whole* PK (no partial dependency). Only matters with a composite PK.
- **3NF:** no non-key column depends on another non-key column (no transitive dependency).

**3NF violation:** in `orders(order_id, customer_id, customer_city)`, `customer_city` depends on `customer_id`, not `order_id`. Move it to `customers`.

**Denormalise** for read-heavy workloads where joins are expensive (reporting, analytics, search). You trade write complexity for read speed.

---

## SQL Joins

A join combines rows from two tables on a related column.

- **INNER**: only rows matching in both tables.
  ```sql
  SELECT o.order_id, u.name FROM orders o JOIN users u ON o.user_id = u.user_id;
  ```
- **LEFT**: all left rows, matched right rows; unmatched right → NULL.
  ```sql
  SELECT u.name, o.order_id FROM users u LEFT JOIN orders o ON u.user_id = o.user_id;
  ```
- **Anti-join** (classic pattern), users with no orders:
  ```sql
  SELECT u.name FROM users u LEFT JOIN orders o ON u.user_id = o.user_id WHERE o.order_id IS NULL;
  ```
- **RIGHT**: mirror of LEFT; rarely used (swap tables and use LEFT).
- **FULL OUTER**: all rows from both sides, NULLs where no match.
- **Self-join**: a table joined to itself, e.g. employees and managers:
  ```sql
  SELECT e.name AS employee, m.name AS manager FROM employees e LEFT JOIN employees m ON e.manager_id = m.employee_id;
  ```

---

## Aggregations & Window Functions

### GROUP BY / HAVING

```sql
SELECT user_id, SUM(total) AS revenue FROM orders GROUP BY user_id HAVING SUM(total) > 1000;
```

**WHERE vs HAVING:** WHERE filters rows before grouping; HAVING filters groups after aggregation.

### Window functions

Compute a value across related rows **without collapsing them** (unlike GROUP BY).

```sql
SELECT name, department, salary,
    RANK()       OVER (PARTITION BY department ORDER BY salary DESC) AS rank_in_dept,
    ROW_NUMBER() OVER (ORDER BY salary DESC)                         AS overall_rank,
    salary - LAG(salary) OVER (ORDER BY hire_date)                  AS diff_from_prev
FROM employees;
```

- `PARTITION BY`: the group (like GROUP BY, but rows stay)
- `ORDER BY` inside `OVER`, ordering within the window
- `ROW_NUMBER()`: unique 1,2,3…
- `RANK()`: ties share a rank, then skips (1,2,2,4)
- `DENSE_RANK()`: ties share a rank, no skip (1,2,2,3)
- `LAG(col,n)` / `LEAD(col,n)`. Value n rows before / after the current row

**Second highest salary** (window vs subquery):
```sql
SELECT salary FROM (
    SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk FROM employees
) t WHERE rnk = 2;

SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary) FROM employees);
```

---

## How Indexes Work

An index is a separate sorted structure that trades write/storage cost for much faster reads. Without one, every query is a **full table scan** (O(n)).

### B-tree indexes (the default)

A balanced tree storing indexed values in sorted order; leaves point to the rows.

```
B-tree on users.age:
                [30]
              /      \
         [20]          [40]
        /    \        /    \
    [15,18] [25,27] [35,37] [45,50]
```

- **Point lookup** (`age = 25`). O(log n), follow the tree down.
- **Range** (`age BETWEEN 20 AND 40`). Find the start, then scan leaves in order.

### Clustered vs non-clustered

- **Clustered:** table rows are physically stored in index order. One per table (data has one physical order). Usually the PK (InnoDB, SQL Server).
- **Non-clustered:** a separate structure holding indexed values + a pointer to the row. Many per table. Lookup = find in index → follow pointer (two hops).

| | Clustered | Non-clustered |
|---|---|---|
| Data order | Rows stored in index order | Separate, pointer to row |
| Count per table | 1 | Many |
| Range scans | Faster (sequential) | Slower (pointer chasing) |
| Typical use | Primary key | FKs, filtered columns |

### Composite indexes & the leading-column rule

An index on `(last_name, first_name)` is sorted by `last_name`, then `first_name`. It's only usable if the query uses the **leftmost** column(s).

```sql
-- Index on (last_name, first_name, age)
WHERE last_name = 'Smith'                         -- ✅
WHERE last_name = 'Smith' AND first_name = 'Jo'   -- ✅
WHERE first_name = 'Jo'                           -- ❌ leading column skipped → full scan
WHERE last_name = 'Smith' AND age = 30            -- ✅ uses last_name prefix, then filters age
```

**Column order:** equality columns first, range columns last, high-selectivity (few rows match) columns first.

### Covering index

Contains every column a query needs, so the DB never touches the table row.
```sql
-- SELECT name, email FROM users WHERE age = 25  →  index on (age, name, email) covers it, no table lookup
```

### When the DB WON'T use an index

1. **Function on the column:** `WHERE UPPER(email) = …` hides the value. Fix: function-based index or store normalised.
2. **Low selectivity:** `WHERE is_active = true` when 95% match, a scan is cheaper.
3. **Leading column skipped** in a composite index.
4. **OR conditions** (sometimes).
5. **Very small tables**, the planner prefers a scan.
6. **Leading wildcard:** `LIKE '%smith'` can't use the index; `LIKE 'smith%'` can.

### EXPLAIN

Run `EXPLAIN` / `EXPLAIN ANALYZE` (Postgres) to see the plan:
- `Seq Scan`: full scan (bad on large tables)
- `Index Scan`: using an index ✅
- `Index Only Scan`: covering index, no table lookup ✅✅
- `rows` way off → stale stats, run `ANALYZE`

### Cost of over-indexing

Every insert/update/delete must update every index on the table, plus disk space. Add only indexes that are actually used.

---$body$, step = 1
  WHERE title = 'SQL Foundations & Indexing';

UPDATE questions.bank SET lesson_md = $body$## ACID Properties

A **transaction** is a sequence of operations that runs as one logical unit. All of it commits or all of it rolls back. ACID is the set of guarantees.

- **Atomicity**: all-or-nothing. If step 3 of 5 fails, steps 1-2 roll back. *Bank transfer: debit A, credit B; if the credit fails, the debit is undone.* Implemented via the **WAL (write-ahead log)**: changes are logged before data is modified, so a crash can replay or undo them.
- **Consistency**: every transaction moves the DB from one valid state to another, never violating constraints (FK, NOT NULL, unique, CHECK). *A `CHECK (balance >= 0)` blocks an overdraft.* Partly the application's responsibility. Often the *goal*, with the other three the *mechanisms*.
- **Isolation**: concurrent transactions behave as if serial; none sees another's intermediate state. *Two users booking the last seat: isolation stops both succeeding (-1 seats).* The hardest to achieve at scale. Tuned via **isolation levels** (below).
- **Durability**: once committed, data survives crashes. The WAL is flushed (fsync) to physical disk before the commit is acknowledged, so committed state is recoverable.

**Interview phrasing:** *"ACID = atomic (all-or-nothing), consistent (constraints never violated), isolated (concurrent txns don't interfere), durable (committed data survives crashes). The WAL is the key mechanism behind atomicity and durability."*

---

## Isolation Levels & Anomalies

Full isolation is expensive (transactions queue up), so DBs let you trade isolation for concurrency.

**Dirty read**: read another transaction's uncommitted write; if it rolls back, you read data that never existed.
```
T1: UPDATE users SET balance = 0 WHERE id = 1;  -- uncommitted
T2: SELECT balance ... id = 1;                   -- reads 0 (dirty)
T1: ROLLBACK;                                    -- the 0 never happened
```

**Non-repeatable read**: re-reading the same row in one transaction returns a different value because another committed an update in between.
```
T1: SELECT balance ... id = 1;                   -- 100
T2: UPDATE ... SET balance = 50 WHERE id = 1; COMMIT;
T1: SELECT balance ... id = 1;                   -- 50, changed
```

**Phantom read**: re-running a range query returns new rows because another transaction committed an INSERT in that range.
```
T1: SELECT * FROM orders WHERE amount > 1000;    -- 5 rows
T2: INSERT INTO orders (amount) VALUES (2000); COMMIT;
T1: SELECT * FROM orders WHERE amount > 1000;    -- 6 rows
```

**Lost update** (not in the standard table, but interviewers love it). Two transactions read the same value, each writes back a modified value, and the second write silently overwrites the first.
```
T1: SELECT balance ... id = 1;                   -- 100
T2: SELECT balance ... id = 1;                   -- 100
T1: UPDATE ... SET balance = 150; COMMIT;        -- +50
T2: UPDATE ... SET balance = 130; COMMIT;        -- +30, but T1's +50 is gone
```
Fix: atomic updates (`SET balance = balance + 50`), `SELECT … FOR UPDATE`, or an optimistic version check (Part 3).

| Level | Dirty | Non-repeatable | Phantom | Perf |
|---|---|---|---|---|
| Read Uncommitted | ✅ | ✅ | ✅ | Fastest |
| Read Committed | ❌ | ✅ | ✅ | Fast |
| Repeatable Read | ❌ | ❌ | ✅ (mostly) | Slower |
| Serializable | ❌ | ❌ | ❌ | Slowest |

(✅ = anomaly possible, ❌ = prevented)

- **Read Uncommitted:** sees uncommitted writes. Almost never used.
- **Read Committed:** sees only committed data; each statement gets a fresh snapshot. **Postgres/Oracle default.** Stops dirty reads only.
- **Repeatable Read:** one snapshot for the whole transaction. **MySQL InnoDB default.** Stops dirty + non-repeatable reads; InnoDB also stops phantoms via gap locks (locks on the gaps *between* index rows, blocking inserts into the range).
- **Serializable:** transactions appear to run one at a time; stops all anomalies via predicate locks (lock the query's *condition*, not just its rows) or SSI (serializable snapshot isolation. Detect conflicts at commit, abort one txn). Heaviest, use for ledgers, inventory.

---

## Locking

- **Shared (S):** many transactions can hold it on the same row, for reads.
- **Exclusive (X):** only one holder; blocks all other readers and writers, for writes.

| | Shared | Exclusive |
|---|---|---|
| With Shared? | ✅ | ❌ |
| With Exclusive? | ❌ | ❌ |

**Two-phase locking (2PL):** a *growing* phase acquires locks (never releases), then a *shrinking* phase releases them (never acquires). Guarantees serialisability.

**Pessimistic locking**: lock on read (`SELECT … FOR UPDATE`), hold until commit. Good for high contention.
```sql
BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;  -- locked
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

**Optimistic locking**: no lock on read; carry a version, check it on update; if it changed, retry. Good for low contention / long transactions.
```sql
SELECT balance, version FROM accounts WHERE id = 1;  -- version=5
UPDATE accounts SET balance = 0, version = 6
WHERE id = 1 AND version = 5;  -- 0 rows affected → conflict, retry
```

---

## MVCC (Multi-Version Concurrency Control)

How Postgres and most modern DBs let reads and writes run concurrently without blocking.

**Core idea:** keep **multiple versions** of each row. Readers see a consistent snapshot as of a point in time; writers create new versions instead of overwriting.

**In Postgres**, each row has hidden columns:
- `xmin`: transaction ID that created this version
- `xmax`: transaction ID that deleted/updated it (0 if still live)

A transaction sees a version when `xmin` committed before it started and `xmax` is 0 or committed after it started.
```
users.id=1 versions:
  xmin=100, xmax=150, balance=100  ← deleted by T150
  xmin=150, xmax=0,   balance=80   ← live
```
T200 (started after T150) sees 80; T120 (started before T150) still sees 100.

**Why it matters:** readers don't block writers and vice versa, so high read concurrency has no lock contention. **Tradeoff:** dead versions pile up; `VACUUM` reclaims them, or the table bloats.

**Interview phrasing:** *"MVCC keeps multiple row versions. Each transaction reads from a snapshot at its start time, seeing only versions committed before it. Readers and writers don't block each other because they touch different versions. The cost is storage from old versions, cleaned by VACUUM."*

---

## Storage Internals & Query Execution

**Storage:** data lives in fixed-size **pages** (8KB Postgres, 16KB MySQL InnoDB). The **heap file** is an unordered set of pages. The **buffer pool** caches hot pages in RAM. A cached read is orders of magnitude faster than disk, so buffer-pool size is a top performance lever.

**Sequential vs random:** sequential reads (a table scan) let the OS prefetch; random access (chasing index pointers to scattered rows) means many seeks. This is why a full scan can beat an index scan for low-selectivity queries.

**Query pipeline:**
1. **Parse**. SQL → parse tree (AST), syntax check.
2. **Analyse/bind**. Resolve table/column names against the schema.
3. **Plan/optimise**. Generate candidate plans (join order, index use), estimate cost, pick the cheapest.
4. **Execute**, run the plan, return rows.

The planner uses **statistics** (row counts, value distributions, stored in `pg_statistic`) to estimate cost; stale stats cause bad plans, fix with `ANALYZE`.

**Join algorithms:**
- **Nested loop**: for each row in A, scan B. O(n×m). Good for small or indexed inputs.
- **Hash join**: build a hash table on the smaller side, probe with the larger. O(n+m). Good for large unsorted inputs.
- **Merge join**: sort both on the join key, then merge. Good when inputs are already sorted (indexed).

---$body$, step = 2
  WHERE title = 'Transactions, Concurrency & Internals';

UPDATE questions.bank SET lesson_md = $body$## CAP Theorem

In a distributed system you can guarantee only **two** of:
- **C. Consistency:** every read sees the most recent write (or an error).
- **A. Availability:** every request gets a non-error response (maybe stale).
- **P. Partition tolerance:** the system keeps working when the network drops or delays messages between nodes.

**The catch:** partitions *will* happen, so P is mandatory. The real choice is what to sacrifice during a partition:
- **CP:** reject requests to avoid serving stale data. For financial systems, inventory.
- **AP:** keep serving (possibly stale) data. For feeds, DNS, shopping carts.

| System | Type | Why |
|---|---|---|
| HBase | CP | Errors rather than stale data |
| MongoDB (default) | CP | One primary takes writes; the minority side of a partition has none, rejects writes |
| Cassandra | AP | Serves during partition, eventual consistency |
| DynamoDB | AP (configurable) | Eventually consistent by default, strong optional |
| Postgres/MySQL | CA* | Single node, no partition concern |
| Zookeeper | CP | Leader election needs consistency |

*CA only makes sense single-node; any real distributed system must handle partitions.

### Eventual consistency

AP systems converge after a partition heals; during it, nodes may differ.
- **Replication lag:** replicas trail the primary by ~10-500ms; a read right after a write may be stale.
- **Read-your-own-writes:** you post, then read from a stale replica and don't see it. Fix: route reads-after-writes to the primary.
- **Last-write-wins (LWW):** Cassandra resolves conflicts by timestamp; clock skew can let an older write overwrite a newer one.

---

## Key-Value: Redis

In-memory key-value store, reads/writes in microseconds. Optional disk persistence (RDB point-in-time snapshots or an AOF append-only write log).

| Structure | Commands | Use case |
|---|---|---|
| String | GET, SET, INCR | Cache, counters, sessions |
| List | LPUSH, RPOP, LRANGE | Queues, activity feeds |
| Set | SADD, SINTER | Tags, unique visitors, dedupe |
| Sorted Set | ZADD, ZRANGEBYSCORE | Leaderboards, rate limiting, priority queues |
| Hash | HSET, HGETALL | Objects, user profiles |
| Bitmap | SETBIT, BITCOUNT | Feature flags, daily-active-user tracking |
| HyperLogLog | PFADD, PFCOUNT | Approximate unique counts at scale |

**TTL:** any key can expire. `SET session:abc data EX 3600`. Core to sessions and cache invalidation.

**Use for:** caching (most common), sessions, rate limiting (INCR + TTL), pub/sub, distributed locks (`SET key val NX EX 30`), leaderboards (sorted sets).

**vs a database:** RAM is expensive, durability is optional (AOF adds write cost), and there are no complex queries. Use Redis as a cache in front of Postgres/MySQL, not as the primary store.

---

## Document: MongoDB

Stores **documents** (JSON-like BSON); documents in a collection need not share a schema. Nest data (embed) instead of joining across tables.

**Embedding**: related data in one document.
```json
{ "_id": "user123", "name": "Will",
  "addresses": [ {"type": "home", "city": "Singapore"} ] }
```
✅ one read, atomic single-doc updates. ❌ document grows unboundedly if the array is large.

**Referencing**: separate collections linked by ID (like an FK).
```json
{ "_id": "user123", "name": "Will" }                       // users
{ "_id": "order456", "user_id": "user123", "total": 99 }   // orders
```
✅ no bloat, independent data. ❌ needs extra queries or `$lookup` (a join).

**Rule:** embed when data is accessed together and bounded; reference when it's large, accessed independently, or shared.

**Use MongoDB for:** varying fields per record (e.g. a mixed product catalogue), document-centric data (posts with comments), rapid schema iteration. **Not for:** complex cross-collection joins or highly relational data. Multi-document transactions exist (4.0+) but are costly. Needing them everywhere points to SQL.

---

## Column-Family: Cassandra

Distributed, masterless wide-column store built for huge write throughput and high availability. Every node is equal; data is auto-replicated. AP.

**Data model:** a **partition key** (which node stores it) + a **clustering key** (sort order within the partition).
```sql
CREATE TABLE sensor_data (
    sensor_id  UUID,
    timestamp  TIMESTAMP,
    value      DOUBLE,
    PRIMARY KEY (sensor_id, timestamp)  -- partition: sensor_id, clustering: timestamp
);
```
All rows for a `sensor_id` sit together, sorted by `timestamp`. Single-partition queries are very fast.

**Strengths:**
- **Write-optimised:** writes hit an in-memory memtable + append-only commit log (sequential, no locks).
- **Linear horizontal scaling:** add nodes, capacity grows.
- **High availability:** configurable replication factor; tunable consistency per query (e.g. `QUORUM` = majority of replicas respond).

**Limitations:**
- No joins, one table per query pattern.
- Aggregations (SUM, GROUP BY) work only within one partition. Do analytics in app code or Spark.
- Updates are new timestamped writes; deletes are tombstones (deletion markers; too many degrade reads).
- Schema is query-driven: pick the queries first, then design the tables.

**Use for:** time-series (IoT, metrics, logs), write-heavy workloads, always-on availability, where eventual consistency is fine.

---

## SQL vs NoSQL Decision Framework

**Use SQL (Postgres, MySQL) when:**
- **ACID** matters: banking, payments, inventory, bookings.
- **Complex queries / joins** across entities.
- **Stable, well-defined schema.**
- **Relational integrity** via FKs and constraints.
- Scale is moderate. SQL handles millions of rows with indexing + read replicas.

**Use NoSQL when:**

| Need | Tool | Why |
|---|---|---|
| Cache, sessions, counters | Redis | In-memory, rich structures, TTL |
| Flexible schema, documents | MongoDB | Embed nested data, schema-free |
| Massive writes, time-series | Cassandra | Write-optimised, scales horizontally |
| Global scale, serverless | DynamoDB | Managed, single-digit-ms latency |
| Full-text search | Elasticsearch | Inverted index, ranking, fuzzy |
| Graph relationships | Neo4j | Native, fast traversals |

**Chat system (classic question):** NoSQL (Cassandra/HBase) for messages, SQL for user/channel metadata.
- *Messages:* huge write volume, always read by channel + time range (ideal partition + clustering key), no joins, must stay available.
- *Users/channels:* relational, benefit from ACID and flexible queries, far lower volume.

---

## Replication & Sharding

Two orthogonal scaling tools: **replication** copies the *same* data to multiple nodes; **sharding** splits *different* data across nodes.

**Replication (leader–follower):** writes go to one leader; followers copy its log and serve reads.
- **Async** (common): leader acks immediately, ships to followers later. Fast, but causes the **replica lag** from Part 1, and a leader crash can lose the newest writes.
- **Sync:** leader waits for a follower ack. No loss, slower writes, stalls if the follower is down.
- Buys read scale + failover (promote a follower), **not** write scale.

**Sharding (horizontal partitioning):** split rows across nodes by a **shard key**, e.g. `hash(user_id) % N` or key ranges. Scales writes and storage. Costs: cross-shard queries/joins and transactions are hard, and a bad key creates hotspots (see Q&A). Naive `hash % N` breaks when N changes, nearly every key remaps.

**Consistent hashing:** place nodes and keys on a hash ring; each key belongs to the next node clockwise. Adding/removing a node remaps only ~1/N of the keys (its neighbours'), not everything. Used by Cassandra and Dynamo-style stores; **virtual nodes** (many ring positions per server) even out the load.

---$body$, step = 3
  WHERE title = 'NoSQL, CAP Theorem & When to Use What';

UPDATE questions.bank SET lesson_md = $body$## The Network Stack

### OSI Model vs TCP/IP Model

OSI is a conceptual 7-layer model. TCP/IP is the 4-layer model the internet actually uses. Know both and how they map.

```
OSI (7 layers)              TCP/IP (4 layers)
7. Application  ┐
6. Presentation ├──────────► Application      HTTP, DNS, SMTP
5. Session      ┘
4. Transport    ──────────► Transport        TCP, UDP
3. Network      ──────────► Internet         IP, ICMP
2. Data Link    ┐
1. Physical     ┴─────────► Network Access   Ethernet, WiFi
```

- **Physical:** raw bits over a medium (cable, radio).
- **Data Link:** node-to-node delivery on the same network. MAC addresses, Ethernet frames.
- **Network:** routing packets across networks. IP addresses, routers.
- **Transport:** process-to-process delivery. Ports. TCP and UDP.
- **Application:** app protocols, HTTP, DNS, SMTP, WebSocket.

Each layer wraps the one below: a TCP segment goes inside an IP packet, inside an Ethernet frame. When debugging, narrow by layer (DNS? routing? cable?).

### IP Addressing

- **IPv4:** 32-bit, four decimal octets (`192.168.1.1`). ~4 billion addresses, exhausted, hence IPv6.
- **IPv6:** 128-bit, eight hex groups (`2001:db8:85a3::8a2e:370:7334`). Effectively unlimited.
- **CIDR:** `192.168.1.0/24`. First 24 bits are the network prefix; the remaining 8 bits give 256 addresses (254 usable hosts).
- **Private (not internet-routable):** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. **Public:** everything else.
- **NAT:** the router has one public IP; inside devices use private IPs. It rewrites addresses so outbound traffic appears to come from that one public IP, tracking which device gets each response.

---

## TCP vs UDP

**TCP**: reliable, ordered, connection-oriented.
- **Reliable:** every segment is ACKed; lost ones are retransmitted.
- **Ordered:** segments are numbered and reassembled in order.
- **Flow control:** receiver advertises window size so the sender won't overwhelm it.
- **Congestion control:** detects congestion and slows down.
- **Cost:** handshake, ACKs, retransmissions add overhead.
- **Use when** data must arrive complete and in order: HTTP(S), SSH, FTP, SMTP, DB connections.

**UDP**: fast, connectionless, best-effort. No handshake, ACKs, ordering, or retransmission.
- Very low latency, low per-packet overhead, no head-of-line blocking.
- **Use when** speed beats reliability (app handles reliability if needed): DNS (tiny, easy to retry), video/VoIP (skip a late frame; stale audio is useless), gaming (latest state matters, not old order), QUIC/HTTP/3 (adds its own reliability + multiplexing).

| | TCP | UDP |
|---|---|---|
| Connection | Yes (handshake) | No |
| Reliability | Guaranteed (ACK + retransmit) | None |
| Ordering | Guaranteed | None |
| Speed | Slower | Faster |
| Use cases | HTTP, SSH, DB | DNS, video, gaming, QUIC |

---

## The TCP Three-Way Handshake

A connection is established before data flows:

```
Client                                  Server
  |--- SYN (seq=x) ------------------►|   "connect; my seq starts at x"
  |◄-- SYN-ACK (seq=y, ack=x+1) ------|   "ok; my seq is y, got your x"
  |--- ACK (ack=y+1) ---------------►|   "got it; established"
  |======= DATA FLOWS ===============|
```

**Why three steps?** Both sides must agree on initial sequence numbers (ISNs) and prove each can send *and* receive: SYN (client can send), SYN-ACK (server can send + receive), ACK (client confirms). ISNs are randomized so stale packets from an old connection aren't mistaken for current ones.

### Teardown (FIN)

Termination is four-way; either side can start:

```
  |--- FIN ---►|   "done sending"
  |◄-- ACK ----|
  |◄-- FIN ----|   "done too"
  |--- ACK ---►|
```

After sending the final ACK, the initiator enters **TIME_WAIT** (2×MSL. Maximum segment lifetime; ~60s on Linux) so it can resend that ACK if lost, and so stray packets die off instead of leaking into a new connection on the same port. Restarting a server fast can hit "address already in use" from TIME_WAIT. Fix with the `SO_REUSEADDR` socket option.

### Congestion Control

TCP probes for bandwidth and backs off on loss.
- **Slow start:** start with a small congestion window (cwnd); double it each round-trip (RTT) until a threshold or loss.
- **Congestion avoidance:** past the threshold, grow linearly (+1 MSS, one max-size segment, per RTT).
- **On loss:** assume congestion, halve cwnd. A lossy link (cellular) repeatedly slows TCP.

This is why latency-sensitive apps prefer UDP, and why HTTP/3 uses QUIC with its own congestion control.

---

## Ports and Sockets

A **port** is a 16-bit number (0-65535) identifying a process on a host.
- **0-1023:** well-known (HTTP 80, HTTPS 443, SSH 22, DNS 53, SMTP 25).
- **1024-49151:** registered (app-specific).
- **49152-65535:** ephemeral (OS-assigned for client connections).

Connecting to `api.example.com:443` uses destination port 443 and an OS-assigned source port. The 4-tuple `(client IP, client port, server IP, server port)` uniquely identifies the connection.

A **socket** is a software endpoint for network I/O. A file descriptor you read/write.

```
Server: socket() → bind(IP:port) → listen() → accept() → read/write() → close()
Client: socket() → connect(IP:port) → read/write() → close()
```

`accept()` returns a **new** socket per client while the original keeps listening. This is how one server serves many clients.

---$body$, step = 1
  WHERE title = 'The Network Stack & TCP/IP';

UPDATE questions.bank SET lesson_md = $body$## HTTP Evolution

- **HTTP/1.0:** one TCP connection per request, closed after each response. A full handshake per resource, very inefficient.
- **HTTP/1.1:** persistent connections (`keep-alive`) reuse one connection, but requests are still **sequential**. You wait for response N before sending N+1. That's **head-of-line blocking**. Workaround: ~6 parallel connections per domain. Pipelining (send without waiting, responses in order) exists but is rarely used and often broken.
- **HTTP/2:** **multiplexing**. Many requests/responses in flight over one TCP connection, each a **stream** with its own ID, no ordering required. Also **binary framing** (faster to parse than 1.1's text), **HPACK** header compression (cuts repeated `Cookie`/`User-Agent` overhead), and **server push** (rarely used). Limit: runs over TCP, so one lost segment stalls all streams (TCP-level HOL blocking).
- **HTTP/3 (QUIC):** QUIC runs over UDP with its own per-stream reliability, so a lost packet blocks only its own stream. Gains: no TCP-level HOL blocking, faster setup (0-RTT on reconnect), better on lossy/cellular networks. Now widely supported by browsers and CDNs.

---

## Request & Response Structure

```
POST /api/orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbG...

{"product_id": "abc123", "quantity": 2}
```

**Methods:**

| Method | Idempotent? | Safe? | Use |
|---|---|---|---|
| GET | Yes | Yes | Retrieve (no side effects) |
| POST | No | No | Create / trigger action |
| PUT | Yes | No | Replace resource entirely |
| PATCH | No* | No | Partial update |
| DELETE | Yes | No | Delete resource |
| HEAD | Yes | Yes | Like GET, no body |
| OPTIONS | Yes | Yes | List methods (CORS preflight) |

- **Idempotent:** N calls = same effect as one. `PUT /orders/123` always yields the same state; `POST /orders` creates a new order each time. (*PATCH isn't guaranteed idempotent, e.g. an "increment" patch.)
- **PUT vs PATCH:** PUT replaces the whole resource (fields you omit get cleared). PATCH updates only the fields you send.

**Status codes, know cold:**

| Code | Meaning | When |
|---|---|---|
| 200 | OK | Success with body |
| 201 | Created | Resource created (POST), set Location header |
| 204 | No Content | Success, no body (DELETE, PUT) |
| 301 | Moved Permanently | Redirect, cached by browser |
| 302 | Found | Temporary redirect, not cached |
| 400 | Bad Request | Invalid/malformed request |
| 401 | Unauthorized | Not authenticated (no/invalid credentials) |
| 403 | Forbidden | Authenticated but not allowed |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | State conflict (duplicate, version mismatch) |
| 422 | Unprocessable Entity | Valid syntax, invalid data |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Server Error | Unhandled server exception |
| 503 | Service Unavailable | Down or overloaded |

**401 vs 403:** 401 = "who are you?" (unauthenticated). 403 = "I know you, but you can't do this" (unauthorized). Common gotcha.

---

## HTTP Caching

Caching lets the browser or a proxy reuse a stored response instead of re-fetching.

**Cache-Control:**
- `max-age=N`: fresh for N seconds; served from cache without hitting the server.
- `public`, cacheable by intermediaries (CDNs/proxies); `private`, browser only.
- `no-store`: never cache (sensitive data).
- `no-cache`: may cache, but must revalidate before use.
- `s-maxage=N`: like max-age but for shared caches.

**Validation (after expiry):** revalidate instead of re-downloading.
- **ETag:** server sends `ETag: "abc123"` (content hash). Next request sends `If-None-Match: "abc123"`. Unchanged → `304 Not Modified` (no body); changed → full `200` with new ETag.
- **Last-Modified:** server sends a date; next request sends `If-Modified-Since`; server returns 304 or fresh content.

```
GET /styles.css   If-None-Match:"abc123"   (after expiry)
→ 304 Not Modified      (unchanged: no body, fast)
→ 200  ETag:"xyz456"    (changed: full new response)
```

**stale-while-revalidate:** `max-age=60, stale-while-revalidate=3600`. Serve stale instantly, revalidate in the background. No user-facing latency.

---

## HTTPS & TLS

HTTP is plaintext. Anyone on the path can read or alter it. HTTPS wraps HTTP in TLS to encrypt traffic and verify the server's identity.

**TLS handshake:**
1. **ClientHello:** TLS version, supported cipher suites, client random.
2. **ServerHello:** chosen cipher suite, server random, and the server's **certificate** (public key, signed by a CA).
3. **Verify cert:** browser checks the CA chain, domain match, and expiry.
4. **Key exchange:** both run an algorithm (typically ECDHE) to derive a shared **session key** without sending it. An eavesdropper can't reconstruct it.
5. **Finished:** both confirm with a message encrypted under the session key.
6. **Data:** encrypted with the symmetric session key (e.g. AES-GCM).

**Symmetric vs asymmetric:** asymmetric (RSA/ECDHE) secures the key exchange but is slow, so it's paid once; symmetric (AES) is fast and carries all the data afterward.

**HTTP/2 + TLS:** the spec allows HTTP/2 without TLS, but no browser implements it, so in practice it needs TLS.

---

## Cookies & Sessions

HTTP is **stateless**, each request stands alone. Cookies add state.

Server: `Set-Cookie: session_id=abc123; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`. The browser then auto-sends `Cookie: session_id=abc123` on later requests.

**Flags:**
- `HttpOnly`, JS can't read it (blocks cookie theft via **XSS**, injected malicious scripts).
- `Secure`: sent only over HTTPS.
- `SameSite=Strict`, not sent on cross-site requests (blocks **CSRF**, another site triggering requests that ride on your cookies); `Lax`. Sent on top-level navigation only.
- `Max-Age=N`: expiry; without it, it's a session cookie (gone when the browser closes).

**Session vs JWT:**
- **Server-side session:** cookie holds only a session ID; server stores the data (DB/Redis). Easy to invalidate, but adds a lookup per request. Stateful.
- **JWT (JSON Web Token):** token holds signed user claims; server verifies the signature, no lookup. Stateless and scales well, but hard to invalidate before expiry (needs a blocklist, which re-adds a lookup).

---

## CORS

Browsers enforce the **Same-Origin Policy:** JS on `app.example.com` can't read responses from `api.otherdomain.com`. This stops malicious sites from using a user's credentials. **Origin = scheme + host + port** (so http vs https differ).

- **Simple request (no preflight):** GET/POST with standard headers. Browser adds `Origin`; server replies `Access-Control-Allow-Origin` (specific origin or `*`); browser then lets JS read the response.
- **Preflight (OPTIONS):** for non-simple requests (PUT/DELETE, custom headers, JSON content type), the browser asks first:

```
OPTIONS /api/users
Origin: https://app.example.com
Access-Control-Request-Method: DELETE
Access-Control-Request-Headers: Authorization

→ Access-Control-Allow-Origin: https://app.example.com
  Access-Control-Allow-Methods: GET, POST, DELETE
  Access-Control-Allow-Headers: Authorization
  Access-Control-Max-Age: 86400   (caches this preflight)
```

**Common bug:** CORS headers returned on 200 but missing on 4xx/5xx. The browser needs them on errors too, or JS can't read it.

---

## WebSockets

WebSocket is **full-duplex** over a persistent connection. Either side can send anytime, unlike HTTP's request→response.

It starts as HTTP and upgrades:

```
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

→ HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
```

After `101 Switching Protocols`, the connection is raw WebSocket, no longer HTTP.

| | Short polling | Long polling | WebSocket |
|---|---|---|---|
| How | Poll every N sec | Server holds request open until data | Persistent bidirectional |
| Latency | Up to N sec | Near real-time | Real-time |
| Overhead | High | Medium | Low after handshake |
| Use case | Periodic updates | Near-real-time over HTTP | Chat, collaboration, live data |

- **Use WebSockets for** real-time bidirectional needs: chat, collaborative editing, live dashboards, multiplayer, sub-second notifications.
- **Don't** for periodic data (use polling or SSE. Server-sent events), simple request/response (use HTTP), or flaky mobile clients (persistent connections are hard).

---$body$, step = 2
  WHERE title = 'HTTP Deep Dive';

UPDATE questions.bank SET lesson_md = $body$## DNS Resolution

DNS translates domain names (`api.example.com`) into IPs (`93.184.216.34`). It's distributed, hierarchical, and heavily cached.

### The resolution chain

```
Browser cache → OS cache → Recursive Resolver → Root NS → TLD NS → Authoritative NS
```

1. **Browser cache**, recent and unexpired? Use it.
2. **OS cache / hosts file**. Check `/etc/hosts` and the OS cache.
3. **Recursive resolver** (ISP or 8.8.8.8). Checks its cache; on a miss, does the lookups below.
4. **Root nameservers** (13 root server addresses, served worldwide via anycast, one IP, many physical servers), point to the TLD servers ("where is `.com`?").
5. **TLD nameserver** (`.com` run by Verisign). Points to the domain's authoritative server.
6. **Authoritative nameserver** (run by the domain owner). Returns the actual record (the IP).
7. Resolver caches the result for its TTL and returns it; the TCP/TLS handshake to that IP begins.

### Record types

| Type | Maps | Example |
|---|---|---|
| A | Domain → IPv4 | `example.com → 93.184.216.34` |
| AAAA | Domain → IPv6 | `example.com → 2606:2800:...` |
| CNAME | Domain → another domain | `www.example.com → example.com` |
| MX | Domain → mail server | `example.com → mail.example.com` |
| TXT | Arbitrary text (SPF, DKIM) | `"v=spf1 include:..."` |
| NS | Domain → authoritative nameserver | `example.com → ns1.example.com` |

### TTL and propagation

**TTL** is how long resolvers cache a record. Short TTL → changes propagate fast but more query load; long TTL → fewer queries but slow changes. Before a migration, lower TTL to 60-300s a day ahead (so old high-TTL records expire), make the change, then raise it back. Old records can't be force-expired, so a former TTL of 86400 means up to 24h of "propagation."

### DNS and load balancing

- **DNS round-robin:** return several A records; resolvers cycle through them. Crude, ignores health and load.
- **GeoDNS:** return different IPs by client location (Asia → Singapore DC).
- **Anycast:** one IP announced from many locations via BGP (the internet's routing protocol between networks); routing picks the nearest node. Used by CDNs and DDoS protection.

### CDNs

A **CDN** (content delivery network. Cloudflare, Akamai, CloudFront) is a global fleet of **edge servers** that cache content close to users.
- Clients reach the nearest edge via GeoDNS/anycast. Cache hit → served from the edge; miss → the edge fetches from the **origin** (your servers) and caches it per `Cache-Control`.
- Wins: lower latency (short RTT to the edge), origin offload, absorbs traffic spikes and DDoS.
- Best for static assets (JS/CSS/images/video); modern CDNs also terminate TLS at the edge and can cache API GETs.

---

## Load Balancing

A load balancer spreads requests across a server pool for availability and throughput.

### Algorithms

- **Round robin:** server 1, 2, 3, 1, 2, 3… Assumes equal servers.
- **Weighted round robin:** bigger servers get a larger share.
- **Least connections:** send to the server with fewest active connections. Best when request durations vary a lot.
- **IP hash:** hash client IP to pin a client to one server (session affinity). Breaks when servers change, use consistent hashing.
- **Consistent hashing:** place servers and keys on a ring; a key goes to the next server clockwise. Adding/removing a server remaps only ~1/N of keys. Key for distributed caches (Redis/Memcached), CDN edge selection, and shard routing.

### L4 vs L7

**L4 (transport):** routes by IP/port on TCP/UDP; never reads the payload. Very fast. Blind to HTTP (no URLs, headers, cookies). Use for raw TCP, max throughput, latency-sensitive traffic.

**L7 (application):** reads HTTP, so it can route by URL/host/header/cookie, terminate SSL, do cookie session affinity, and run HTTP-level health checks. Examples: Nginx, HAProxy, AWS ALB. Use for HTTP microservices, content-based routing, A/B tests, canaries.

### Health checks

LBs probe backends. TCP (can I connect?), HTTP (`GET /health` → 200?), or custom (body contains `"status":"ok"`). A failing backend is pulled from rotation until healthy. This enables zero-downtime deploys: drain → deploy → health check passes → add back.

---

## REST vs gRPC vs GraphQL

### REST

An architectural style for HTTP APIs:
- **Stateless**: each request carries all it needs.
- **Resources** are nouns: `/users/123/orders`, not `/getUserOrders`.
- **HTTP verbs:** GET read, POST create, PUT/PATCH update, DELETE delete.

```
GET    /users/123          get user
POST   /users              create user
PUT    /users/123          replace user
PATCH  /users/123          partial update
DELETE /users/123          delete user
GET    /users/123/orders   user's orders
```

**Pros:** universal, human-readable, stateless, easy to cache GETs. **Cons:** over-fetching (extra fields), under-fetching (multiple round-trips), no strong typing.

### gRPC

Google's high-performance RPC (remote procedure call) framework. Uses **Protocol Buffers** (binary, schema-defined in `.proto`) over **HTTP/2**.

```protobuf
service OrderService {
    rpc GetOrder(OrderRequest) returns (Order);
    rpc StreamOrders(UserRequest) returns (stream Order);  // server streaming
}
message OrderRequest { string order_id = 1; }
message Order { string order_id = 1; double total = 2; repeated string items = 3; }
```

The protoc compiler generates client/server code in many languages from the `.proto`.

**Pros:** small fast binary payloads, strong typing (schema is the contract), built-in streaming, HTTP/2 multiplexing, great for polyglot microservices. **Cons:** not human-readable, no native browser support (needs gRPC-Web proxy), schema changes need client/server coordination.

**Use for** internal microservices where you own both ends, performance-critical or streaming APIs.

### GraphQL

One endpoint; the **client asks for exactly the fields it wants**.

```graphql
query { user(id: "123") { name email orders(last: 5) { id total } } }
```

The server returns exactly that shape.

**Pros:** no over/under-fetching, single endpoint, self-documenting (introspection), great for nested data and fast-changing frontends. **Cons:** harder backend (N+1 queries), hard to cache (every query differs), no HTTP verb semantics (all POST), overkill for simple CRUD.

**N+1:** fetching 10 users + their orders can be 1 + 10 = 11 queries. Fix with **DataLoader** (batches and dedupes).

### Comparison

| | REST | gRPC | GraphQL |
|---|---|---|---|
| Protocol | HTTP/1.1 or 2 | HTTP/2 | HTTP/1.1 or 2 |
| Format | JSON (text) | Protobuf (binary) | JSON |
| Typing | Loose (OpenAPI optional) | Strong (proto) | Strong (schema) |
| Streaming | Limited (SSE/WS) | Native (4 modes) | Subscriptions |
| Browser | Native | Needs gRPC-Web | Native |
| Caching | Easy (GET + CDN) | Hard | Hard |
| Best for | Public APIs, CRUD | Internal microservices | Complex frontend data |

---

## API Design

**Versioning:**
- **URL** (`/v1/users`). Explicit, easy to route, most common; clients must update URLs.
- **Header** (`Accept: ...; version=2`). Cleaner URLs, harder to test in a browser.
- **No versioning (evolve):** only backwards-compatible changes. Add fields, never remove/rename.

**Pagination:**
- **Offset** (`?limit=20&offset=40`). Simple, but inserts cause duplicates/skips and high offsets are slow (DB scans and skips).
- **Cursor** (`?limit=20&after=cursor_xyz`), opaque pointer (e.g. last row ID/timestamp). Stable under inserts and efficient (DB jumps to the cursor). Can't jump to an arbitrary page. **Use cursor at scale.**

**Idempotency keys:** for POSTs that must not run twice (payments, orders), the client sends `Idempotency-Key: <uuid>`. Seen before → return the stored response; new → execute and store it. Prevents double-charges on retried/timed-out requests.

**Rate limiting:** cap requests per client (API key/IP) so no one client can overwhelm the backend. Over the limit → `429 Too Many Requests` + `Retry-After` header. Classic algorithm: **token bucket**. Tokens refill at a steady rate, each request spends one, unused tokens allow short bursts. Enforce at the gateway/LB with a shared counter store (Redis) so limits hold across servers.

---$body$, step = 3
  WHERE title = 'DNS, Load Balancing & API Design';

UPDATE questions.bank SET lesson_md = $body$## Why OOP Exists

Before OOP, procedures operated on global data. Any function could change anything, so bugs were untraceable. OOP bundles data with the code that uses it into objects and controls what outside code can touch. The four pillars make this work.

---

## Pillar 1, Encapsulation

Bundle data (fields) and the methods that act on it into one class, and restrict direct access to the data with access modifiers:

- `private`: only inside the class
- *(no modifier)*. Same package only (Java's "package-private" default)
- `protected`: subclasses + same package
- `public`: anyone

**Why it matters:** without it, any code can do `user.age = -5`. With it, access goes through methods that validate, so the class enforces its own invariants (rules that must always hold) and stays the single source of truth for its state.

```java
class BankAccount {
    private double balance;            // can't be set directly
    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException();
        balance += amount;
    }
}
```

**Encapsulation vs Abstraction (the common confusion):**
- **Encapsulation = how** you hide internals (access modifiers, getters/setters), the mechanism.
- **Abstraction = what** you expose (a simple public interface over complexity), the design goal.

You use encapsulation to achieve abstraction.

---

## Pillar 2, Abstraction

Hide complex implementation, expose only what's relevant. You drive a car with the pedals and wheel without knowing how fuel injection works. A simple interface over huge complexity. In code you achieve it with **abstract classes** and **interfaces**.

**Abstract class**: can't be instantiated; provides partial implementation and forces subclasses to fill the gaps.

```java
abstract class Shape {
    abstract double area();                       // subclasses must implement
    void printArea() { System.out.println(area()); }   // shared concrete method
}
class Circle extends Shape {
    double radius;
    double area() { return Math.PI * radius * radius; }
}
```

**Interface**: a pure contract: what a class must do, not how (default methods allowed in Java 8+).

```java
interface Serializable { String serialize(); void deserialize(String data); }
```

### Abstract class vs Interface

| | Abstract class | Interface |
|---|---|---|
| State (fields) | Yes | No (constants only) |
| Constructor | Yes | No |
| Implementation | Partial | None (or default methods, Java 8+) |
| Multiple inheritance | No, one only | Yes, implement many |
| Use when | Sharing code among related classes | A contract for unrelated classes |

Rule of thumb: **abstract class = "is-a" with shared code; interface = "can-do" contract.** `Dog extends Animal` (is-a); `Dog implements Serializable` (can-do).

**Why only one superclass? The diamond problem**: if `D` could extend both `B` and `C`, and each overrides the same inherited method, which version does `D` get? Java avoids the ambiguity by allowing one superclass only. Multiple interfaces are safe because they carry no state; if two default methods clash, the compiler forces the class to override and choose.

---

## Pillar 3, Inheritance

A subclass inherits a parent's fields and methods and can extend or override them. Promotes reuse.

```java
class Animal {
    String name;
    void eat() { System.out.println(name + " is eating"); }
}
class Dog extends Animal {
    void bark() { System.out.println(name + " is barking"); }   // gets eat() for free
    @Override void eat() { System.out.println("Dog gulps food"); }   // overriding
}
```

**Method overriding**: a subclass replaces a parent method; its version runs at runtime for that object.

**Fragile base class problem:** inheritance is tight coupling. Changing the parent, even harmlessly, can break subclasses. That's why we "favour composition over inheritance."

**Avoid inheritance when:**
- The relationship is "has-a", not "is-a" (a Car *has* an Engine).
- You need runtime flexibility (you can't swap inheritance at runtime).
- The hierarchy goes deeper than 2-3 levels.

---

## Pillar 4, Polymorphism

"Many forms". One interface refers to objects of different types, and the right behaviour is chosen automatically.

**Compile-time (method overloading)**: same name, different parameters; the compiler picks the version.

```java
class Calculator {
    int add(int a, int b) { return a + b; }
    double add(double a, double b) { return a + b; }
}
```

**Runtime (method overriding + dynamic dispatch)**: a parent reference points to a child object; which method runs is decided at runtime by the object's real type.

```java
Animal a = new Dog();
a.speak();   // runs Dog's speak(), decided at RUNTIME
```

**How dynamic dispatch works (vtable):** each class with overridable methods has a vtable, an array of method pointers. Calling `a.speak()` looks up the real type's vtable (Dog's) and calls its `speak()`.

**Why it matters:** you write code against the abstraction (`void makeNoise(Animal a) { a.speak(); }`) and it works with any implementation. No `if (a instanceof Dog) ...` chains to maintain when you add a type.

> **Interview tip:** when asked how runtime polymorphism works, say *vtable / dynamic dispatch*. It shows you know the mechanism, not just the concept.

---

## Class Relationships

These come up in low-level design questions ("design a parking lot / library system").

- **Association**: A uses B; neither owns the other or controls its lifecycle. `Doctor treats Patient`.
- **Aggregation ("has-a", weak ownership)**: A holds a reference to B, but B can outlive A. `Department has Employees`.
- **Composition ("has-a", strong ownership)**: A owns B; B dies with A. `House has Rooms` (created inside it).
- **Dependency**: A uses B temporarily (parameter or local variable). `report.generate(Printer p)`.

```java
class House {
    private Room bedroom = new Room();   // composition, Room dies with House
}
```

### Summary table

| Relationship | Type | Lifecycle | Example |
|---|---|---|---|
| Inheritance | Is-a | Child depends on parent | `Dog extends Animal` |
| Association | Uses | Independent | `Doctor treats Patient` |
| Aggregation | Has-a (weak) | Independent | `Department has Employees` |
| Composition | Has-a (strong) | Dependent | `House has Rooms` |
| Dependency | Uses temporarily | Independent | `method(Printer p)` |

---$body$, step = 1
  WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = $body$## The SOLID Principles

Five principles for maintainable, extensible, testable code. Interviewers test SOLID more than patterns. Know each with a violation + fix.

---

### S. Single Responsibility Principle

**"A class should have only one reason to change."**

If a class does auth *and* sends emails *and* writes reports, an email change forces you to touch auth code.

```java
class UserService {
    void registerUser(User u) { /* saves to DB */ }
    void sendWelcomeEmail(User u) { /* email */ }   // not its job
    void generateReport() { /* reporting */ }        // not its job
}
```

**Fix:** split into `UserService`, `EmailService`, `ReportService`. Each with one reason to change.

**Tip:** SRP applies to functions and microservices too. A service handling both orders and payments violates SRP at the architecture level.

---

### O, Open/Closed Principle

**"Open for extension, closed for modification."**

Add new behaviour with new code, don't edit tested code.

```java
// Violation: adding a discount type means editing this method
class DiscountCalculator {
    double calculate(String type, double price) {
        if (type.equals("VIP")) return price * 0.8;
        if (type.equals("Member")) return price * 0.9;
        return price;
    }
}

// Fix: each discount is its own class
interface DiscountStrategy { double apply(double price); }
class VIPDiscount     implements DiscountStrategy { public double apply(double p) { return p * 0.8; } }
class StudentDiscount implements DiscountStrategy { public double apply(double p) { return p * 0.85; } }
// New discount = new class, existing code untouched
```

This is why we "program to an interface". The interface is closed; new implementations are the extension.

---

### L, Liskov Substitution Principle

**"A subclass must be usable anywhere its superclass is, without breaking the program."**

If code works with a `Bird`, it must work with a `Penguin extends Bird`. If substituting a subclass breaks behaviour, the hierarchy is wrong.

```java
// Classic violation: Square extends Rectangle
class Square extends Rectangle {
    void setWidth(int w)  { this.width = w; this.height = w; }
    void setHeight(int h) { this.width = h; this.height = h; }
}
Rectangle r = new Square();
r.setWidth(5);
r.setHeight(3);
r.area();   // expected 15, actual 9, BROKEN
```

A square is geometrically a rectangle but behaviourally breaks the width/height contract. **Fix:** drop the inheritance. Give both a `Shape` interface with `area()`, or use composition.

Same idea with `Penguin extends Bird` overriding `fly()` to throw. Fix by splitting `FlyingBird` from `Bird`.

**Tip:** LSP violations show up as `instanceof` checks or `UnsupportedOperationException` in subclasses, both are smells.

---

### I. Interface Segregation Principle

**"Clients shouldn't be forced to depend on methods they don't use."**

Prefer several small interfaces over one fat one.

```java
// Violation: a fat interface forces empty stubs
interface Printer { void print(); void scan(); void fax(); }

// Fix: split it
interface Printable { void print(); }
interface Scannable { void scan(); }
interface Faxable   { void fax(); }

class SimplePrinter implements Printable { /* ... */ }
class OfficePrinter implements Printable, Scannable, Faxable { /* ... */ }
```

ISP connects to SRP: a fat interface usually means more than one responsibility.

---

### D. Dependency Inversion Principle

**"High-level modules and low-level modules should both depend on abstractions, not on each other."**

Depend on interfaces; inject the implementation.

```java
// Violation: hardcoded concrete dependency
class OrderService {
    private MySQLDatabase db = new MySQLDatabase();   // can't swap or mock
}

// Fix: depend on an interface, inject it
interface Database { void save(Order o); }
class OrderService {
    private final Database db;
    OrderService(Database db) { this.db = db; }       // injected from outside
    void placeOrder(Order o) { db.save(o); }
}
// prod: new OrderService(new MySQLDatabase());  test: new OrderService(new MockDatabase());
```

DIP is the basis for DI frameworks (Spring, Guice). The rule: **inject, don't instantiate.**

---

## Creational Patterns

Control how objects are created.

### Singleton
**One instance of a class, globally accessible.** Below is the thread-safe double-checked locking version (a plain `synchronized` method also works but locks on every call).

```java
class Config {
    private static volatile Config instance;
    private Config() {}                                // no outside instantiation

    public static Config getInstance() {
        if (instance == null) {
            synchronized (Config.class) {
                if (instance == null) instance = new Config();
            }
        }
        return instance;
    }
}
```

**Why it's an antipattern:** global mutable state (any code can change it), hidden dependencies (users don't declare they need it), and it breaks testing (shared instance, can't inject a mock).

**Acceptable for** truly shared infrastructure with no mutable business state. Connection pools, loggers, immutable config loaded once at startup.

---

### Factory Method
**Let a subclass decide which class to instantiate, decoupling creation from use.**

If you write `new Dog()` everywhere, switching to `Cat` means touching every site. A factory centralises it.

```java
abstract class AnimalFactory {
    abstract Animal create();          // subclass decides
    void handle() { create().speak(); }
}
class DogFactory extends AnimalFactory { Animal create() { return new Dog(); } }
class CatFactory extends AnimalFactory { Animal create() { return new Cat(); } }
```

**Factory vs Factory Method vs Abstract Factory:**
- **Simple Factory**: a static `create()` with a switch. Not a GoF (Gang of Four, the classic patterns book) pattern, just a helper.
- **Factory Method**: an abstract method; subclasses override it to produce different objects.
- **Abstract Factory**: creates *families* of related objects (`MacUIFactory` makes `MacButton` + `MacTextBox`; `WindowsUIFactory` makes the Windows set).

---

### Builder
**Construct a complex object step by step, avoiding telescoping constructors.**

A class with 10 optional fields otherwise needs many overloads or one huge parameter list.

```java
User user = new User.Builder("John", "john@example.com")   // required
    .age(25).city("Singapore").premium(true)
    .build();                                              // validates + constructs
```

The builder holds state as you chain calls; `build()` validates and returns the (often immutable) object. **Examples:** `StringBuilder`, `HttpRequest.Builder`, ORM query builders.

---

## Structural Patterns

Deal with how classes and objects are composed.

### Adapter
**Wrap an incompatible interface so it fits, a translator.**

Your system expects `PaymentGateway.charge(...)` but you have a `LegacyPaymentProcessor.processPayment(...)`.

```java
interface PaymentGateway { void charge(PaymentRequest req); }

class LegacyAdapter implements PaymentGateway {
    private LegacyPaymentProcessor legacy;
    LegacyAdapter(LegacyPaymentProcessor p) { this.legacy = p; }

    public void charge(PaymentRequest req) {
        legacy.processPayment(req.getAmount(), req.getCurrency());   // translates
    }
}
```

**Examples:** `InputStreamReader` adapts an `InputStream` (bytes) to a `Reader` (chars); third-party SDK wrappers.

---

### Decorator
**Add behaviour to an object at runtime by wrapping it, no subclassing.**

Optional features (encryption, compression, logging) via inheritance would explode into `EncryptedCompressedLoggedMessage`-style classes. With Decorator, each feature is a wrapper sharing the same interface.

```java
interface Message { String getContent(); }
class TextMessage implements Message {
    private String text;
    public String getContent() { return text; }
}
class EncryptedMessage implements Message {
    private Message wrapped;
    EncryptedMessage(Message m) { this.wrapped = m; }
    public String getContent() { return encrypt(wrapped.getContent()); }
}
// Compose at runtime:
Message m = new EncryptedMessage(new CompressedMessage(new TextMessage("Hello")));
```

**Examples:** Java I/O (`new BufferedReader(new FileReader(...))`), HTTP middleware chains.

**Decorator vs inheritance:** Decorator composes behaviour at runtime and avoids class explosion; inheritance is fixed at compile time.

---

### Facade
**A simple interface over a complex subsystem.**

```java
class OrderFacade {
    private InventoryService inventory; private PaymentService payment;
    private ShippingService shipping;   private NotificationService notifications;

    void placeOrder(Order order) {       // caller is unaware of the 4 services
        inventory.reserve(order.items);
        payment.charge(order.total);
        shipping.schedule(order);
        notifications.sendConfirmation(order.userId);
    }
}
```

**Examples:** a web app's service layer, API gateways, SDK wrappers over messy cloud APIs.

---$body$, step = 2
  WHERE title = 'SOLID Principles + Creational & Structural Patterns';

UPDATE questions.bank SET lesson_md = $body$## Behavioural Patterns

Define how objects interact and communicate.

---

### Observer
**One-to-many: when one object changes, all its dependents are notified automatically.**

- **Subject** holds state and a list of observers; notifies them on change.
- **Observer** has an `update()` called when the subject changes.

```java
interface Observer { void update(String event); }

class EventSystem {                       // Subject
    private List<Observer> observers = new ArrayList<>();
    void subscribe(Observer o)   { observers.add(o); }
    void unsubscribe(Observer o) { observers.remove(o); }
    void notifyObservers(String event) {
        for (Observer o : observers) o.update(event);
    }
}

class EmailNotifier implements Observer {
    public void update(String event) { System.out.println("Email: " + event); }
}
// events.subscribe(new EmailNotifier()); events.notifyObservers("order_placed");
```

**Push vs pull:** push sends the data in `update()` (simple, but observers may get data they don't need); pull sends only a notification and observers query the subject (more decoupled).

**Observer vs Pub/Sub:** Observer is direct, synchronous, single-process. Observers hold a reference to the subject. Pub/Sub puts a broker (Kafka, RabbitMQ) in the middle: publisher and subscriber don't know each other, communication is async, and it can span machines.

**Examples:** UI event listeners, React re-render on state change, notification systems.

---

### Strategy
**Define a family of interchangeable algorithms and swap them at runtime.**

A `Sorter` with a switch over sort algorithms violates OCP. Every new algorithm edits `Sorter`.

```java
interface SortStrategy { void sort(int[] data); }
class QuickSort implements SortStrategy { public void sort(int[] d) { /* ... */ } }
class MergeSort implements SortStrategy { public void sort(int[] d) { /* ... */ } }

class Sorter {
    private SortStrategy strategy;
    Sorter(SortStrategy s) { this.strategy = s; }
    void setStrategy(SortStrategy s) { this.strategy = s; }   // swap at runtime
    void sort(int[] data) { strategy.sort(data); }
}
```

**Backend examples:** swappable auth, payment processors, compression algorithms.

**vs if/else:** Strategy replaces conditionals with polymorphism. A new algorithm is a new class, no changes to existing code.

---

### Command
**Encapsulate a request as an object. Enables undo/redo, queuing, and logging.**

- **Command**: `execute()`, optionally `undo()`. **Concrete command** wraps one operation.
- **Invoker** holds/runs commands. **Receiver** does the actual work.

```java
interface Command { void execute(); void undo(); }

class InsertCommand implements Command {
    private TextEditor editor; private String text; private int pos;
    InsertCommand(TextEditor e, String text, int pos) {
        this.editor = e; this.text = text; this.pos = pos;
    }
    public void execute() { editor.insert(text, pos); }
    public void undo()    { editor.delete(pos, pos + text.length()); }
}

class CommandHistory {                     // Invoker with undo stack
    Deque<Command> history = new ArrayDeque<>();
    void execute(Command c) { c.execute(); history.push(c); }
    void undo() { if (!history.isEmpty()) history.pop().undo(); }
}
```

**Backend examples:** job queues (each job is a serialised Command), DB transactions (operation = command, rollback = undo), audit logs.

---

### Template Method
**Fix an algorithm's skeleton in a base class; let subclasses fill specific steps.**

```java
abstract class DataProcessor {
    final void process() {        // the template, fixed order
        readData();
        processData();
        writeOutput();
        sendAlert();              // default step, can be overridden
    }
    abstract void readData();
    abstract void processData();
    abstract void writeOutput();
    void sendAlert() { System.out.println("Processing complete"); }
}

class CSVProcessor extends DataProcessor {
    void readData()    { /* read CSV */ }
    void processData() { /* parse rows */ }
    void writeOutput() { /* write DB */ }
}
```

**When:** several classes share the same structure but differ in steps. Common in frameworks. Spring's `JdbcTemplate`, request lifecycle hooks.

---

### Iterator
**Traverse a collection without exposing its internal structure.**

Lists, trees, graphs, and DB cursors all iterate through the same `hasNext()`/`next()` interface.

```java
class NumberRange implements Iterable<Integer> {
    private int start, end;
    NumberRange(int s, int e) { start = s; end = e; }
    public Iterator<Integer> iterator() {
        return new Iterator<>() {
            int current = start;
            public boolean hasNext() { return current <= end; }
            public Integer next()    { return current++; }
        };
    }
}
for (int n : new NumberRange(1, 5)) { System.out.println(n); }
```

**Examples:** Java's `Iterable`/`Iterator`, Python's `__iter__`/`__next__`, DB cursors.

---

### Proxy
**Control access to another object. A stand-in with the same interface.**

**1. Caching**: avoid repeated expensive calls.
```java
class CachedProductService implements ProductService {
    private ProductService real;
    private Map<String, Product> cache = new HashMap<>();
    public Product getProduct(String id) {
        return cache.computeIfAbsent(id, real::getProduct);
    }
}
```

**2. Auth**: check permissions before delegating.
```java
class AuthProxy implements DataService {
    private DataService real;
    AuthProxy(DataService s) { this.real = s; }
    public Data getData(User user, String resource) {
        if (!user.hasPermission(resource)) throw new UnauthorizedException();
        return real.getData(user, resource);
    }
}
```

**3. Lazy loading**: defer expensive init until first use. JPA/Hibernate does this: `user.getOrders()` doesn't hit the DB until you access the orders.

**Proxy vs Decorator:** Decorator *adds behaviour* (composes features); Proxy *controls access* to the real object (same interface, manages its lifecycle/access).

---

## Composition over Inheritance

**Deep inheritance is brittle:**
```
Animal → Pet → Dog → GuideDog → TrainedGuideDog
```
Every class is coupled to its parent. Change `Dog` and you may break the rest. Need a `SwimmingGuideDog`? Inheritance forces a new class for every combination, class explosion.

**Composition: inject behaviour instead of inheriting it.**
```java
class Dog {
    private MovementBehaviour movement;
    private TrickBehaviour tricks;
    Dog(MovementBehaviour m, TrickBehaviour t) { this.movement = m; this.tricks = t; }
    void move()    { movement.move(); }
    void perform() { tricks.perform(); }
}

Dog guide   = new Dog(new GuideWalk(), new AdvancedCommands());
Dog swimmer = new Dog(new Swim(), new BasicTricks());
// swimming guide dog? new Dog(new Swim(), new GuideCommands()), no new class
```

**Rule:** favour composition for "has-a" (has a behaviour/strategy). Use inheritance only for genuine "is-a" relationships that are stable and shallow.

*Full pattern cheat-sheet (all 13, with backend examples) is in the overview.*

---$body$, step = 3
  WHERE title = 'Behavioural Patterns + Composition vs Inheritance';

UPDATE questions.bank SET lesson_md = $body$## The Interview Framework (Memorise This)

Use this on every question. Interviewers reward structure over perfect answers.

```
Step 1. Clarify requirements     (5 min)
Step 2. Estimate scale           (3 min)
Step 3. High-level design        (10 min)
Step 4. Component deep dives     (15 min)
Step 5. Bottlenecks & trade-offs (5 min)
```

1. **Clarify:** functional reqs (what it does) + non-functional (scale, latency, consistency, availability). Ask before drawing: real-time or eventual? Read- or write-heavy? Global or single region?
2. **Estimate:** DAU, QPS, storage. Numbers to know:
   - 1M req/day ≈ 12 QPS; 1B req/day ≈ 12K QPS (a day ≈ 86,400 s).
   - 1M DAU × 10 req/day ≈ 115 QPS; 100M DAU ≈ 11.5K QPS.
   - 1 KB/req × 10M req/day = 10 GB/day ≈ 3.6 TB/year.
   - SSD read ~0.1ms · network round trip (same DC) ~0.5ms · HDD seek ~10ms.
3. **HLD:** draw boxes first. Client → LB → API servers → DB/Cache. No detail yet.
4. **Deep dive:** pick 2-3 components the interviewer probes. This is where you differentiate.
5. **Bottlenecks:** what breaks at 10× scale? What did you sacrifice?

---

## Scaling from Zero to Millions

- **Single server:** web + app + DB on one box. Fine for a side project. First bottleneck: the DB.
- **App/DB split:** separate the app server from the DB so each scales independently.
- **Load balancer + multiple app servers:**

```
Client → DNS → Load Balancer → [App 1]
                             → [App 2]
                             → [App 3]
```

Gives horizontal scaling, no single point of failure, and zero-downtime deploys.

- **LB algorithms:** **round robin**. Rotate through servers in order (simple default); **least connections**. Pick the server with fewest active requests (better when request costs vary); **hash**. Hash user/IP to a server (use consistent hashing so adding a server doesn't reshuffle everyone).
- **L4 vs L7:** L4 balances on IP/port, fast, content-blind. L7 reads the HTTP request. Can route by path or cookie, slightly costlier.
- **Health checks:** the LB pings servers and pulls failures from rotation. This is what makes failover and zero-downtime deploys actually work.
- **Stateless app servers:** keep sessions in Redis, not on the box, so any server handles any request. Essential for horizontal scaling. Otherwise you need sticky routing (LB pins each user to one server).

**Vertical (scale up):** more CPU/RAM on one machine. Simple, no code change. But hard ceiling, single point of failure, expensive.
**Horizontal (scale out):** more machines. Needs stateless design; scales ~indefinitely; more ops complexity. **Preferred for production.**

---

## Database Replication

One **primary** takes all writes; **replicas** get async copies and serve reads.

```
Writes → Primary
Reads  → Replica 1, Replica 2
```

- **Read scaling:** add replicas. **HA:** promote a replica if the primary fails. **Analytics:** run heavy queries on a replica without slowing production.
- **Replication lag:** replicas trail by ms–seconds, so a read right after a write can be stale → eventual consistency at the DB layer.
- **Failover:** detect failure (heartbeat. A periodic "I'm alive" ping) → elect a new primary (consensus via Raft/ZooKeeper, or the managed DB does it) → repoint app/DNS.

---

## Caching

DB reads take 1-10ms; cache reads are <1ms (in-process) or ~0.5ms (Redis). For read-heavy workloads with repeated queries, caching is the highest-leverage win.

**Cache-aside (lazy loading), most common:**

```
check cache → HIT:  return value
            → MISS: query DB → populate cache → return
```

```python
def get_user(user_id):
    user = cache.get(f"user:{user_id}")
    if not user:
        user = db.query("SELECT * FROM users WHERE id = ?", user_id)
        cache.set(f"user:{user_id}", user, ttl=3600)
    return user
```

Pro: only requested data gets cached. Con: first read after a miss is slow; cache can go stale.

**Write-through:** write cache + DB together. Always fresh, but every write hits both and the cache fills with maybe-unread data.

**Write-behind (write-back):** write cache now, DB async later. Very fast writes; risk of data loss if the cache dies before flushing.

**Eviction:** **LRU** (drop least-recently-used. Most common, good for temporal locality), **LFU** (least-frequently-used), **TTL** (expire after a fixed time).

**Cache stampede (thundering herd):** a hot key expires and thousands of requests hit the DB at once. Fixes: probabilistic early refresh; mutex lock (one request refills, others wait or serve stale); stale-while-revalidate.

**CDN:** geo-distributed cache for static assets (images, JS, CSS, video). Users hit the nearest edge, not your origin.
- **Push CDN:** you push content to edges. Good for rarely-changing assets.
- **Pull CDN:** edge fetches from origin on a miss, then caches. Good for varied/dynamic access.
- **Cache-hit ratio:** aim >90%; a low ratio means too much origin traffic and defeats the point.

---

## Database Sharding

**Sharding** = horizontal partitioning: split one big table across DB instances (shards), each holding a subset of rows. E.g. users 1-1M on shard 1, 1M–2M on shard 2.

**Shard key** decides the shard; a bad one causes hotspots:
- `created_at` → all new writes hit the current shard while old shards sit idle.
- `user_id % N` → adding a shard changes N and remaps almost everything.
- **Better:** hash the key + consistent hashing → minimal remapping on resize.

**Problems sharding adds:**
- **Cross-shard joins:** joining tables on different shards means fetching from each and joining in the app. Expensive.
- **Cross-shard transactions:** ACID across shards needs distributed txns (2-phase commit), complex and slow.
- **Hotspots:** a celebrity on one shard overwhelms it. Mitigate with a random suffix on the key for hot entities.
- **Rebalancing:** adding/removing shards moves data. Almost all of it without consistent hashing, ~1/N with it.

**Consistent hashing:** map servers and keys onto a ring; a key goes to the first server clockwise. Add a server → only the keys between it and the previous server move. Remove one → only its keys move to the next server. ~1/N keys remap, not all.
**Virtual nodes:** give each physical server many ring positions for even load and fewer hotspots from uneven spacing.

---

## CAP Theorem (Applied)

CAP: during a network partition you can keep **C**onsistency **or** **A**vailability, not both. CP (consistent) vs AP (available).

- **Pick CP** when stale data costs money: payments, inventory ("1 left in stock"), seat booking, bank transfers.
- **Pick AP** when slight staleness is fine: social feeds, view counts, analytics, DNS, search indexes.
- **Middle ground:** most systems are AP for most data, CP only where it matters (e.g. AP feed, CP payments).

---$body$, step = 1
  WHERE title = 'Foundations & Building Blocks';

UPDATE questions.bank SET lesson_md = $body$For each: requirements → estimation → HLD → deep dives → bottlenecks.

---

## Design a Rate Limiter

**Algorithms:**
- **Token bucket:** bucket holds N tokens, refills R/sec; each request takes one, reject if empty. Allows bursts up to bucket size.
- **Leaky bucket:** requests queue and drain at a fixed rate; overflow is dropped. Smooth constant output, no bursts.
- **Fixed window counter:** count per window, reset at the boundary. Flaw: 100 at 11:59 + 100 at 12:00 = 200 in 2s across the boundary.
- **Sliding window counter:** weighted blend of current + previous window counts. Memory-efficient, no boundary flaw. **Best interview answer.**

**Architecture:**

```
Client → LB → [API Gateway + Rate Limiter] → Backend
                        ↕
            [Redis: counters per user/IP/route]
```

```
INCR   rate:{user_id}:{minute}        # atomic increment
EXPIRE rate:{user_id}:{minute} 120    # auto-clean old windows
```

- **Sliding count:** current minute + previous minute × overlap fraction (15s into the minute → current + 0.75 × prev). Reading only the current key = fixed window, with its boundary flaw.
- **Distributed gotcha:** per-node local counters let 3 nodes each allow the limit → 3× total. Fix: a shared Redis for all nodes (small latency cost, worth it for correctness).
- **Response:** `429 Too Many Requests` with `X-RateLimit-Limit / Remaining / Reset` headers.

---

## Design a Key-Value Store

**Requirements:** GET(key), PUT(key, value); billions of keys; high availability; tunable consistency.

- **Partitioning. Consistent hashing:** each key → first node clockwise on the ring; adding/removing a node remaps only ~1/N keys.
- **Replication:** store each key on N nodes (e.g. 3), primary + next N-1 clockwise. Survives node loss.
- **Quorum consistency:** N = replicas, W = write acks required, R = read responses required.
  - W + R > N → strong consistency; W + R ≤ N → eventual.
  - N=3: W=2, R=2 → strong, tolerates 1 failure. W=1, R=1 → fastest, eventual.
- **Conflict resolution:** LWW (timestamps. Simple, risks clock skew) or vector clocks ((node, counter) causality; return both versions when concurrent for the client to resolve).
- **Membership. Gossip:** nodes periodically share state with random peers; spreads in O(log N) rounds, no central coordinator. Used by Cassandra and Amazon's Dynamo.

---

## Design a URL Shortener

**Estimation:**
- 100M URLs/day ≈ 1,200 write QPS.
- 10:1 reads → 1B redirects/day ≈ 12K read QPS.
- 500 B/URL × 365B URLs (10 yrs) ≈ 180 TB.

**Short code:**
- **Hash:** MD5/SHA256 → take first 7 chars. Collisions possible → retry with an appended counter.
- **Base62 of auto-increment ID (preferred):** encode the DB's BIGINT id in [a-zA-Z0-9]. 62^7 ≈ 3.5T codes. No collisions, no retry logic. Con: sequential codes are guessable/enumerable, name it as a trade-off.

```sql
CREATE TABLE short_urls (
    id         BIGINT PRIMARY KEY AUTO_INCREMENT,
    short_code VARCHAR(8) UNIQUE NOT NULL,   -- hot-path index
    long_url   TEXT NOT NULL,
    user_id    BIGINT,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
);
```

- **301 vs 302:** 301 (permanent) is browser-cached → saves load but loses click analytics. 302 (temporary) hits your server every time → use it to track clicks.
- **Caching:** reads ≫ writes. Cache `short_code → long_url` in Redis (LRU); popular links never touch the DB.

---

## Design a News Feed

**Core decision, fan-out on write vs read:**
- **Write (push):** on post, precompute it into all followers' feeds (Redis sorted sets). Reads are instant; writes = N followers, so a 10M-follower celebrity = 10M writes per post. Too much.
- **Read (pull):** on feed load, query followed users' recent posts and merge. Writes are cheap; reads are expensive and degrade as you follow more people.
- **Hybrid (Twitter/Meta):** regular users (<~10K followers) → fan-out on write; celebrities → fan-out on read, merged at load. Fast reads for most, bounded write amplification.

**Feed storage:** Redis sorted set per user. Key `feed:{user_id}`, member `post_id`, score `timestamp`. `ZREVRANGE feed:{user_id} 0 19` → 20 latest post IDs, then fetch post data from cache/DB.

---

## Design a Notification System

```
Producers (Order/User svc) → Kafka topic "notifications"
                                  ↓
                Notification Service (consumer)
                reads event → looks up prefs → routes
                                  ↓
        Push (APNs/FCM)   Email (SendGrid)   SMS (Twilio)
```

- **Why Kafka:** decouples producers from delivery, buffers spikes, lets workers consume at their own pace, and enables retries from the queue.
- **Retry:** exponential backoff (1s, 2s, 4s, 8s… up to ~5 tries) → dead-letter queue.
- **Dedup:** retries can double-send; track a `notification_id` and check-then-mark-sent atomically (Redis SETNX or a DB unique constraint).
- **Preferences:** check do-not-disturb hours, unsubscribe flags, and channel choice before sending.

---

## Design a Web Crawler

```
Seed URLs → URL Frontier (priority queue) → Downloader → Parser
  → Seen-URL Filter (dedup) → Content Storage → Scheduler (re-crawl)
```

- **Dedup:** **bloom filter**. A tiny probabilistic set answering "definitely new" or "probably seen". For fast checks; canonical URLs in a DB for definitive ones.
- **Politeness:** per-domain rate limits, respect `robots.txt`, space out requests to the same host.
- **URL normalisation:** treat `Example.com/path?b=2&a=1` and `example.com/path?a=1&b=2` as one page before the dedup check.
- **Distributed:** workers pull from a shared frontier (Redis/Kafka), partitioned by domain hash so each worker owns certain domains (easier per-domain politeness).

---$body$, step = 2
  WHERE title = 'Classic HLD Problems';

UPDATE questions.bank SET lesson_md = $body$## Design a Chat System

**Requirements:** 1:1 + group chat, ordered delivery, presence, history, push for offline users.

**Protocol. WebSocket:** HTTP polling is high-latency and wasteful. WebSocket gives a persistent full-duplex connection; server and client can push anytime. At scale, clients land on different chat servers, so servers must route between each other.

```
Client A ─WS─► Chat Server 1 ─┐
Client B ─WS─► Chat Server 2 ─┤→ Message Queue (Kafka)
                               ↓
                       Message Service (store + route)
                               ↓
                       Chat DB (Cassandra)
                               ↓
                  Push Notification Service (offline users)
```

- **Routing across servers:** A→B on different servers via the queue (Server 1 → Kafka → Server 2 → WS to B), or a Redis presence service tells you B's server for direct routing.

**Storage. Cassandra** (write-heavy; always read by conversation + time range):

```sql
CREATE TABLE messages (
    conversation_id UUID,
    message_id      TIMEUUID,      -- time-sortable
    sender_id       UUID,
    content         TEXT,
    PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

Partition key `conversation_id` colocates a conversation; clustering key `message_id` keeps it time-sorted. `... WHERE conversation_id = ? LIMIT 20` is fast.

- **IDs. Snowflake:** 64-bit = unused sign bit (1) + timestamp (41) + datacenter (5) + machine (5) + sequence (12). Unique, ~time-sortable, no coordination. Auto-increment needs a central generator → bottleneck at scale.
- **Presence:** each connection heartbeats (~every 5s); store `presence:{user_id}` in Redis with a short TTL. No heartbeat → key expires → offline.
- **Offline:** store the message + send a push (APNs/FCM); on reconnect the client fetches messages since its last-seen timestamp.

---

## Design Search Autocomplete (Typeahead)

**Requirements:** top-K completions per prefix in <100ms, ranked by frequency.

**Trie (prefix tree):** stores strings by character path; each node is a character.

```
root → s → e → n → d    ("send")
            └→ a         ("sea")
       a → p → p → l → e ("apple")
```

Searching "se" walks to that node and returns the words below it. Traversing the subtree is slow for deep tries → **cache top-K at each node** (node "se" stores `["search", "send", "service"]`) so a lookup needs no traversal.

**Scale:**
- **Redis cache:** `prefix → [suggestions]`, warmed with top prefixes; most traffic hits the cache.
- **Distributed trie:** shard by prefix range (a–m, n–z).
- **Batch build:** don't update per search; aggregate query logs and rebuild the trie periodically (hourly/daily), then swap it in atomically.

```
type "se" → API → Redis GET autocomplete:se
   HIT  → return top-K
   MISS → trie service → cache result → return
Pipeline: search logs → Kafka → Spark (count freq, filter spam) → new trie daily
```

---

## Design YouTube (Upload & Streaming)

**Upload:** User → Upload Service → raw storage (S3) → async transcode to multiple resolutions (1080p/720p/360p) → CDN.
**Streaming:** User → nearest CDN edge → origin (S3 transcoded file) on a miss.

- **Chunked upload:** split multi-GB videos into 5-10MB chunks, upload each independently, reassemble server-side. Resumable. On failure re-upload only the failed chunk.
- **Transcoding pipeline:** CPU-heavy (a 1-hr video can take 30+ min). On "all chunks received", enqueue a job (SQS/Kafka); a worker pool runs FFmpeg → S3/CDN; update metadata → notify user. Each resolution is an independent job → transcode in parallel.
- **Adaptive bitrate (HLS/DASH):** split video into 2-10s segments; the player reads a manifest and switches resolution as the network changes. Smooth quality without buffering.
- **Metadata DB** (relational): `video_id, user_id, title, status (uploading/processing/published/failed), duration_s, view_count, created_at`. View counts are written constantly. Increment in Redis and flush periodically instead of hitting the row on every view (avoids hot-row contention).

---

## LLD, Design a Parking Lot

Tests OOP in a design context.

**Classes:**
- `ParkingLot` → floors; `getAvailableSpot(vehicle)`, `parkVehicle(vehicle) → Ticket`
- `Floor` → spots; `getAvailableSpot(VehicleType)`
- `ParkingSpot` → id, type (COMPACT/LARGE/HANDICAPPED/MOTORCYCLE), status (AVAILABLE/OCCUPIED/RESERVED), vehicle?
- `Vehicle` (abstract) → license_plate, type; subclasses Car, Truck, Motorcycle
- `Ticket` → id, spot, vehicle, entry_time, exit_time?
- `PaymentStrategy` → CashPayment, CardPayment; `calculate(ticket) → double`

**Patterns:** Strategy (payment method) · Singleton (`ParkingLotManager`) · Factory (`SpotFactory.create(VehicleType)`) · Observer (notify admin when a floor is full).

**Spot state machine:**

```
AVAILABLE ─park─► OCCUPIED ─leave─► AVAILABLE
    └─reserve─► RESERVED ─use─► OCCUPIED
```

---

## The Trade-offs Cheat Sheet

Name trade-offs unprompted. The single biggest differentiator.

| Decision | Trade-off |
|---|---|
| SQL vs NoSQL | ACID + complex queries vs scale + flexibility |
| Cache-aside vs write-through | Stale data vs write overhead |
| Fan-out on write vs read | Fast reads vs write amplification (celebrities) |
| Strong vs eventual consistency | Correctness vs availability + latency |
| Normalised vs denormalised | Storage + integrity vs query speed |
| Monolith vs microservices | Simplicity vs independent scaling + deploy |
| Sync vs async | Simplicity vs throughput + resilience |
| Push vs pull notifications | Latency vs complexity + missed messages |
| 301 vs 302 redirect | Less server load vs analytics visibility |
| Short vs long TTL | Fast propagation vs more query load |

---

## Full Framework, Worked Example

**"Design a chat system for 50M DAU."**

1. **Clarify:** 1:1 or groups? Max group size? History + retention? Presence? Acceptable latency?
2. **Estimate:** 50M DAU × 20 msgs/day = 1B msgs/day ≈ 12K write QPS. ~200 B/msg → 200 GB/day → ~365 TB over 5 yrs.
3. **HLD:** WebSocket to chat servers → message queue (decouple/buffer) → Cassandra (write-heavy, partition by conversation) → Redis (presence + recent cache) → push service for offline.
4. **Deep dive (pick 2):**
   - *Storage:* Cassandra keyed `(conversation_id, message_id TIMEUUID)`. Partition colocates a conversation, TIMEUUID gives time-sorted reads for free.
   - *Presence:* heartbeat every 5s; `presence:{user_id}` in Redis with a 10s TTL; no heartbeat → key expires → offline. Self-cleaning.
5. **Bottlenecks:** WebSocket connections can saturate one server → scale out, route by consistent hashing (user_id → server), cross-server via Kafka. Very large groups (>500) → fan-out on read.

---$body$, step = 3
  WHERE title = 'More Systems + LLD + Trade-offs';

UPDATE questions.bank SET lesson_md = $body$## Concept 1. Authentication vs Authorization (know this cold)

These sound alike but are different:

- **Authentication (authN)** = *who are you?*. Proving your identity (logging in with a password).
- **Authorization (authZ)** = *what are you allowed to do?*. Checking your permissions after you've logged in.

**Analogy:** at a concert, **authentication** is the bouncer checking your ID at the door. **Authorization** is whether your ticket lets you into the VIP area. Different checks.

## Concept 2. Storing passwords (a classic question)

If someone steals your database, they shouldn't get everyone's passwords. So:

- **Never store the plain password.** (Obvious once you say it.)
- **Don't "encrypt" it either**: encryption can be reversed.
- **Hash it.** A **hash** is a one-way function: easy to go password → scrambled output, practically impossible to go back. **Analogy: a blender.** You can blend a smoothie; you can't un-blend it back into fruit.
- Use a **slow, salted** hash. The named tools are **bcrypt, scrypt, Argon2**.
  - **Salt** = a random value added to each password before hashing, so two people with the same password get different hashes. Stops attackers using precomputed lists ("rainbow tables").
  - **Slow** = deliberately takes a moment to compute, so an attacker can't try billions of guesses per second.$body$, step = 1
  WHERE title = 'Authentication, Authorization & Password Storage';

UPDATE questions.bank SET lesson_md = $body$## Concept 3. Staying logged in: Sessions vs Tokens

After you log in, how does the site remember you on the next click?

- **Session**: the server keeps a note ("user #42 is logged in") and hands your browser a **session ID** (stored in a cookie. Mark it **HttpOnly** so page scripts can't steal it). Easy to cancel (delete the note), but the server has to store all these notes.
- **Token (JWT)**: the server gives your browser a signed pass it can verify later without storing anything. **JWT = JSON Web Token.** Scales nicely (server stores nothing), but **hard to cancel early**, so you keep them short-lived.
- **OAuth**: lets one app act on your behalf on another without ever seeing your password (delegated *authorization*). "Log in with Google" is **OpenID Connect (OIDC)**, a login layer built on top of OAuth. (Gotcha interviewers like: OAuth itself is authZ, not login.)

## Concept 4. HTTPS / TLS (encrypting data on the wire)

When data travels over the internet, others on the network could read or tamper with it. **HTTPS** prevents that.

- **TLS** is the technology that encrypts the connection. **HTTPS = HTTP + TLS** (the padlock in your browser).
- Two useful phrases: **encryption in transit** (protecting data while it travels. That's TLS) vs **encryption at rest** (protecting data while it's stored in a database/disk).
- Rough mechanics (enough for an interview): the browser and server do a **handshake** to agree on a secret key, then encrypt everything with it. A **certificate** (issued by a trusted authority) proves the server really is who it claims to be. So you're not talking to an imposter.$body$, step = 2
  WHERE title = 'Sessions, Tokens & HTTPS';

UPDATE questions.bank SET lesson_md = $body$## Concept 5. The attacks you must be able to explain

From the OWASP list, these four come up most:

- **SQL Injection**: the app builds a database query by gluing user input directly into it, so a sneaky input becomes *commands* instead of *data* (e.g. typing something that makes the query dump the whole table). **Fix: parameterized queries** (a.k.a. prepared statements). The database treats input strictly as data, never as commands. Never build queries by string-concatenation.

- **XSS (Cross-Site Scripting)**: an attacker gets their `<script>` to run inside another user's browser on your site (e.g. via a comment box), stealing data or sessions. **Fix: escape/sanitize anything user-supplied before showing it**, and use a Content-Security-Policy.

- **CSRF (Cross-Site Request Forgery)**: while you're logged into your bank, a malicious page tricks your browser into quietly sending a request to the bank using your existing login. **Fix: CSRF tokens and SameSite cookies** so requests must prove they came from your real site.

- **Broken access control**: a logged-in user reaches data they shouldn't, e.g. changing `?id=42` to `?id=43` in the URL to see someone else's info. **Fix: check permissions (authZ) on every request, on the server. Never trust the client.**

*(XSS vs CSRF confusion is common: XSS = attacker's **script runs in the page**. CSRF = attacker **rides your existing login** to send a request. Different.)*

## Concept 6. Safe-default habits (sprinkle these into any answer)

- **Least privilege**: give each user or service the *minimum* access it needs, nothing more.
- **Never trust user input**: always validate and clean it on the server.
- **Defense in depth**: use several layers; don't rely on a single lock.
- **Don't invent your own crypto**: use trusted, battle-tested libraries.
- **Keep secrets out of code**: never hardcode passwords/keys or commit them; use environment variables or a secrets manager.$body$, step = 3
  WHERE title = 'Common Attacks & Safe Defaults';

UPDATE questions.bank SET lesson_md = $body$## First, three words you'll hear

- **Stack trace**: the error report your program prints when it crashes. It lists the chain of function calls that led to the crash, with file and line numbers (Python prints the most recent call *last*; Java/JavaScript print it *first*). It usually tells you *what* went wrong and *where*. **Read it, don't skim it.**
- **Breakpoint**: a marker you place on a line of code that tells the debugger "pause here." When the program reaches it, it freezes so you can look around.
- **Stepping**: once paused, you run the program **one line at a time** ("step over") and watch how the values change. This is how you catch the exact moment things go wrong.

## The Method (memorize this. It's your answer to "how do you debug?")

1. **Reproduce it.** A bug you can't trigger on demand, you can't fix. Find the exact input or steps that cause it, reliably.
2. **Read the error.** The stack trace tells you what and where. Start at the most recent call that's in *your* code (skip the library lines).
3. **Form a hypothesis.** A specific, testable guess: "I bet this value is empty here" or "I think this loop runs one time too many."
4. **Isolate. Binary search the problem.** Cut the search area in half repeatedly: check the middle. Is the bug before or after this point? Add a print or breakpoint there and narrow down until you're on the exact line. (Same trick as `git bisect`, which finds the exact commit that introduced a bug.)
5. **Check your assumptions.** The bug is almost always hiding in something you *assumed* was true. Print the actual value. Is the input what you expected? Is this code even running?
6. **Fix, then verify.** Confirm the fix on your repro. Then ask "could this same bug be elsewhere?" and add a test so it can never come back.

One-liner if asked: **reproduce → read the error → hypothesize → binary-search to isolate → check assumptions → fix + add a test.**

## Two tools: Print vs Debugger

- **Print/log statements**: drop `print(x)` to see values. Fast, works anywhere (even in production). Downside: messy, and you have to re-run.
- **Debugger (breakpoints)**: pause the program and inspect *everything* live, step line by line. Best for tricky local logic.
- Good answer: *"I start with prints to narrow down where it goes wrong, then switch to a debugger to inspect the state once I'm close."*

👉 **Practice this hands-on:** open `debug-practice.py` in this folder and follow the instructions at the top. It has real bugs for you to find with the VS Code debugger. See `HOW-TO-DEBUG-IN-VSCODE.md` for setup.

You need this once. After that, debugging is just pressing **F5**.

## One-time setup

1. **Install the Python extension.** Open VS Code → Extensions (the square icon on the left, or `Ctrl+Shift+X`) → search **"Python"** (by Microsoft) → Install. This also gives you the debugger.
2. **Open this project folder** in VS Code (`File > Open Folder…` → pick `interview-prep`). A `.vscode/launch.json` is already set up for you, you don't need to create it.
3. That's it.

## The debug loop (do this for each bug)

1. Open `DEBUGGING/debug-practice.py`.
2. Press **F5**. The tests run and print `PASS`/`FAIL` in the terminal at the bottom.
3. Pick a **FAIL**ing function. Find its line in the file.
4. **Set a breakpoint:** click in the empty margin just left of a line number. A **red dot** appears. Put it on the first interesting line of that function.
5. Press **F5** again. The program runs, then **pauses** at your red dot (the line highlights).
6. Look at the **VARIABLES** panel (top-left). It shows every variable's current value *right now*.
7. Press **F10** ("Step Over") to run the next line. Watch the variables change. Keep pressing F10.
8. Find the exact line where a value becomes *wrong*, that's the bug.
9. Fix the code, press **F5**, and confirm the test now says **PASS**.

## The buttons you'll use

| Key | Button | What it does |
|---|---|---|
| **F5** | ▶ Continue | Start, or run until the next breakpoint |
| **F10** | ⤵ Step Over | Run the current line, pause on the next |
| **F11** | ↓ Step Into | Go *inside* the function on this line |
| **Shift+F5** | ■ Stop | Stop debugging |

## Panels to know

- **VARIABLES** (top-left), live values while paused. Your main tool.
- **WATCH**: type an expression (e.g. `total + count`) to track it continuously.
- **CALL STACK**: the chain of function calls that got you here (a live stack trace).
- **DEBUG CONSOLE** (bottom). While paused, type any Python expression to inspect it, e.g. `user` or `len(numbers)`.

## Tip

The skill isn't the buttons. It's **forming a guess before you step** ("I bet `i` never reaches 5"), then using the debugger to confirm or kill that guess. That's step 3 of the method in `debugging-overview.md`.$body$, step = 1
  WHERE title = 'A Systematic Debugging Method';

UPDATE questions.bank SET lesson_md = $body$## Common Bug Types (learn to spot these fast)

- **Off-by-one**: being one off in a count or index: `<` vs `<=`, or reading one past the end of a list. The #1 bug in coding interviews.
- **Null / None**: using a value that was never set, or a lookup that found nothing.
- **Edge cases**: empty input, a single item, duplicates, negatives, the maximum size. Always test these.
- **Aliasing / shared references**: two names point at the *same* object, so changing one "mysteriously" changes the other.
- **Race conditions**: a timing bug from two things touching shared data at once; hard to reproduce (see the OS notes on locks).
- **Type / overflow**: a number too big for its type, or mixing up a string `"5"` with the number `5`.$body$, step = 2
  WHERE title = 'Common Bug Types & Isolating Them';

UPDATE questions.bank SET lesson_md = $body$## Production Debugging (mention for extra credit)

- **Logs**: recorded messages with request IDs so you can trace what happened after the fact.
- **Metrics**: dashboards showing error rates and latency, so you spot *when* it started.
- **Distributed tracing**: following a single request as it hops across multiple services to find which hop failed.$body$, step = 3
  WHERE title = 'Debugging in Production';

UPDATE questions.bank SET lesson_md = $body$## Start Here: What is an "AI tool," really?

A **Large Language Model (LLM)**, like the one behind ChatGPT, Claude, or GitHub Copilot, is a program that predicts text. Think of it as **autocomplete on steroids**: you give it words, it predicts the most useful words to come next. Trained on enormous amounts of text, that simple idea is powerful enough to write code, explain errors, and answer questions.

An **AI coding assistant** (Claude Code, Cursor, GitHub Copilot) is an LLM wired into your editor. You ask, it writes code / tests / explanations. **You stay in charge**: you read what it wrote and decide if it's right. That last sentence is the single most important thing to say in an interview.

## The words you need

- **Prompt**: the instruction you type to the AI. "Write a function that reverses a string." A *good* prompt is specific and gives an example of what you want.
- **Context**: the background info you hand the AI along with your prompt: the relevant code file, the error message, the rules it must follow. **The AI can only be as good as the context you give it.** Give it junk → you get junk. "Context engineering" just means being deliberate about what info you feed it.
- **Token**: how the AI chops up text. Roughly ¾ of a word = one token. You'll see the word "tokens" a lot; it just means "pieces of text."
- **Context window**: how much text the AI can "hold in its head" at once, measured in tokens. Like short-term memory. If you dump too much irrelevant stuff in, quality drops. Another reason to give it *only* what matters.
- **Prompting vs fine-tuning**: two ways to get an AI to do what you want. **Prompting** (just asking well, plus RAG) is cheap and needs no training. **Fine-tuning** means actually retraining the model on your data for a narrow task. Expensive, and only worth it when prompting genuinely isn't enough. Default to prompting.$body$, step = 1
  WHERE title = 'LLMs, Prompts & Context';

UPDATE questions.bank SET lesson_md = $body$## The words you need

- **RAG (Retrieval-Augmented Generation)**: a technique: instead of pasting a whole 500-page manual into the prompt, you first *retrieve* just the few relevant paragraphs and give the AI those. How AI tools answer questions over big or private data without seeing all of it at once.
- **Agent**: an AI that doesn't just answer once, but works in a **loop**: it takes an action (read a file, run a command), looks at the result, and decides the next step. Repeating until the task is done. Claude Code is an agent: it can edit files and run tests on its own, checking as it goes.
- **Orchestration**: a fancy word for *coordinating multiple steps or multiple agents* to finish a bigger task. If someone asks, "wiring several AI steps together into one workflow" is a fine answer.
- **Prompting vs fine-tuning**: two ways to get an AI to do what you want. **Prompting** (just asking well, plus RAG) is cheap and needs no training. **Fine-tuning** means actually retraining the model on your data for a narrow task. Expensive, and only worth it when prompting genuinely isn't enough. Default to prompting.$body$, step = 2
  WHERE title = 'Agents, RAG & Fine-tuning';

UPDATE questions.bank SET lesson_md = $body$## The words you need

- **Hallucination**: when the AI makes something up and states it confidently, e.g. inventing a function that doesn't exist. This is the #1 risk. **Always verify** its output; never trust it blindly on anything important.

## Responsible AI (Meta asks about this by name, easy points)

Just common sense, stated clearly:

- **Verify before you ship.** The AI can be confidently wrong. Read and test its output. You own the code, not the model.
- **Never paste secrets.** Don't put passwords, API keys, or customer data into a prompt.
- **Keep a human in the loop** for anything that matters. AI assists the decision; it doesn't make it.
- **Watch for bias**: AI trained on internet data can carry the internet's biases; sanity-check outputs that affect people.$body$, step = 3
  WHERE title = 'Hallucination & Responsible AI';

UPDATE questions.bank SET lesson_md = $body$## What Google vs Meta Actually Test

Different interviews. Knowing the difference lets you prep the right stories.

| | **Google, Googleyness & Leadership** | **Meta, Core Values** |
| --- | --- | --- |
| Format | 1 round, ~4 questions | 1 round in the new-grad loop, ~3-4 questions |
| Evaluates | Googleyness (collaboration, ambiguity, integrity) + Leadership (ownership, impact). Whole loop is scored on 4 attributes: GCA (general cognitive ability), role knowledge, leadership, Googleyness. | The 6 core values: Move Fast · Focus on Long-Term Impact · Build Awesome Things · Live in the Future · Be Direct & Respect Your Colleagues · Meta, Metamates, Me. Map each story to one. |
| Tone | Conversational, they probe how you think | Direct, they want crisp, outcome-focused answers |
| Differentiator | Humble, self-aware, defaults to collaboration | Biases toward action, measures impact |
| Red flag | Taking all credit, blaming others, not owning mistakes | Vague outcomes, no data, process over results |

## The STAR Framework

Every story uses this. Total answer 2-3 min. Interviewers probe each section.

| **Letter** | **Section** | **Cover this** | **Time** |
| --- | --- | --- | --- |
| **S** | Situation | Set the scene in 2-3 sentences: project, what was at stake, what made it hard. | ~20s |
| **T** | Task | YOUR specific responsibility, not the team's. | ~10s |
| **A** | Action | The meat. What you did, step by step, with trade-offs considered. | ~90s |
| **R** | Result | Quantified outcome. What changed, what you learned, what you'd do differently. | ~30s |$body$, step = 1
  WHERE title = 'STAR & What Each Company Tests';

UPDATE questions.bank SET lesson_md = $body$## Your Story Bank, 9 Competencies

Fill every scaffold; one strong story can cover two competencies, so 6-8 distinct stories is enough. Spread them across projects. Don't pull more than ~3 from one source.

*Projects to draw from: sgmalls · PeerPrep · Aqua Vitae Parfums · NUS coursework · TA/leadership.*

**1. Ownership / Taking Initiative**
- **Asks:** G. *something outside your core responsibilities.* / M. *took ownership of a project end to end.*
- **Mine + prompts:** sgmalls (sole engineer, schema to deployment), Aqua Vitae (solo build). What did you pick up that wasn't your job, and why? What did you decide autonomously, and what trade-offs (Astro vs Next.js, D1 vs Postgres)?
- **Your story:** ________________________________________

**2. Technical Trade-off / Ambiguity**
- **Asks:** G. *a technical decision with incomplete information.* / M. *move fast without all the information you wanted.*
- **Mine + prompts:** sgmalls (static vs dynamic pages, shard strategy), PeerPrep (microservices), MT5 optimizer. What made it hard, and what were the options and unknowns? Did you prototype or consult anyone? When did you stop researching and commit?
- **Your story:** ________________________________________

**3. Failure / Learning from Mistakes**
- **Asks:** G, *a time you failed. What did you learn?* / M. *something you built didn't go as planned.*
- **Mine + prompts:** A prod bug, a missed deadline, an architectural regret, an underperforming project. What went wrong. Technical, process, or judgment? (Be honest; interviewers spot a spun non-failure.) How did you course-correct, and what concretely changed in how you work?
- **Your story:** ________________________________________

**4. Disagreement / Pushback**
- **Asks:** G. *disagreed with a teammate or manager.* / M. *influence someone who didn't report to you.*
- **Mine + prompts:** PeerPrep architecture disagreements, a group-project conflict, pushing back on a prof/TA. What was the disagreement and the other side's position? How did you raise it, with what evidence? Escalate, or disagree and commit (back it anyway)?
- **Your story:** ________________________________________

**5. Collaboration / Impact on Team**
- **Asks:** G. *helped a teammate grow or succeed.* / M. *made the people around you more effective.*
- **Mine + prompts:** PeerPrep (code reviews, unblocking others), tutoring/TA, hackathon teams. Was someone stuck, behind, or missing context? What did you do. Pair, review, document, mentor, restructure? Outcome for them and the project?
- **Your story:** ________________________________________

**6. Navigating Ambiguity / Undefined Problems**
- **Asks:** G. *a problem with no clear answer.* / M. *figure out what to build when requirements weren't clear.*
- **Mine + prompts:** sgmalls SEO strategy (no playbook), Aqua Vitae product decisions, hackathon scoping. What was undefined, and why couldn't you just ask for clarity? How did you structure it. Set constraints, run experiments, talk to users? What shipped, and how did it turn out?
- **Your story:** ________________________________________

**7. Delivering Impact / High-Stakes Project**
- **Asks:** G, *your most impactful project. Why?* / M. *go above and beyond to deliver.*
- **Mine + prompts:** sgmalls (12,630 static pages, Google indexing), PeerPrep (production microservices), Aqua Vitae launch. Quantify everything (pages, users, load time, uptime, time saved). Why did it matter beyond finishing? Hardest technical part, and what did you do that a less experienced engineer wouldn't?
- **Your story:** ________________________________________

**8. Prioritisation / Saying No**
- **Asks:** G. *prioritise ruthlessly under time pressure.* / M. *hard trade-offs about what to build.*
- **Mine + prompts:** sgmalls launch cuts, balancing coursework + projects + job search, hackathon scoping. What competed for your time or scope? What criteria did you use to cut or defer? Who was affected, and was the call right in hindsight?
- **Your story:** ________________________________________

**9. Receiving Feedback**
- **Asks:** G, *hard feedback you received. What did you do with it?* / M. *someone was direct with you about a real problem.*
- **Mine + prompts:** PeerPrep code-review pushback, a prof/TA critique, user complaints on sgmalls/Aqua Vitae. What was the feedback, and your honest first reaction? What did you change, and how did they know you'd heard them? Pick something that stung, not cosmetic notes.
- **Your story:** ________________________________________$body$, step = 2
  WHERE title = 'The Competencies You Will Be Asked About';

UPDATE questions.bank SET lesson_md = $body$## 1-Day Prep Plan

One focused day is enough.

| Morning (2h) | Fill in all 9 scaffolds as bullet notes. Force a number into each (pages, hours saved, % improvement, team size). Reusing one project for more than ~3 stories? Redistribute. |
| --- | --- |
| Afternoon (2h) | Say each story aloud, full STAR, timed to 2-3 min. Record 3 and play back, natural or rehearsed? Mock with a friend or AI and have them probe with follow-ups. |
| Exit goal | Deliver any of the 9 stories in under 3 min, with a specific result, without notes. |

## Critical Rules

- **Always have a number.** "Improved performance" loses to "cut p99 latency 800ms → 120ms". Approximate is fine; no number = weak result.
- **Own your part.** Use "I" for actions, "we" only for outcomes. "We decided" loses attribution.
- **Failure stories must show change.** A vague lesson is worse than no failure story. Say exactly what you changed.
- **Don't over-rehearse.** Scripted sounds fake. Know the skeleton cold; improvise the words.
- **Google: lead with collaboration**, not heroic solo effort.
- **Meta: lead with outcome**, then explain how you got there.
- **Prepare for follow-ups.** Expect "Why that approach?", "What would you do differently?", "What did others think?" Your skeleton needs that depth.$body$, step = 3
  WHERE title = 'Delivering an Answer That Lands';

-- Every row must have both, or a step page renders an empty lesson.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM questions.bank WHERE lesson_md IS NULL OR step IS NULL) THEN
    RAISE EXCEPTION 'a question set was left without a lesson or a step';
  END IF;
END
$check$;
