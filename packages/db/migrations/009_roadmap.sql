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
--
-- Lesson bodies are written in the plain register of
-- docs/learning/websockets.md: every `##` section opens with a one-or-two
-- sentence big-picture statement, then the concrete problem, then the
-- mechanism, with terms defined in brackets at first use. The step page shows
-- one `##` section per screen, splitting on those headings, and code lines
-- stay under 78 characters so nothing scrolls sideways. No analogies, and no
-- em or en dashes (a questions-service test asserts the em dash against the
-- database).

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
  ('os', 'Operating Systems', 'How a computer runs more than one program at once, and what that costs. This is where the path starts: nearly everything below leans on knowing what a process, a thread and memory really are.', ARRAY[]::text[], 4, 0)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('networking', 'Networking', 'What actually happens between typing a web address and seeing a page. Much easier to follow once processes and sockets are familiar.', ARRAY['os']::text[], 2, 1)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('oop', 'Object-Oriented Programming', 'How to organise code so it stays possible to change. The one topic here about the code you write rather than the machine underneath it, which makes it a good change of pace.', ARRAY['os']::text[], 6, 1)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('databases', 'Databases', 'How data is stored so it can be found again quickly and survives a crash. Indexes and transactions land much better with the memory and disk material already in mind.', ARRAY['networking']::text[], 1, 2)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('security', 'Security', 'How accounts, passwords and connections are kept safe, and the handful of attacks worth being able to explain. Most of it is networking seen from the other side.', ARRAY['networking']::text[], 4, 2)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('system-design', 'System Design', 'Putting the pieces together into something that serves a lot of people at once. It sits here because it is mostly everything above it applied at scale.', ARRAY['databases', 'security', 'debugging']::text[], 4, 3)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('debugging', 'Debugging', 'A method for working out why something is broken instead of guessing. Short, practical, and the topic that pays off the same day you read it.', ARRAY['oop']::text[], 7, 2)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('ai-tooling', 'AI Tooling', 'What the tools you already use are actually doing, and how to talk about using them well. Nothing depends on it, so it sits near the end where you can pick it up whenever you like.', ARRAY['system-design']::text[], 2, 4)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('behavioural', 'Behavioural', 'How to tell the story of your own work so an interviewer can follow it. It sits at the end because nothing depends on it, but it is worth starting long before you reach it: good answers come from remembering rather than cramming.', ARRAY['system-design']::text[], 6, 4)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

UPDATE questions.bank SET lesson_md = $body$## What a Process Is

One machine runs many programs by pausing and resuming them fast, and the process is the unit that makes pausing possible. This section is about what exactly is inside that unit.

### Start with the problem

Right now your laptop is running Chrome, Spotify, a terminal and a few dozen background programs. It probably has about 8 CPU cores [a core is one circuit that executes one stream of instructions], and a core can only ever be running one of them at any instant. So the machine is outnumbered: many programs, few cores, and yet everything appears to run at once.

The OS pulls this off by **time sharing**: run one program for a few milliseconds, pause it, run another, come back to the first, and switch fast enough that no human can see the gaps. Done well, every program behaves as if it had a CPU to itself. That illusion is called **CPU virtualization**.

Pausing is the hard part. To resume a program later, exactly where it left off, the OS has to capture everything the program was in the middle of. The thing it captures is the whole idea of a **process: a program in execution**. A program on disk is just bytes. Load those bytes into memory and start running them, and you have a process.

### The map (draw this once)

```
 high addresses  +----------------+
                 |     stack      |  locals, parameters, return addresses
                 |       v        |  grows down, managed automatically
                 |                |
                 |       ^        |
                 |      heap      |  malloc/new, grows up, managed by hand
                 +----------------+
                 |  static data   |  globals and initialized statics
                 +----------------+
                 |      code      |  the compiled instructions
 low addresses   +----------------+
```

This is one process's **address space**: the memory that belongs to it and nobody else. The stack pushes a frame on every function call and pops it on return, so it manages itself. The heap is the memory the program asks for explicitly and must manage by hand.

### What a process is made of

Three parts define a process's **machine state**: what you would need to freeze one and resume it perfectly.

**1. The address space** in the map above. While the process is paused, this simply stays where it is in RAM; nothing needs copying.

**2. The CPU registers** [the handful of storage slots inside the CPU itself that instructions operate on]. Three matter by name: the **program counter (PC)** holds the address of the next instruction, so it is literally "where the program is up to"; the **stack pointer** marks the top of the stack; the general-purpose registers hold whatever values were being computed. These must be copied out when the process is paused, because the next program to run will overwrite every one of them.

**3. The open file descriptors** [a file descriptor is a small number the OS gives a program as its handle on an open file, socket or pipe]. Every UNIX process starts with three: 0 is standard input, 1 is standard output, 2 is standard error. The table mapping the numbers to real files lives inside the OS, so pausing does not disturb it.

### How the OS creates a process

1. Load the code and static data from disk into a fresh address space. Lazily: only the pieces the program actually touches get loaded.
2. Set up a stack, with `argc`/`argv` on it so `main()` receives its arguments.
3. Set up a small initial heap; it grows on demand as `malloc` needs more.
4. Open the three standard file descriptors.
5. Jump to `main()`.

### The three states

Here is the scenario that forces states to exist. A process asks the disk for a block of data. The disk takes milliseconds to answer, and a millisecond is millions of CPU cycles. Letting the process keep the CPU while it waits would waste almost all of the machine, so the OS sets it aside and gives the CPU to someone else.

A process is always in exactly one of three states:

```
RUNNING <-> READY     scheduled / descheduled by the OS
RUNNING  -> BLOCKED   asked for I/O, cannot continue until it finishes
BLOCKED  -> READY     the I/O completed
```

- **Running**: on a CPU at this instant.
- **Ready**: could run, but the OS picked someone else for now.
- **Blocked**: waiting on hardware (disk, network, a timer). It cannot run even if every CPU is idle, because the answer it needs has not arrived. When the answer arrives it becomes Ready, not Running: it queues up with everyone else.

The distinction interviewers probe: **blocked cannot run, ready could run**. One is waiting on hardware, the other is waiting its turn.

There is a fourth, stranger state. A process that has exited, but whose parent has not yet asked how it went, is a **zombie**. It uses no CPU and no memory; only its bookkeeping entry stays behind, so the parent can still read its exit code. The parent's `wait()` call (next section) is what clears it away.

### The PCB

All of this needs a home inside the OS. The per-process record is the **Process Control Block (PCB)**, also called the process descriptor: the state, the **PID** [process ID, the number that names this process], the saved registers, the open-file table, memory bounds, and who the parent is. Every PCB sits in one big **process list**. Pausing a process means writing its registers into its PCB; resuming means loading them back out.

> **Interview phrasing:** "A context switch serializes CPU state into the outgoing process's PCB and deserializes the incoming one's."

## The Process API: fork, exec, wait

Every new running program on UNIX starts as a copy of an existing process that then swaps in a different program. The three calls here, fork, exec and wait, are that whole story.

### Start with what the shell has to do

Type `ls` and press enter. The shell [the program reading your commands] is one process. `ls` has to become another, and the shell must survive it and print the next prompt. So the shell needs to create a process, run a different program inside it, and learn when it finishes. UNIX gives it three calls, and the strange way the work is split between them turns out to be the point.

### fork(): one process becomes two

`fork()` makes a near-exact copy of the calling process. The caller is the **parent**, the copy is the **child**, and both continue from the line after the call. One call, two returns: the parent gets the child's PID back, the child gets 0. That return value is the only way each copy can tell which one it is.

```c
int pid = fork();
if (pid < 0)       { /* fork failed */ }
else if (pid == 0) { /* I am the child */ }
else               { /* I am the parent; pid is the child's PID */ }
```

Copying sounds expensive: if a browser using gigabytes of memory forks, does the OS duplicate it all? No. The child's address space is built with **copy-on-write**: parent and child share every page of memory, marked read-only, and only when one of them writes to a page does the OS copy that single page. The copying is deferred to the writes that actually happen, and for the common fork-then-exec pattern, mostly never happens.

One trap: after `fork()`, nothing says whether the parent or the child runs first. The OS may schedule either. Never assume an order without `wait()`.

### wait(): the parent pauses until a child exits

```c
if (fork() == 0) { /* child work */ exit(0); }
else             { wait(NULL); /* runs only once the child is done */ }
```

`wait()` blocks the parent until a child finishes and hands back its exit status. It is also the cleanup: an exited child stays a **zombie**, exit code intact, until its parent collects it with `wait()`. If the parent exits first, the child is an **orphan** and gets adopted by `init` [the first process, PID 1], which calls `wait()` on the children it inherits so orphans do not pile up as zombies.

### exec(): same process, new program

`fork()` can only make more copies of the shell. `exec()` is the other half: it **replaces** the calling process's program. The old code, stack and heap are thrown away and the new program starts from its own beginning.

```c
execvp("ls", args);
printf("this line never runs if exec succeeds\n");
```

On success `exec()` never returns, because the code that called it no longer exists. Two things survive the replacement: the **PID stays the same** (no new process was created), and the **open file descriptors stay open**. That second one looks like trivia and is actually the trick behind the whole design.

### Why fork and exec are separate calls

Because the gap between them is where the shell rearranges the world before the new program starts. The child that `fork()` made is still running shell code, so it can re-plumb its own file descriptors, then call `exec()`.

That is exactly how `ls > out.txt` works:

```c
if (fork() == 0) {
    close(STDOUT_FILENO);                 /* free descriptor 1 */
    open("out.txt", O_CREAT|O_WRONLY);    /* open() hands out the lowest free number: 1 */
    execvp("ls", args);                   /* ls keeps the descriptors it inherited */
}
```

`ls` never knows. It writes to descriptor 1 as always; descriptor 1 simply is a file now. Pipes are the same move: `pipe()` creates a connected pair of descriptors, and for `ls | grep foo` the shell forks twice and wires the write end into one child's descriptor 1 and the read end into the other's descriptor 0 before either child execs.

> **"What happens when you type `ls`?"** The shell `fork()`s. The child sets up any redirection, then `exec()`s `ls`. The parent `wait()`s. `ls` runs and exits, `wait()` returns, and the shell prints the next prompt.

## Syscalls and Context Switches

Programs run directly on the CPU for speed, and two hardware mechanisms (the trap and the timer interrupt) guarantee the OS always gets the machine back. This section is how that deal works.

### The tension

For speed there is no substitute for running a program's instructions directly on the CPU. But while a program runs, the OS is not running: it is just code sitting in memory, and code that is not running controls nothing. So what stops the program from reading another process's memory, writing over the disk, or simply never giving the CPU back?

The scheme every real OS uses is **Limited Direct Execution**: run programs directly on the CPU, but have the hardware itself enforce the limits.

### Two modes

The CPU has a mode bit.

| | User mode | Kernel mode |
|---|---|---|
| Who runs there | ordinary processes | the OS kernel |
| Allowed | ordinary computation only | everything: I/O, memory mapping, switching processes |

A privileged operation attempted in user mode does not just fail; it **traps**, meaning the hardware stops the program and drops into the OS. So when a process needs something privileged (read a file, send a packet, create a process) it must ask the OS to do it, through a **system call**.

### A system call, step by step

1. The process puts the **syscall number** [each service the kernel offers has a number: one for read, one for fork, and so on] in a register and executes the special `trap` instruction.
2. The hardware saves the process's registers onto that process's **kernel stack**, flips the mode bit to kernel, and jumps to a fixed OS entry point, the **trap handler**.
3. The OS looks the number up in the **trap table**, which it filled in once at boot, and runs the matching handler.
4. When the handler finishes, the OS executes **return-from-trap**: registers restored, mode bit back to user, execution resumes at the instruction after the trap.

Why pass a number instead of jumping to a kernel address? Security. If a process could name the address, it could jump to the instruction just after a permission check. With a number, the kernel owns the table and therefore every possible entry point. A process can request a service; it cannot choose where the kernel starts running.

### Getting the CPU back

A system call hands over control voluntarily. But a process stuck in `while(1);` makes no system calls, and if voluntary handover were the only path into the OS, that loop would own the core forever.

The fix is the **timer interrupt**. At boot, the OS programs a hardware timer to fire every few milliseconds. When it fires, the hardware does the same dance as a trap: save registers, switch to kernel mode, jump into the OS. Now the OS is running, regardless of what the process was doing, and it chooses: resume the same process, or switch to another.

### The context switch

When the OS decides to switch from process A to process B:

1. Save A's registers into A's PCB.
2. Restore B's registers from B's PCB.
3. Switch to B's kernel stack.
4. Return-from-trap. The CPU is now running B, exactly where B was paused.

Keep the two save/restore events straight, because interviewers do: the **hardware** saves user registers to the kernel stack when the trap or interrupt happens, and the **OS** saves kernel registers to the PCB only if it then decides to switch processes.

Why are context switches called expensive? Three costs, and the register copying is the smallest:

- Saving and restoring registers takes time.
- **Cold caches**: the CPU caches (L1/L2/L3) [small, fast memory holding recently used data] are warm with A's data. B starts by missing in all of them.
- **TLB flush**: the TLB [the cache of virtual-to-physical address translations] holds A's mappings, which are wrong for B. It is flushed, and B pays for slow page-table lookups until it refills.

This is why "just use 10,000 threads" fails: the machine spends its time switching instead of working.

## Threads

A thread is a second stream of execution inside one process. Sharing memory is what makes threads cheap, and the very same sharing is what makes them dangerous.

### The problem threads solve

A web server wants two things at once: handle many requests in parallel, and have every handler share one set of data, like the cache and the connection pool. Processes deliver the parallelism but fight the sharing: each process has its own address space, so sharing means **IPC** [inter-process communication: pipes, sockets, shared memory segments], which is clumsy and slow, and creating a process per request is expensive.

A **thread** is an independent path of execution inside a process. Each thread gets its own registers and its own stack, because it is a separate flow of function calls. Everything else is shared.

- **Private to each thread:** program counter, registers, stack.
- **Shared by all threads in a process:** code, heap, globals, open file descriptors.

### Thread vs process

| | Process | Thread |
|---|---|---|
| Address space | its own, isolated | shared with its siblings |
| Creation cost | high: new address space and page tables | low: a stack and a TCB |
| Communication | IPC | read and write the same variables |
| Crash isolation | one crashing leaves the others alive | one bad thread can take down the whole process |
| Switch cost | higher: TLB flush | lower: same address space, no flush |

> **"Why are threads cheaper?"** They share the address space. Creating one copies no page tables and no heap: just a new stack and a Thread Control Block. Switching between threads of one process skips the TLB flush. Communication is a plain memory read or write instead of IPC.

### Two reasons to use them

1. **Parallelism.** Different threads really do run at the same time, on different cores.
2. **Overlapping waiting with work.** While one thread is blocked on a database query, another handles the next request. This is the classic web-server design: a thread per request, usually from a pool, so one slow request does not stall the rest.

(Node reaches the same goal with no threads in your code: one thread plus asynchronous I/O. That story is in step 3 of this topic.)

### The price: race conditions

Shared memory is why threads are cheap, and it is also the trap. `counter = counter + 1` looks like one action and is actually three instructions:

```
LOAD  counter into a register
ADD   1
STORE the register back to counter
```

Suppose two threads both run this while `counter` is 50, and the timer interrupt lands between one thread's LOAD and STORE:

```
T1: LOAD counter (50), ADD (51)
        <switch>
T2: LOAD counter (50), ADD (51), STORE (counter = 51)
        <switch>
T1: STORE its register (counter = 51)    two increments, one lost: should be 52
```

The final value depends on where the switch happened to land. That is a **race condition**: correctness that depends on scheduling timing, which makes the bug non-deterministic and miserable to reproduce. The stretch of code that must not be run by two threads at once is a **critical section**, and the property you need is **mutual exclusion**: at most one thread inside it at a time. The tools that provide it are step 2 of this topic.

### The TCB

The bookkeeping mirrors processes: each thread has a **Thread Control Block (TCB)** holding its saved registers while it is not running. Switching threads inside one process is a TCB swap with no address-space change, which is exactly why it is cheaper.

## The pthreads API

This section turns the ideas above into the actual C API: creating threads, waiting for them, and the two tools (the mutex and the condition variable) that make sharing safe.

### Creating and joining

pthreads [POSIX threads, the standard C threading library] is the concrete API behind the ideas above.

```c
void *worker(void *arg) {
    int *n = (int *)arg;   /* the pointer passed at creation */
    return NULL;
}

int main() {
    pthread_t t;
    int v = 42;
    pthread_create(&t, NULL, worker, &v);  /* start worker(&v) on a new thread */
    pthread_join(t, NULL);                 /* block until it finishes */
}
```

`pthread_join` is to threads what `wait()` is to processes. One classic bug to know: never return a pointer to a local variable from a thread function. Locals live on that thread's stack, the stack is gone the moment the thread exits, and the caller is left holding a dangling pointer.

### The mutex

The mutual-exclusion tool from the race-condition section, as an API:

```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

pthread_mutex_lock(&lock);
counter++;                    /* the critical section: one thread at a time */
pthread_mutex_unlock(&lock);
```

A thread calling `lock()` while another holds it **blocks** until `unlock()`. That single property serializes the three-instruction increment and removes the race.

### Condition variables

A mutex protects data. Sometimes a thread instead needs to wait for a fact to become true, like "the queue has an item in it". Checking in a loop would burn a core doing nothing. A **condition variable** lets a thread sleep until another thread announces the fact.

```c
/* consumer: wait until there is work */
pthread_mutex_lock(&lock);
while (queue_empty())
    pthread_cond_wait(&cond, &lock);   /* atomically: release the lock and sleep */
/* the lock is held again here; take the item */
pthread_mutex_unlock(&lock);

/* producer: add work, wake a waiter */
pthread_mutex_lock(&lock);
enqueue(item);
pthread_cond_signal(&cond);            /* wake one waiting thread */
pthread_mutex_unlock(&lock);
```

Two details carry the whole mechanism:

- `pthread_cond_wait` releases the lock and goes to sleep as one atomic step, then re-acquires the lock before returning. Without that atomicity there is a gap after the check and before the sleep; a signal landing in the gap wakes nobody, and the sleeper sleeps forever.
- The wait sits in a `while`, not an `if`. Between being woken and actually running, another thread may have taken the item, and the API also permits **spurious wakeups** [waking with no signal at all]. Re-checking the condition on every wake is the only safe pattern.
$body$, step = 1
  WHERE title = 'Processes & Threads';

UPDATE questions.bank SET lesson_md = $body$## The Problem We're Solving

Two threads sharing memory can corrupt it just by taking turns at the
wrong moments. This page is about the tools that make sharing safe.

### Where step 1 left off

Step 1 of this topic ended with a warning. Threads are cheap precisely
because they share the process's heap and globals, and that sharing breaks
the simplest code you can write. `counter = counter + 1` looks like one
action, but the compiler turns it into three machine instructions:

```
LOAD  counter into a register
ADD   1
STORE the register back to counter
```

The OS may switch threads between any two instructions; the timer interrupt
does not wait for a convenient moment. If the switch lands between one
thread's LOAD and its STORE, an update disappears:

```
counter is 50

T1: LOAD 50, ADD (register now holds 51)
        <switch>
T2: LOAD 50, ADD, STORE          counter = 51
        <switch>
T1: STORE its register           counter = 51, not 52: one update lost
```

A bug like this is a **race condition** [correctness that depends on where
the scheduler happened to switch, so the bug is non-deterministic: it
appears and vanishes between runs]. **Synchronization** is the set of tools
that coordinate access to shared state so the timing cannot matter. This
page, step 2 of this topic, covers those tools (locks, condition variables,
semaphores) and the bugs that come from misusing them (deadlock, livelock,
and the two shapes real-world races usually take).

> **Interview phrasing:** "A race condition is correctness that depends on
> scheduling timing, which makes the bug non-deterministic and miserable to
> reproduce."

## Locks and Mutexes

A lock lets exactly one thread at a time run a marked stretch of code;
every other thread waits until it is free. That single guarantee is what
removes the race.

### The shape of the fix

The lost update happens because a second thread can run the LOAD/ADD/STORE
sequence while the first thread is halfway through it. So the fix has a
clear shape: mark the stretch of code, and arrange that at most one thread
can ever be inside the marked stretch at once. The stretch is the
**critical section**, and the property it needs is **mutual exclusion**
[at most one thread inside at a time].

### What a lock is

The object that provides mutual exclusion is a **lock**, also called a
**mutex** [short for "mutual exclusion"]. It has exactly two states:
**free** and **held**. Only one thread holds it at a time; a thread that
tries to acquire a held lock **blocks** [is taken off the CPU and put to
sleep] until the holder releases it.

```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

pthread_mutex_lock(&lock);
counter++;                     /* the critical section */
pthread_mutex_unlock(&lock);
```

With every access to `counter` wrapped like this, the three instructions
can no longer interleave: whichever thread acquires the lock first runs
the whole sequence before the other can start it.

### Why a naive flag doesn't work

Try to build the lock yourself out of an ordinary variable:

```c
/* BROKEN */
while (flag == 1) ;   /* test: spin until nobody is inside */
flag = 1;             /* set: mark it as mine              */
```

The test and the set are separate instructions, so the thread switch can
land between them: two threads both see `flag == 0`, both leave the loop,
both set the flag, and both enter the critical section. The would-be lock
has exactly the race it was supposed to prevent. The check-and-set must be
**atomic** [performed as one indivisible step that no other thread can
interleave with or observe half-done].

### Test-and-set: help from the hardware

No arrangement of ordinary loads and stores can make check-and-set atomic,
so CPUs provide it as a single instruction (`xchg` on x86) that reads a
memory location and writes it in one uninterruptible step:

```c
int TestAndSet(int *ptr, int new) {   /* ONE atomic instruction */
    int old = *ptr;
    *ptr = new;
    return old;
}
```

This is enough to build a correct **spin lock** [a lock whose waiters
retry in a loop instead of sleeping]:

```c
void lock(lock_t *l)   { while (TestAndSet(&l->flag, 1) == 1) ; }
void unlock(lock_t *l) { l->flag = 0; }
```

Walk both cases. If the lock is free (`flag` is 0), TestAndSet sets the
flag to 1 and returns 0 in one atomic step, so the loop exits and the
caller has acquired the lock. If the lock is held (`flag` is 1), TestAndSet
returns 1 (harmlessly writing 1 over 1), so the caller keeps spinning.

**Compare-and-swap (CAS)** is the more powerful cousin: write a new value
only if the current value equals an expected value. It is the basis of
**lock-free data structures** [shared structures kept correct with atomic
instructions alone, no thread ever holding a lock].

### Spin locks: correct but expensive

A spin lock burns CPU while waiting: the spin loop is real instructions on
a real core. The worst case is a single CPU. If the lock holder is
**preempted** [paused by the scheduler], the spinner then wastes its full
timeslice spinning on a lock that cannot possibly be released, because the
only thread able to release it is not running.

An improvement is to give up the CPU on every failed attempt:

```c
while (TestAndSet(&l->flag, 1) == 1)
    yield();   /* let someone else run */
```

Better, but each failed attempt still pays a context switch. Real locks
(`pthread_mutex`) go further: they **sleep** the waiter, taking it off the
run queue [the scheduler's list of threads that could run] entirely, and
wake it when the holder releases. No CPU is spent on waiting.

### Coarse vs fine-grained locking

How many locks should a program have?

- **Coarse-grained**: one lock for everything. Simple and safe, but it
  serializes all threads; only one can touch any shared data at a time.
- **Fine-grained**: separate locks per structure (per hash bucket, for
  example). More parallelism, and more deadlock risk (a later section on
  this page).

> **Interview tip:** for "make this thread-safe," discuss the trade-off.
> One global lock is easy but a bottleneck; fine-grained locking is faster
> but needs care.

### Reader-writer locks

The scenario: configuration data that every request reads and almost
nothing writes. Reads do not conflict with each other; only writes need
exclusion, so a plain mutex that serializes the readers is throwing away
parallelism. A **reader-writer lock** (`pthread_rwlock_t`) admits many
concurrent readers *or* one exclusive writer. It is the classic choice for
read-heavy data (caches, config). The gotcha is **writer starvation**: a
steady stream of readers can keep a writer waiting indefinitely, because
the moment with zero readers never arrives.

## Condition Variables

A condition variable lets a thread sleep until another thread announces
that the thing it was waiting for has happened. A lock is the tool for
exclusive access; this is the tool for waiting on an event.

### The question a lock cannot answer

A worker thread's job is to take items off a shared queue, and the queue
is empty. A lock answers "can I have exclusive access?"; what the worker
needs answered is "should I proceed, or wait for an event?" It could
grab the lock and re-check the queue in a loop, but spin-checking burns a
core doing nothing. What is needed: worker threads that sleep while there
is no work, and a dispatcher that wakes them when work arrives.

A **condition variable (CV)** is that tool: a queue of sleeping threads,
with three operations:

- `wait()`: atomically release the lock and go to sleep
- `signal()`: wake one waiting thread
- `broadcast()`: wake all waiting threads

### The three-part rule

A CV is never used alone. Always three pieces together: (1) a **mutex**,
(2) the **CV**, (3) a **state variable** [an ordinary variable recording
whether the awaited fact is currently true].

```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t  cond = PTHREAD_COND_INITIALIZER;
int ready = 0;   /* state variable */

/* waiter */
pthread_mutex_lock(&lock);
while (ready == 0)                    /* WHILE, not if */
    pthread_cond_wait(&cond, &lock);  /* release lock + sleep */
pthread_mutex_unlock(&lock);

/* signaler */
pthread_mutex_lock(&lock);
ready = 1;                            /* update state FIRST */
pthread_cond_signal(&cond);           /* then wake */
pthread_mutex_unlock(&lock);
```

### Why each piece is load-bearing

- **The mutex.** Without it, there is a gap between the waiter checking
  `ready` and actually falling asleep. If the signaler sets `ready = 1`
  and signals inside that gap, the signal wakes nobody (the waiter is not
  asleep yet) and the waiter then sleeps forever: a lost wakeup.
  `pthread_cond_wait` closes the gap by releasing the lock and sleeping as
  one atomic step, then re-acquiring the lock before it returns.
- **The state variable.** It records that the event happened. A waiter
  that arrives late checks it, sees `ready == 1`, and skips sleeping. The
  signal itself is not stored anywhere; the variable is the memory.
- **`while`, not `if`.** Between being woken and actually running, the
  condition may have stopped being true: another thread may have consumed
  the resource first. The API also permits **spurious wakeups** [waking
  with no signal at all]. Re-checking the condition on every wake is the
  only safe pattern.

### Producer-consumer: the bounded buffer

This is the key concurrency pattern, and the standard interview test of
whether you can use a CV. Producers add items to a fixed-size buffer and
must wait while it is full; consumers remove items and must wait while it
is empty. Use **two** CVs:

```c
pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t  empty = PTHREAD_COND_INITIALIZER; /* "has space" */
pthread_cond_t  fill  = PTHREAD_COND_INITIALIZER; /* "has items" */
int buffer[MAX], fill_ptr = 0, use_ptr = 0, count = 0;

void producer(int item) {
    pthread_mutex_lock(&mutex);
    while (count == MAX)
        pthread_cond_wait(&empty, &mutex);
    buffer[fill_ptr] = item;
    fill_ptr = (fill_ptr + 1) % MAX;
    count++;
    pthread_cond_signal(&fill);
    pthread_mutex_unlock(&mutex);
}

void consumer() {
    pthread_mutex_lock(&mutex);
    while (count == 0)
        pthread_cond_wait(&fill, &mutex);
    int item = buffer[use_ptr];
    use_ptr = (use_ptr + 1) % MAX;
    count--;
    pthread_cond_signal(&empty);
    pthread_mutex_unlock(&mutex);
}
```

**Why two CVs?** Suppose there were one shared CV. A consumer's signal,
meant for a producer, might instead wake another consumer. That consumer
finds the buffer still empty and goes back to sleep; the signal has been
spent, the producer is never woken, and eventually every thread is asleep
forever. Separate CVs make the wakeup targeted: producers signal `fill`
(only consumers wait there), consumers signal `empty` (only producers
wait there).

> **Interview phrasing:** "cond_wait releases the lock and sleeps in one
> atomic step, and the waiter re-checks the condition in a while loop,
> because a wakeup is a hint that the state may have changed, not a
> guarantee that it did."

## Semaphores

A semaphore is a counter that threads wait on. Depending on its starting
value, the same object works as a lock, as an ordering signal between two
threads, or as a limit on how many threads get in at once.

### A counter, not a flag

The scenario a mutex cannot express: a service is allowed at most five
concurrent database connections. A mutex only counts to one. You want an
object that admits up to N threads and makes the rest wait.

A **semaphore** is an integer counter with two atomic operations:

```
sem_wait:  s--; if s < 0: sleep
sem_post:  s++; if anyone is waiting: wake one
```

The rule for choosing the **initial value**: set it to the number of
resources you are willing to hand out immediately. The three classic
initial values give three different tools.

### Initial value 1: a mutex

```c
sem_init(&m, 0, 1);   /* the middle 0 means: shared between
                         threads of this process, not across
                         processes */
sem_wait(&m);         /* s: 1 -> 0, proceed */
/* critical section */
sem_post(&m);         /* s: 0 -> 1, or wake a waiter */
```

Trace two threads through it:

```
A: sem_wait   s: 1 -> 0    A proceeds into the critical section
B: sem_wait   s: 0 -> -1   B sleeps
A: sem_post   s: -1 -> 0   wakes B
```

A semaphore initialized to 1 is a **binary semaphore**, and it behaves
like a mutex.

### Initial value 0: ordering

Make one thread wait for another, the same job `wait()` did for processes
in step 1 of this topic:

```c
sem_init(&done, 0, 0);

/* child  */  do_work(); sem_post(&done);   /* s: 0 -> 1        */
/* parent */  sem_wait(&done);              /* if 0: block;     */
                                            /* if 1: proceed    */
```

This works regardless of who runs first. If the parent waits first, `s`
goes negative and it sleeps until the child posts. If the child finishes
first, its post leaves `s` at 1, and the parent's later wait takes it back
to 0 and sails through without blocking. The counter remembers that the
event happened; that is what a raw CV signal cannot do.

### Initial value N: counting

Admit up to N threads at once: thread pools, connection limits.

```c
sem_init(&slots, 0, 5);   /* at most 5 concurrent */

sem_wait(&slots);
handle();
sem_post(&slots);
```

### Producer-consumer with semaphores

The bounded buffer again, this time with the counting done by the
semaphores themselves:

```c
sem_init(&empty, 0, MAX);  /* empty slots */
sem_init(&full,  0, 0);    /* full slots  */
sem_init(&mutex, 0, 1);    /* guards the buffer itself */

/* producer */
sem_wait(&empty); sem_wait(&mutex);
put(item);
sem_post(&mutex); sem_post(&full);

/* consumer */
sem_wait(&full); sem_wait(&mutex);
item = get();
sem_post(&mutex); sem_post(&empty);
```

**The ordering is critical:** wait on `empty` or `full` *before* `mutex`.
Reverse it and you deadlock: a producer acquires `mutex` first, finds no
space, and sleeps on `empty` while still holding `mutex`; the consumer
that would free a slot can never acquire `mutex` to do it.

### Mutex vs semaphore

| | Mutex | Semaphore |
|---|---|---|
| Owner | Yes, only the locker unlocks | No, any thread can post |
| Count | Binary (0/1) | Integer (0..N) |
| Use | Mutual exclusion | Exclusion + ordering + counting |

> **Interview phrasing:** "A mutex has ownership, the locker must unlock.
> A semaphore is an ownerless counter; any thread can post. A binary
> semaphore acts like a mutex, but semaphores also do signaling and
> resource counting."

## Deadlock

Deadlock is a permanent standstill: each thread holds a lock another
thread needs, so all of them wait forever. It takes four conditions at
once, and breaking any single one prevents it.

### Two locks, two threads, zero progress

Fine-grained locking hands out many locks, and code starts needing two at
once (moving an item between two locked structures, for example). Now
this can happen:

```c
/* T1 */  lock(L1); lock(L2);   /* holds L1, wants L2 */
/* T2 */  lock(L2); lock(L1);   /* holds L2, wants L1 */
```

T1 acquires L1; the scheduler switches; T2 acquires L2 and blocks waiting
for L1; T1 resumes and blocks waiting for L2. Each thread is waiting on a
lock the other holds, and neither will ever release. They are stuck
forever. That is **deadlock**: two or more threads, each waiting on a
resource another of them holds.

```
   T1 ---wants---> L2
    ^               |
 held by         held by
    |               v
   L1 <---wants--- T2
```

### The four conditions (Coffman)

Deadlock is only possible when all four of these hold at once:

1. **Mutual exclusion**: resources are held exclusively. (Hard to remove;
   exclusion is the whole point of locks.)
2. **Hold and wait**: a thread holds one resource while waiting for
   another.
3. **No preemption**: a lock cannot be forcibly taken away from its
   holder.
4. **Circular wait**: a cycle of waiting threads, each waiting on the
   next. (The condition most commonly attacked.)

Remove any one of the four and deadlock is impossible. That sentence is
the whole prevention strategy.

### Prevention: attack one condition

**Break circular wait with lock ordering (the most practical fix).**
Always acquire locks in one global order, everywhere in the program; a
cycle cannot form when every thread climbs the same ladder in the same
direction.

```c
pthread_mutex_lock(&L1);   /* always L1 before L2, everywhere */
pthread_mutex_lock(&L2);
```

When you do not control which locks you are given (locks passed in as
arguments), impose the order by address:

```c
if (m1 < m2) { lock(m1); lock(m2); }
else         { lock(m2); lock(m1); }
```

**Break hold-and-wait: acquire everything at once.** Take one global
allocation lock, acquire all the locks the operation will need, then
release the global lock. No thread ever holds some locks while waiting for
others. The downside: all acquisition serializes through the global lock,
so concurrency drops.

**Break no-preemption: trylock plus backoff.** `trylock` fails immediately
instead of blocking. If you cannot get both locks, release what you hold
and start over:

```c
retry:
    lock(L1);
    if (trylock(L2) != 0) { unlock(L1); goto retry; }
```

The risk is **livelock** [threads that are running and busy but making no
progress]: both threads release and retry in lockstep, colliding the same
way every round. Adding a random delay before retrying breaks the
symmetry.

### Deadlock vs livelock vs starvation

| | |
|---|---|
| **Deadlock** | Blocked forever, waiting on each other |
| **Livelock** | Running but no progress (retry and re-conflict) |
| **Starvation** | Never scheduled; others always win the resource |

Starvation showed up once already on this page: the writer waiting behind
an endless stream of readers at a reader-writer lock.

> **Interview phrasing:** "Deadlock needs all four Coffman conditions at
> once, so breaking any one prevents it; the practical fix is a global
> lock order, because a cycle cannot form when everyone acquires in the
> same order."

## Race Conditions in Real Code

Most concurrency bugs in real code are one of two mistakes: treating two
steps as if they were one, or assuming one thing happens before another
when nothing enforces that order.

### Beyond the toy counter

The counter race is the interview version. In production code the same
disease shows up in the two shapes below, which cover most non-deadlock
concurrency bugs found in real code bases.

### Atomicity violation

A sequence the code assumed was atomic was not:

```c
/* T1 */
if (thd->proc_info)
    fputs(thd->proc_info, ...);   /* T2 may set it to NULL
                                     between the check and the
                                     use: crash */

/* T2 */
thd->proc_info = NULL;
```

The check and the use are two separate actions, and T2 can run between
them: the pointer passes the `if`, then becomes NULL before `fputs` reads
it. Fix: hold one lock around the check **and** the use together, so the
pair behaves as one step.

### Order violation

The code assumed A runs before B, but nothing guarantees the order:

```c
/* T1 */  mThread = create_thread(...);
/* T2 */  mState = mThread->State;   /* NULL deref if T2 runs
                                        first */
```

Nothing stops the scheduler from running T2 before T1 has assigned
`mThread`. Fix: make the order explicit with a condition variable, so T2
waits until T1 signals that initialization is done (the three-part
mutex, CV and state-variable pattern from earlier on this page).

> **Interview phrasing:** "Most real races are atomicity violations or
> order violations: lock the check together with the use, or enforce the
> order with a condition variable instead of assuming the scheduler will
> cooperate."
$body$, step = 2
  WHERE title = 'Synchronization & Concurrency';

UPDATE questions.bank SET lesson_md = $body$Step 3 of this topic links memory internals (virtual memory, paging,
allocation) to I/O models (blocking, non-blocking, async) and the event
loop: how Node.js serves 10,000 connections on one thread. It is the
material backend system-design interviews lean on hardest.

## Virtual Memory

No program ever touches real RAM addresses directly. The OS and the
hardware give each process its own private memory and quietly translate
every access to a real location behind the scenes.

### Start with the collision

Your laptop runs Chrome, Postgres and a few dozen other processes, and
every one of them was compiled to read and write memory at fixed numeric
addresses. Nothing stops two programs from both using address `0x5000`.
If those numbers named real locations in the RAM chips, Process A writing
`0x5000` would clobber Process B's data sitting there, and a bug in any
ordinary program could scribble over the OS itself.

The fix is a layer of indirection. Every address a process uses is a
**virtual address** [a number the CPU and OS translate into a real RAM
location on every access]. Each process gets the illusion of its own
private, contiguous memory starting at 0, and the OS plus the hardware
map those addresses onto physical RAM wherever it happens to be free.
One process cannot see another's memory at all. The whole arrangement is
called **virtual memory**, and it buys three things:

- **Isolation**: a rogue process cannot corrupt other processes or the OS.
- **Transparency**: a process just sees its own space; it never learns
  where in physical RAM it really lives.
- **Efficiency**: physical memory can be shared between processes,
  overcommitted, and swapped out to disk.

> **Interview fact:** every pointer you print in C is a *virtual*
> address; the CPU and OS translate it to a physical one before touching
> RAM.

### The map (draw this once)

```
 high addresses  +------------------+
                 |      stack       |  locals, args, return addresses
                 |        v         |  grows down
                 |      (free)      |
                 |        ^         |
                 |       heap       |  malloc/new, grows up
                 +------------------+
                 |  static/global   |  globals, string literals,
                 |      data        |  initialized statics
                 +------------------+
                 |       code       |  read-only instructions,
 low addresses   +------------------+  fixed size
```

- **Stack:** manages itself. Every function call pushes a **frame** [that
  call's locals, parameters and return address]; returning pops it. It
  grows downward, and each thread has a stack of its own. Grow it far
  enough to collide with the heap and you have a stack overflow.
- **Heap:** the memory the program asks for explicitly. Managed by hand
  in C/C++ (`malloc`/`free`), by a garbage collector in Java, Go and
  Python. It grows upward and holds the dynamic structures: lists, maps,
  trees.
- **Code:** the compiled instructions. Read-only, fixed size.
- **Static/global data:** globals, string literals, initialized statics.

> **"Stack vs heap?"** Stack: locals, parameters, return addresses;
> allocated and freed automatically on every call and return; fast but
> small (about 8MB). Heap: dynamic memory that you, or the garbage
> collector, must manage; large but slower. Forget to free it and you
> leak; free it twice and you corrupt memory.

## Paging

Instead of giving each process one big block of memory, the OS hands
memory out in small fixed-size pieces that can live anywhere in RAM.
This section is the machinery that makes that work, and what it costs.

### Start with the slab that will not fit

Suppose the OS handed each process its memory as one contiguous slab of
physical RAM. Two problems appear immediately:

1. **External fragmentation** [free memory shattered into many small,
   non-contiguous gaps]. After processes have started and exited for a
   while, a request for one large slab fails even though the gaps add up
   to plenty of free memory.
2. **Inflexibility.** How big should the slab be? The stack and the heap
   grow toward each other at runtime, so there is no way to size them up
   front.

**Paging** drops the contiguity requirement. Chop both kinds of memory
into fixed-size chunks: virtual memory into **virtual pages** [typically
4KB each] and physical RAM into **page frames** [chunks of the same
size]. Any page can live in any frame, adjacent or not, and the OS keeps
a **page table** per process recording which page sits in which frame.

### Translating an address

Split a virtual address into two fields: the **VPN** [virtual page
number, the top bits] and the **offset** [the bottom bits, the position
inside the page]. With 4KB pages the offset is the bottom 12 bits,
because 2^12 = 4096. Translation is:

1. Split the virtual address into VPN and offset.
2. Look the VPN up in the page table; the entry holds a **PFN** [physical
   frame number].
3. The physical address is that frame's base with the same offset
   appended. The page number changes; the position inside the page never
   does.

Each **page table entry (PTE)** carries the PFN plus a few bits:

- **Valid**: is this page mapped at all? Touching an invalid page is a
  **segfault** [the OS kills the process for an illegal memory access].
- **Present**: is the page in RAM right now, or out on disk? On disk
  means a page fault (below).
- **Dirty**: has the page been written since it was loaded?
- **Protection**: read, write and execute permissions.

### The TLB

There is a cost hiding in step 2: the page table lives in RAM, so every
memory access has quietly become two, one to read the PTE and one for
the data itself. The fix is the **TLB (Translation Lookaside Buffer)** [a
small, fast cache on the CPU chip holding recently used translations].

```
VPN in TLB?   hit  -> use the cached PFN directly (fast)
              miss -> walk the page table in RAM, fill the TLB,
                      retry (slow)
```

A TLB holds roughly 64 to 1024 entries and hits about 99% of the time.
This is also one of the real costs of a context switch: switching to
Process B invalidates A's cached translations, the TLB is flushed, and B
starts cold, missing over and over until it refills.

### The page fault

A **page fault** is raised when a process accesses a page whose PTE has
present = 0: the page is not in RAM. Two causes, with opposite outcomes:

1. The page was **swapped to disk**: the OS evicted it earlier to free a
   frame. Recoverable; load it back.
2. The page was **never mapped** at all. An invalid access: segfault, and
   the process is killed.

For a swapped-out page, the recovery runs like this:

1. The hardware traps into the OS page-fault handler.
2. The OS finds the page on disk and picks a free frame, evicting one if
   none is free.
3. The OS reads the page in (slow disk I/O), then sets present = 1 and
   fills in the PFN.
4. The OS resumes the process. The faulting instruction retries, and this
   time it succeeds.

This is **demand paging** [load a page only when it is first accessed],
and it is why programs can use more memory than the machine has physical
RAM. Push it too far and you get **thrashing**: the working sets [the
pages each process is actively using] no longer fit in RAM together, so
the machine page-faults constantly and spends more time swapping than
working.

> **Interview phrasing:** "A page fault is accessing a virtual address
> not currently in RAM. The hardware traps to the OS, which loads the
> page from disk, updates the page table, and resumes. It's expensive
> because of disk I/O. Millions of times slower than RAM."

### The fragmentation scorecard

- **External fragmentation** (free memory split into non-contiguous
  pieces, so a large request fails despite enough total free): paging
  eliminates it, because any page fits any frame.
- **Internal fragmentation** (waste inside an allocation): paging
  introduces it. Allocate a whole 4KB page, use 100 bytes, and the rest
  is wasted inside the page. That is the price of fixed-size chunks.

## Inside malloc

`malloc` is not the OS. It is ordinary library code that takes big
blocks of memory from the OS ahead of time and hands out small pieces
of them itself.

### Start with the price of asking the OS

A busy program calls `malloc` millions of times, often for a few dozen
bytes each. Getting memory from the OS takes a system call [a request
into the kernel, which costs a switch into kernel mode and back], and
paying that price on every small allocation would be far too slow. So
`malloc` asks the OS rarely, and works like this:

1. At startup, grab a big chunk of memory from the OS (`sbrk()` or
   `mmap()`).
2. Manage that chunk privately with a **free list** [a list tracking
   which regions of the chunk are currently unused].
3. `malloc(n)`: find a free region that fits, split it, return a pointer.
4. `free(ptr)`: mark the region free again and **coalesce** [merge
   adjacent free regions into one larger one].

How does `free(ptr)` know the size when you never pass one? The
allocator stores a **header** [a small hidden record holding the chunk's
size and other bookkeeping] just before the pointer it hands out, so
`free` reads it at `ptr - sizeof(header)`.

### Choosing which free chunk to use

- **First fit:** take the first chunk that fits. Fast, but the front of
  the list fragments over time.
- **Best fit:** take the smallest chunk that fits. Less waste per
  allocation, but it must scan the whole list, which is slow.
- **Next fit:** first fit, but resume from where the last search
  stopped, which spreads allocations across the list.

Counterintuitively, best fit often loses: it leaves behind many tiny
fragments too small to ever satisfy a request, and first fit is
frequently faster in practice. Real allocators (glibc's `ptmalloc`,
jemalloc, tcmalloc) sidestep the trade with **size-class segregation** [a
separate free list per allocation size], which is both fast and
low-fragmentation.

### Why coalescing matters

Without merging, freeing three adjacent small chunks leaves three small
entries on the free list, not one large one. Keep going and the heap
fills with tiny disconnected free chunks, and large allocations start
failing even while most of the heap is free. Coalescing on every `free`
is what keeps big allocations possible.

> **Interview phrasing:** "malloc is a user-space allocator: it gets big
> regions from the OS with sbrk or mmap, then serves small requests from
> a free list, splitting on malloc and coalescing on free."

## I/O Models and the Event Loop

Talking to a disk, a database or the network is enormously slower than
computing, so a thread doing I/O spends nearly all its time waiting.
Each I/O model is a different answer to what the thread should do with
that time, and the event loop is the answer where one thread never
waits at all.

### Start with the waiting

Your request handler asks the database for one row. The answer crosses
the network and comes back in about half a millisecond, which sounds
fast until you compare it with compute. **I/O** [any communication that
leaves the CPU and RAM: disk, network, a database, a file] is orders of
magnitude slower than computation:

| Operation | Rough latency |
|---|---|
| CPU register | under 1 ns |
| L1 cache | ~1 ns |
| L3 cache | ~10 ns |
| RAM | ~100 ns |
| SSD random read | ~100 µs |
| Network round trip (same datacenter) | ~500 µs |
| HDD seek | ~10 ms |

While it waits on I/O, a thread sits idle; every model below deals with
that idle time differently. This is the material that explains Node.js,
Nginx and async, and it is very common in backend design interviews.

### Blocking I/O

The call simply does not return until the result arrives. The thread
sleeps, using no CPU.

```c
int n = read(fd, buf, 1024);  /* thread sleeps until data arrives */
```

Pro: simple, sequential code. Con: one thread per concurrent operation.
10,000 concurrent requests means 10,000 threads, each with a stack of
roughly 1 to 8MB, plus the cost of switching between them; it does not
scale. This is Apache's classic thread-per-request model.

### Non-blocking I/O

Mark the **file descriptor** [the small number the OS gives a program as
its handle on an open file or socket] as non-blocking, and the call
returns immediately, either with data or with `EAGAIN`, meaning "not
ready yet".

```c
fcntl(fd, F_SETFL, O_NONBLOCK);
int n = read(fd, buf, 1024);
if (n == -1 && errno == EAGAIN) { /* no data yet; try later */ }
```

Pro: the thread never blocks. Con: now it has to keep checking, and
spinning on "ready yet?" burns the CPU you were trying to save. What is
missing is a way to be told about readiness instead of asking.

### Multiplexing: wake me when any is ready

**I/O multiplexing** is that missing piece: hand the OS a whole set of
fds (here, sockets) and say "watch these; wake me when any one is
ready". The thread sleeps until notified. Two generations of the API:

- **`select()` / `poll()`**: older and simpler. You pass the entire fd
  list on every call and the kernel scans every fd every time, O(n)
  work. `select` is also capped at 1024 fds.
- **`epoll` (Linux) / `kqueue` (BSD, macOS)**: modern. Register each fd
  with the kernel once; after that, `epoll_wait()` blocks and returns
  only the fds that are ready, O(ready) work. This scales to hundreds of
  thousands of fds.

Strictly, epoll reports **readiness**: it tells your thread "this socket
has data", and your thread still performs the non-blocking `read()`
itself. True **asynchronous I/O** (Linux `io_uring`, Windows IOCP) goes
one step further: the kernel performs the operation itself and notifies
you on **completion**.

The pattern that falls out:

```
register fds -> epoll_wait() blocks -> ready fds come back
     ^                                        |
     |             handle each one            |
     +----------------------------------------+
```

That loop has a name: the **event loop**.

### The event loop (Node.js, Nginx)

One thread repeatedly asks "what is ready?" and handles it, never
blocking on any single operation:

```c
while (true) {
    events = epoll_wait(watched_fds);    /* block until something
                                            is ready */
    for (e : events) handlers[e.fd](e);  /* run the handler;
                                            it must be fast */
}
```

How Node serves 10,000 connections on one thread: a request that needs
I/O registers a callback and returns at once; the thread moves on to
other requests; when the I/O completes and epoll reports it, Node runs
the callback. The one thread is always either doing useful work or
asleep inside `epoll_wait`. Nothing is ever just waiting.

The critical requirement: callbacks must be short and must not block.
Heavy synchronous work (encrypting a big file, say) blocks the loop, and
every request behind it stalls. That is the classic "blocking the event
loop" bug.

Where the model wins and loses:

- **I/O-bound work** (web servers): most of each request is spent
  waiting on the database or network, and epoll lets the OS do that
  waiting while the one thread stays busy. The event loop is built for
  this.
- **CPU-bound work** (image, video, ML): one thread offers no
  parallelism. You need multiple cores: Node reaches for worker threads,
  and Go or Java suit CPU-bound backends better.

### Thread pools, the middle ground

A **thread pool** is a fixed number of threads (often about one per CPU
core) pulling tasks off a shared queue. Pros: bounded memory, threads
are reused instead of created per request, and each task is free to do
plain blocking I/O. Cons: if every thread blocks at once, say on a slow
database, the pool starves and nothing new runs; size it carefully.

| Workload | Best model |
|---|---|
| I/O-bound, many connections (web server, API gateway) | Event loop (Node, Nginx) |
| CPU-bound, parallel | Multiple threads or processes |
| Mixed | Thread pool plus async I/O |
| Simple, low concurrency | Blocking, thread per request |

> **Interview phrasing:** "Node serves 10,000 connections on one thread
> because the thread never waits: epoll parks every idle socket in the
> kernel, and the thread only ever runs callbacks for sockets that are
> ready."

## What a Context Switch Really Costs

Moving the CPU from one process to another looks like a quick register
swap, but the switch also wrecks the fast caches the old process had
warmed up. That hidden cost is what makes too many threads slow, and it
is the reason event loops exist.

### Start with the 10,000-thread server

The blocking model above ended at 10,000 threads and the claim that it
does not scale. Memory is only half the reason; the other half is what
switching costs. Step 1 of this topic introduced the context switch;
this is the full accounting.

### The full sequence (process A to process B)

1. The timer interrupt fires, and the hardware saves A's registers onto
   A's kernel stack [the small per-process stack the kernel uses for its
   own work].
2. The OS saves A's kernel registers into A's **PCB** [Process Control
   Block, the per-process record the OS keeps].
3. The OS restores B's kernel registers from B's PCB.
4. The OS switches to B's page table (on x86, by loading the CR3
   register).
5. The TLB is flushed: A's cached translations are wrong for B. (Some
   CPUs tag each TLB entry with an **ASID** [address-space ID] so the
   flush can be skipped.)
6. The OS restores B's CPU registers, and B resumes.

### Where the cost actually is

- **Register save and restore:** cheap, nanoseconds. Not the problem.
- **TLB flush:** B's first memory accesses all miss and walk the page
  table in RAM; on memory-heavy code a warm TLB is 10 to 100 times
  faster.
- **Cache invalidation:** the CPU caches were hot with A's data, so B
  starts cold and fetches from RAM, roughly 100 times slower than L1.
- **Scheduler overhead:** about 1 to 10 µs of direct cost per switch.

Now the collapse makes sense: with 10,000 threads the OS spends its time
context switching, thrashing the TLB and the caches on every switch, and
throughput falls even though the CPU looks "busy". That failure is why
event loops exist, and why Go runs **goroutines** [Go's lightweight
threads, multiplexed by Go's own scheduler onto a few OS threads]
instead of one OS thread per task.

> **Interview phrasing:** "The registers are the cheap part of a context
> switch; the expensive part is what it does to the TLB and the caches,
> because the incoming process starts cold on both."
$body$, step = 3
  WHERE title = 'Memory & I/O';

UPDATE questions.bank SET lesson_md = $body$## The Relational Model

Store every fact exactly once, in one place, and connect
related facts through keys. Everything else in this section follows from
that one goal.

### Start with the problem

An online shop keeps one big table of orders, and each row carries
everything about the order: the total, the customer's name, the customer's
city. The same customer appears on forty rows, so their city is stored
forty times. Then they move. Either you update forty rows, or you miss a
few and the table now disagrees with itself about a plain fact, with no way
to say which row is right. The design let one fact live in many places, and
that is the bug.

A **relational database** stores data in **tables** (the formal word is
relations) made of rows and columns, and its design goal is the opposite of
that big table: each fact is stored exactly once, and tables link to each
other through keys instead of repeating each other's data.

### Keys: how tables link

- A **primary key (PK)** uniquely identifies a row and is never NULL. It is
  usually an auto-increment integer or a UUID [a 128-bit identifier
  generated randomly, so machines can create keys without coordinating].
- A **foreign key (FK)** is a column that references a primary key in
  another table. The database enforces **referential integrity** [the
  guarantee that a reference always points at a row that exists]: it will
  refuse an order for a non-existent user.
- A **composite key** is a primary key made of two or more columns. It is
  common in join tables [tables whose rows exist only to link two other
  tables].

```sql
CREATE TABLE orders (
    order_id INT PRIMARY KEY,
    user_id  INT REFERENCES users(user_id),  -- foreign key
    total    DECIMAL(10,2)
);
```

### Normalization: one fact, one place

**Normalization** is restructuring tables so that each fact is stored
exactly once, removing redundancy. It comes as numbered levels, each
stricter than the last:

- **1NF:** every column value is atomic (no arrays or comma-separated
  lists inside a cell), and rows are unique.
- **2NF:** every non-key column depends on the *whole* primary key, not
  part of it (no partial dependency). Only a composite PK can be partially
  depended on, so 2NF only matters when the PK is composite.
- **3NF:** no non-key column depends on another non-key column (no
  transitive dependency).

The 3NF violation is the shop's bug from the opening. In
`orders(order_id, customer_id, customer_city)`, the column `customer_city`
depends on `customer_id`, not on `order_id`: the city is a fact about the
customer, yet it is stored on every order. The fix is to move it to the
`customers` table, where it lives once.

### When to break the rules

**Denormalization** is deliberately copying facts back into more than one
place, for read-heavy workloads where joins are expensive: reporting,
analytics, search. You trade write complexity (every copy must be kept in
sync) for read speed (the answer is already assembled in one row).

> **Interview phrasing:** "Normalization stores each fact exactly once;
> denormalization copies facts back out to buy read speed, and pays for it
> on every write."

## SQL Joins

A join puts facts that live in separate tables back
together into one answer. The join types differ only in what they do with
rows that have no match on the other side.

### Start with the problem

Users live in one table and orders in another, and an order row carries
only a `user_id`. A report needs both at once: each order next to its
customer's name. A **join** combines rows from two tables on a related
column.

### The join types

An **INNER JOIN** returns only rows that match in both tables. An order
with no user, or a user with no orders, does not appear.

```sql
SELECT o.order_id, u.name
FROM orders o
JOIN users u ON o.user_id = u.user_id;
```

A **LEFT JOIN** returns all left rows plus the matched right rows; where
the right table has no match, its columns come back as NULL.

```sql
SELECT u.name, o.order_id
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id;
```

That NULL is not just a gap to tolerate; it is something you can filter
on. The classic pattern built on it is the **anti-join**: rows in the left
table with no match on the right, found by keeping only the rows where the
right side came back NULL. Users who have never ordered:

```sql
SELECT u.name
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id
WHERE o.order_id IS NULL;
```

A **RIGHT JOIN** is the mirror of LEFT and is rarely used: swap the two
tables and write a LEFT JOIN instead.

A **FULL OUTER JOIN** returns all rows from both sides, with NULLs
wherever a side has no match.

A **self-join** joins a table to itself, for rows that reference other
rows in the same table. Employees and their managers, where `manager_id`
points back into `employees`:

```sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.employee_id;
```

The LEFT keeps employees who have no manager in the result, with NULL in
the manager column.

> **Interview phrasing:** "LEFT JOIN plus WHERE right-key IS NULL is the
> anti-join: left rows with no match on the right."

## Aggregations and Window Functions

Both tools compute one value across a group of rows.
GROUP BY keeps only one row per group; a window function keeps every row.

### Start with the problem

Two questions against the same data. First: "what has each user spent in
total, and which of them have spent more than 1000?" Answering that means
collapsing many order rows into one number per user. Second: "rank each
employee within their department by salary, shown next to their name and
salary." That needs a value computed across a group of rows, but every
individual row has to survive into the output. SQL has a separate tool for
each.

### GROUP BY and HAVING

**GROUP BY** collapses rows into one row per group, and aggregate
functions such as SUM compute one value over each group:

```sql
SELECT user_id, SUM(total) AS revenue
FROM orders
GROUP BY user_id
HAVING SUM(total) > 1000;
```

The distinction to keep sharp: **WHERE** filters rows before grouping;
**HAVING** filters groups after aggregation. A condition on `SUM(total)`
cannot live in WHERE, because before the grouping happens no sum exists
yet.

> **Interview phrasing:** "WHERE filters rows before grouping; HAVING
> filters groups after aggregation."

### Window functions

A **window function** computes a value across a set of related rows
without collapsing them, which is exactly what GROUP BY cannot do. Every
row stays in the output, carrying the computed value alongside its own
columns.

```sql
SELECT name, department, salary,
    RANK() OVER (
        PARTITION BY department ORDER BY salary DESC
    ) AS rank_in_dept,
    ROW_NUMBER() OVER (ORDER BY salary DESC) AS overall_rank,
    salary - LAG(salary) OVER (ORDER BY hire_date) AS diff_from_prev
FROM employees;
```

The pieces:

- `PARTITION BY` names the group, like GROUP BY does, but the rows stay.
- `ORDER BY` inside `OVER` orders the rows within the window.
- `ROW_NUMBER()` numbers rows uniquely: 1, 2, 3, and so on, even on ties.
- `RANK()` gives tied rows the same rank, then skips: 1, 2, 2, 4.
- `DENSE_RANK()` gives tied rows the same rank without skipping:
  1, 2, 2, 3.
- `LAG(col, n)` and `LEAD(col, n)` fetch the value n rows before or after
  the current row.

### Second highest salary, two ways

A classic interview exercise. With a window function, rank the salaries
and pick rank 2; with a subquery, take the maximum of everything below the
maximum:

```sql
-- window version
SELECT salary FROM (
    SELECT salary,
           DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk
    FROM employees
) t WHERE rnk = 2;

-- subquery version
SELECT MAX(salary) FROM employees
WHERE salary < (SELECT MAX(salary) FROM employees);
```

## How Indexes Work

An index is a sorted side structure that lets the
database jump straight to matching rows instead of reading the whole
table. Reads get much faster; every write pays extra to keep it current.

### Start with the problem

`SELECT * FROM users WHERE age = 25`, against ten million rows. The rows
on disk are in no useful order, so the database's only honest move is to
read every row and test it. That is a **full table scan**, and it costs
O(n) [work grows in proportion to the row count]: double the table and you
double every query.

An **index** is a separate structure the database maintains next to the
table, holding the indexed values in sorted order. It trades write cost
and storage (every change to the table must also update the index) for
much faster reads.

### B-tree indexes (the default)

The default index structure is a **B-tree** [a balanced tree: every path
from the root down to a leaf is the same length, so no lookup is unluckier
than another]. It stores the indexed values in sorted order, and its
leaves point to the table rows.

```
B-tree on users.age:
                [30]
              /      \
         [20]          [40]
        /    \        /    \
    [15,18] [25,27] [35,37] [45,50]
```

Two query shapes fall straight out of the sorted tree:

- A **point lookup** (`age = 25`) follows the tree down from the root:
  smaller than 30, go left; bigger than 20, go right; land on the leaf.
  Cost O(log n) [work grows with the tree's depth, not the row count].
- A **range** (`age BETWEEN 20 AND 40`) finds the start the same way, then
  scans along the leaves in sorted order until it passes the end.

### Clustered vs non-clustered

- A **clustered index** means the table rows themselves are physically
  stored in index order. There can be only one per table, because the data
  has only one physical order. It is usually the primary key (InnoDB and
  SQL Server both do this).
- A **non-clustered index** is a separate structure holding the indexed
  values plus a pointer to each row. A table can have many. A lookup is
  two hops: find the value in the index, then follow the pointer to the
  row.

| | Clustered | Non-clustered |
|---|---|---|
| Data order | rows stored in index order | separate, pointer to row |
| Count per table | one | many |
| Range scans | faster (sequential reads) | slower (pointer chasing) |
| Typical use | primary key | FKs, filtered columns |

### Composite indexes and the leading column

An index on `(last_name, first_name)` is sorted by `last_name` first, and
by `first_name` only within equal last names. It can find every Smith
instantly, but the people named Jo are scattered all through it. The rule
that falls out: a composite index is usable only when the query constrains
the **leftmost** column or columns.

```sql
-- Index on (last_name, first_name, age)

WHERE last_name = 'Smith'                        -- index used
WHERE last_name = 'Smith' AND first_name = 'Jo'  -- index used

-- Leading column skipped: full scan.
WHERE first_name = 'Jo'

-- Uses the last_name prefix, then filters age.
WHERE last_name = 'Smith' AND age = 30
```

Choosing the column order: equality columns first, range columns last, and
columns with high **selectivity** [how sharply a condition narrows the
rows; high selectivity means few rows match] first.

> **Interview phrasing:** "A composite index is sorted by its leftmost
> column first, so a query that skips the leading column cannot use it."

### Covering indexes

If an index contains every column a query needs, the database never
touches the table row at all; the index answers the whole query.

```sql
-- The query:
SELECT name, email FROM users WHERE age = 25;
-- An index on (age, name, email) covers it: every column the
-- query needs is in the index, so no table lookup happens.
```

### When the database will not use an index

Having an index does not force the **query planner** [the database
component that chooses how to execute each query] to use it. Six cases:

1. **A function on the column.** `WHERE UPPER(email) = ...` hides the
   stored value; the index is sorted by `email`, not by `UPPER(email)`.
   Fix: a function-based index, or store the value already normalized.
2. **Low selectivity.** `WHERE is_active = true` when 95% of rows match:
   a scan is cheaper than visiting nearly every row through the index.
3. **The leading column is skipped** in a composite index, as above.
4. **OR conditions**, sometimes.
5. **Very small tables.** The planner prefers a scan: reading a handful
   of rows directly beats descending a tree first.
6. **A leading wildcard.** `LIKE '%smith'` cannot use the index, because
   a structure sorted by prefix cannot find values by their endings;
   `LIKE 'smith%'` can.

### EXPLAIN: ask the planner what it chose

Run `EXPLAIN` or `EXPLAIN ANALYZE` (Postgres) to see the plan:

- `Seq Scan`: a full table scan, bad on large tables.
- `Index Scan`: an index is being used.
- `Index Only Scan`: a covering index; the table is never touched. Best.
- A `rows` estimate that is far from reality means the planner's
  statistics are stale; run `ANALYZE` to refresh them.

### The cost of over-indexing

Indexes are not free. Every insert, update and delete must also update
every index on the table, and each index takes disk space. Add only
indexes that are actually used.
$body$, step = 1
  WHERE title = 'SQL Foundations & Indexing';

UPDATE questions.bank SET lesson_md = $body$## ACID: What a Transaction Promises

A database can bundle several changes into one unit that either fully
happens or does not happen at all, and it makes four promises about that
unit. This section is those four promises and the machinery behind them.

Your code moves 100 from account A to account B: one UPDATE subtracts, a
second UPDATE adds. The server crashes between the two. The money has left A
and arrived nowhere, and neither statement, taken on its own, was wrong.

The database's unit of protection against this is the **transaction** [a
sequence of operations the database runs as one logical unit: either all of
it takes effect or none of it does]. A transaction ends in **commit** [make
every change permanent and visible to others] or **rollback** [undo every
change, as if the transaction never ran]. The four guarantees a transaction
carries are **ACID**, and each answers a specific failure.

**Atomicity: all or nothing.** If step 3 of 5 fails, steps 1 and 2 are
rolled back. In the transfer: debit A, credit B; if the credit fails, the
debit is undone. The mechanism is the **WAL (write-ahead log)** [an
append-only file where the database records each intended change before
touching the data itself]. Because the log entry exists before the data is
modified, a crash can be recovered from the log: replay the changes that
should have happened, undo the ones that should not.

**Consistency: valid state to valid state.** Every transaction moves the
database from one state that satisfies its **constraints** [rules the schema
declares about valid data: foreign keys, NOT NULL, unique, CHECK] to another
such state, never through a violation. A `CHECK (balance >= 0)` blocks an
overdraft. Consistency is partly the application's responsibility: the
database can only enforce rules the application declared. It is often
described as the goal, with the other three letters as the mechanisms that
achieve it.

**Isolation: concurrent transactions behave as if serial.** No transaction
sees another's intermediate state. Two users booking the last seat: isolation
is what stops both from succeeding and the seat count reaching -1. This is
the hardest guarantee to keep at scale, so databases make it tunable through
**isolation levels**, the subject of the next section.

**Durability: committed means crash-proof.** Once the database acknowledges
a commit, the data survives a crash. The WAL is flushed with **fsync** [the
system call that forces writes out of operating-system buffers onto the
physical disk] before the commit is acknowledged, so committed state is
always recoverable.

> **Interview phrasing:** "ACID = atomic (all-or-nothing), consistent
> (constraints never violated), isolated (concurrent transactions don't
> interfere), durable (committed data survives crashes). The WAL is the key
> mechanism behind atomicity and durability."

## Isolation Levels and Their Anomalies

Databases run transactions at the same time to stay fast, and that overlap
can produce a handful of specific wrong results. This section names the
wrong results, then the four settings that choose which ones you accept in
exchange for speed.

Full isolation is expensive: run one transaction at a time and everything
queues up. So databases run transactions concurrently and let you trade
isolation for concurrency. The settings are called **isolation levels**,
and they are defined by which **anomalies** [specific wrong results that
interleaved transactions can produce] they prevent. Each example below is
two transactions, T1 and T2, shown in time order.

**Dirty read**: reading another transaction's uncommitted write. If that
transaction rolls back, you have read data that never existed.

```
T1: UPDATE users SET balance = 0 WHERE id = 1;   -- not committed yet
T2: SELECT balance FROM users WHERE id = 1;      -- reads 0 (dirty)
T1: ROLLBACK;                                    -- the 0 never happened
```

**Non-repeatable read**: re-reading the same row inside one transaction
returns a different value, because another transaction committed an update
in between.

```
T1: SELECT balance FROM users WHERE id = 1;      -- 100
T2: UPDATE users SET balance = 50 WHERE id = 1; COMMIT;
T1: SELECT balance FROM users WHERE id = 1;      -- 50, changed
```

**Phantom read**: re-running a range query returns new rows, because another
transaction committed an INSERT into that range. No row you read changed;
the set of matching rows did.

```
T1: SELECT * FROM orders WHERE amount > 1000;    -- 5 rows
T2: INSERT INTO orders (amount) VALUES (2000); COMMIT;
T1: SELECT * FROM orders WHERE amount > 1000;    -- 6 rows
```

**Lost update**: two transactions read the same value, each computes a new
value from what it read, and the second write silently overwrites the first.
It is not in the standard's anomaly table, but interviewers love it.

```
T1: SELECT balance FROM users WHERE id = 1;   -- reads 100
T2: SELECT balance FROM users WHERE id = 1;   -- reads 100
T1: UPDATE ... SET balance = 150; COMMIT;     -- +50
T2: UPDATE ... SET balance = 130; COMMIT;     -- +30, T1's +50 is gone
```

The fixes: make the update atomic (`SET balance = balance + 50`, so read and
write are one statement), lock the row when reading it with
`SELECT ... FOR UPDATE`, or use an optimistic version check. The last two
are shown in the Locking section of this step.

The four standard levels, weakest to strongest:

| Level | Dirty read | Non-repeatable | Phantom | Perf |
|---|---|---|---|---|
| Read Uncommitted | possible | possible | possible | fastest |
| Read Committed | prevented | possible | possible | fast |
| Repeatable Read | prevented | prevented | possible (mostly) | slower |
| Serializable | prevented | prevented | prevented | slowest |

- **Read Uncommitted** sees other transactions' uncommitted writes. Almost
  never used.
- **Read Committed** sees only committed data, and each statement gets a
  fresh **snapshot** [a fixed, consistent view of the database as of one
  instant]. This is the **Postgres and Oracle default**. It stops dirty
  reads and nothing else.
- **Repeatable Read** takes one snapshot for the whole transaction, so
  re-reads return the same data. This is the **MySQL InnoDB default**. It
  stops dirty and non-repeatable reads. The standard still permits phantoms
  here (the "mostly" in the table), but InnoDB in practice stops them too,
  using **gap locks** [locks on the gaps between index rows, blocking
  inserts into that range].
- **Serializable** makes transactions appear to run one at a time and stops
  every anomaly. Implementations use **predicate locks** [locks on the
  query's condition itself, such as `amount > 1000`, not just on the rows it
  happened to match] or **SSI (serializable snapshot isolation)** [run
  transactions against snapshots, detect conflicts at commit time, and abort
  one of the conflicting transactions]. It is the heaviest level; use it
  where a wrong answer costs money, such as ledgers and inventory.

> **Interview phrasing:** "Read Committed re-snapshots per statement,
> Repeatable Read snapshots once per transaction, Serializable makes the
> outcome equal to some one-at-a-time order. Postgres defaults to Read
> Committed, InnoDB to Repeatable Read."

## Locking: Who Waits for Whom

Writes to the same row cannot safely overlap, so the database makes
latecomers wait. This section is the two kinds of lock that enforce the
waiting, and the two strategies for when to take one.

Two transactions reach the same row at the same moment, and at least one of
them wants to write it. Somebody has to wait. A **lock** [the database's
record of who may touch a row right now] is what enforces this; a
transaction that cannot get the lock it needs blocks until the holder
finishes.

There are two lock modes:

- **Shared (S)**: taken for reading. Many transactions can hold a shared
  lock on the same row at the same time.
- **Exclusive (X)**: taken for writing. Only one transaction can hold it,
  and it blocks all other readers and writers.

| You request | Someone holds S | Someone holds X |
|---|---|---|
| Shared | granted | you wait |
| Exclusive | you wait | you wait |

The discipline for holding them has a name: **two-phase locking (2PL)** [a
growing phase in which the transaction only acquires locks and never
releases, then a shrinking phase in which it only releases and never
acquires]. 2PL guarantees **serializability** [the interleaved execution
produces a result that some one-at-a-time ordering could also have
produced].

When to take the lock is a strategy choice, and the deciding factor is
**contention** [how often transactions actually collide on the same rows].

**Pessimistic locking** assumes collisions will happen: lock at read time
with `SELECT ... FOR UPDATE` and hold the lock until commit, so nothing can
slip in between the read and the write. Good for high contention.

```sql
BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;  -- row locked now
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;                                          -- lock released
```

**Optimistic locking** assumes collisions are rare: read without any lock,
carry a version number, and make the update conditional on the version being
unchanged. If it changed, the update matches zero rows, and you re-read and
retry. Good for low contention, and for long transactions where holding a
lock the whole time would be expensive.

```sql
SELECT balance, version FROM accounts WHERE id = 1;  -- version = 5
UPDATE accounts SET balance = 0, version = 6
WHERE id = 1 AND version = 5;
-- 0 rows affected -> someone updated first; reread and retry
```

> **Interview phrasing:** "Pessimistic locking assumes conflict and pays up
> front with waiting; optimistic locking assumes none and pays on collision
> with a retry. Choose by contention."

## MVCC: Versions Instead of Waiting

Instead of making readers and writers wait for each other, the database
keeps several versions of every row and shows each transaction only the
versions it is entitled to see. That is the entire idea of this section.

Under pure locking, readers and writers get in each other's way: a long
read holds shared locks that stall every writer, and one writer stalls every
reader of that row. **MVCC (multi-version concurrency control)** is how
Postgres and most modern databases let reads and writes run concurrently
without blocking each other.

The core idea: keep **multiple versions** of each row. A writer never
overwrites a row in place; it creates a new version. A reader never waits;
it reads from a consistent **snapshot** [a fixed view of the data as of one
point in time], seeing only versions that were committed when it started.

In Postgres, every row version carries two hidden columns:

- `xmin`: the ID of the transaction that created this version
- `xmax`: the ID of the transaction that deleted or updated it (0 if the
  version is still live)

A transaction sees a version when `xmin` committed before the transaction
started, and `xmax` is 0 or committed after it started.

```
versions of users.id = 1:
  xmin=100, xmax=150, balance=100   <- deleted by txn 150
  xmin=150, xmax=0,   balance=80    <- live
```

T200 (started after transaction 150) sees balance 80. T120 (started before
150) still sees 100. Both read the same logical row at the same moment, and
neither takes a lock to do it.

Why it matters: readers do not block writers and writers do not block
readers, so high read concurrency creates no lock contention. The tradeoff:
dead versions pile up in the table, and **VACUUM** [the Postgres process
that finds row versions no live transaction can still see and reclaims
their space] must run, or the table bloats.

> **Interview phrasing:** "MVCC keeps multiple row versions. Each
> transaction reads from a snapshot at its start time, seeing only versions
> committed before it. Readers and writers don't block each other because
> they touch different versions. The cost is storage from old versions,
> cleaned by VACUUM."

## Storage Pages and the Query Pipeline

Under the SQL, a table is a set of fixed-size blocks on disk plus a cache
in RAM, and a query becomes a plan for reading those blocks as cheaply as
possible.

You send a SELECT and rows come back. Two mechanical questions hide inside
that: where a row physically lives, and how a string of SQL turned into
disk reads.

**Where rows live.** Data is stored in fixed-size **pages** [the block a
database reads and writes disk in, as one unit]: 8KB in Postgres, 16KB in
MySQL InnoDB. A table's pages form its **heap file** [an unordered set of
pages; a row sits wherever there was room]. The **buffer pool** [the
database's cache of pages in RAM] holds the hot pages; a read served from
it is orders of magnitude faster than one that goes to disk, which makes
buffer-pool size one of the top performance levers.

**Sequential beats random.** A table scan reads pages in order, so the OS
can **prefetch** [read the next pages before they are asked for]. Chasing
index pointers to rows scattered across the heap is random access: many
seeks, no prefetch. This is why a full scan can beat an index scan for a
**low-selectivity** query [one that matches a large fraction of the table]:
the index pays a random read per matching row, the scan streams every page
once.

**From SQL to rows.** Every query passes through four stages:

```
 SQL text --> parse --> analyse/bind --> plan/optimise --> execute
```

1. **Parse**: turn the SQL text into a **parse tree (AST)** [abstract
   syntax tree: the query as a nested data structure of clauses rather than
   a string]. Syntax is checked here.
2. **Analyse/bind**: resolve every table and column name against the
   schema.
3. **Plan/optimise**: generate candidate plans (join order, index use),
   estimate each plan's cost, pick the cheapest.
4. **Execute**: run the chosen plan and return rows.

The planner's cost estimates come from **statistics** [row counts and value
distributions per table, stored in `pg_statistic` in Postgres]. Stale
statistics cause bad plans; the fix is `ANALYZE`, which recollects them.

**How joins run.** The planner chooses among three algorithms:

- **Nested loop**: for each row of A, scan B for matches. O(n×m). Good for
  small inputs, or when an index serves the lookup into B.
- **Hash join**: build a hash table on the smaller input, probe it with
  each row of the larger. O(n+m). Good for large unsorted inputs.
- **Merge join**: sort both inputs on the join key, then merge in one pass.
  Good when the inputs are already sorted, typically because an index
  provides them in order.

> **Interview phrasing:** "A query is parsed into a tree, bound against the
> schema, planned by cost using table statistics, then executed. Stale
> statistics mean wrong estimates and bad plans; ANALYZE refreshes them."
$body$, step = 2
  WHERE title = 'Transactions, Concurrency & Internals';

UPDATE questions.bank SET lesson_md = $body$## The CAP Theorem

Once your data lives on more than one machine, the network between those machines will sometimes fail. The CAP theorem is the rule that, while it is failing, a system must choose between answering correctly and answering at all.

### Start with a broken cable

Your data has outgrown one machine, or has to survive one machine dying, so the same rows now live on two **nodes** [a node is one machine in a cluster] in two buildings. One night the link between the buildings fails. Both nodes are healthy and both keep taking traffic; they just cannot hear each other. That situation, the network splitting a cluster into groups that cannot exchange messages, is a **network partition**.

Now watch one request pair go wrong:

```
   client 1                              client 2
      |  write x=2                          |  read x
      v                                     v
   [node A] ~~~~~~ network cut ~~~~~~~  [node B]
    x = 2                    x = 1, never heard about x=2
```

Node B has exactly two honest moves: answer with the value it has, which may be stale, or refuse to answer. There is no third move, because the information it would need is on the far side of a dead link. That forced choice is the content of the **CAP theorem**: a distributed system can guarantee only **two** of three properties.

- **C, Consistency:** every read sees the most recent write, or gets an error.
- **A, Availability:** every request gets a non-error response, though it may be stale.
- **P, Partition tolerance:** the system keeps working when the network drops or delays messages between nodes.

The catch that makes the theorem practical: partitions *will* happen (cables get cut, switches die, congestion delays messages until they might as well be lost), so P is mandatory. The real decision is what to sacrifice while a partition is in progress:

- **CP:** reject requests rather than serve stale data. The right trade for financial systems and inventory.
- **AP:** keep serving, possibly stale, data. The right trade for feeds, DNS, shopping carts.

| System | Type | Why |
|---|---|---|
| HBase | CP | Errors rather than stale data |
| MongoDB (default) | CP | One primary takes writes; the minority side of a partition has none, rejects writes |
| Cassandra | AP | Serves during partition, eventual consistency |
| DynamoDB | AP (configurable) | Eventually consistent by default, strong optional |
| Postgres/MySQL | CA* | Single node, no partition concern |
| Zookeeper | CP | Leader election needs consistency |

*CA only makes sense on a single node; any real distributed system must handle partitions.

### What AP costs: eventual consistency

An AP system's nodes may disagree while a partition lasts; once it heals they converge on one value. That guarantee, "the copies agree eventually rather than at every instant," is **eventual consistency**, and it shows up in three concrete ways even without a dramatic outage:

- **Replication lag:** replicas trail the primary by roughly 10-500ms, so a read fired right after a write may see the old value.
- **Read-your-own-writes:** you post a comment, the next page load reads from a stale replica, and your own comment is missing. The fix is routing: send reads that follow a user's own writes to the primary.
- **Last-write-wins (LWW):** Cassandra resolves conflicting writes by comparing timestamps. **Clock skew** [two machines' clocks disagreeing] can therefore let an older write overwrite a newer one, because "older" is judged by clocks that lie.

> **Interview phrasing:** "Partitions are not optional, so CAP is really one question: while the network is broken, do you return an error or possibly stale data?"

## Key-Value: Redis

Redis is a store that keeps data in memory rather than on disk, so reads and writes cost microseconds instead of milliseconds. You put it in front of your database to absorb the repeated reads.

### Start with the queries you keep repeating

Every request to your app hits the database for the same handful of rows: the session row proving who the user is, the same hot product list, a counter. Each of those is a disk-backed query costing milliseconds and a connection, repeated thousands of times a second for answers that barely change. The fix is to keep the hot data in RAM under a name you choose. That is **Redis**: an in-memory **key-value store** [a store that holds values under exact string keys, with no query language over their contents], where reads and writes complete in microseconds.

RAM vanishes on restart, so persistence is optional and explicit: **RDB** [point-in-time snapshots of the whole dataset written to disk] or an **AOF** [append-only file: a log of every write, replayed on restart to rebuild the data].

The values are not only strings. Each structure exists because some common job needs it:

| Structure | Commands | Use case |
|---|---|---|
| String | GET, SET, INCR | Cache, counters, sessions |
| List | LPUSH, RPOP, LRANGE | Queues, activity feeds |
| Set | SADD, SINTER | Tags, unique visitors, dedupe |
| Sorted Set | ZADD, ZRANGEBYSCORE | Leaderboards, rate limiting, priority queues |
| Hash | HSET, HGETALL | Objects, user profiles |
| Bitmap | SETBIT, BITCOUNT | Feature flags, daily-active-user tracking |
| HyperLogLog | PFADD, PFCOUNT | Approximate unique counts at scale |

One property cuts across all of them: any key can carry a **TTL** [time to live: a countdown after which the key deletes itself].

```
SET session:abc data EX 3600    # this session vanishes in one hour
```

TTL is core to sessions and to cache invalidation: stale cache entries do not need a cleanup job, they expire.

**Use Redis for:** caching (the most common use by far), sessions, rate limiting (INCR plus a TTL), pub/sub, distributed locks (`SET key val NX EX 30`), leaderboards (sorted sets).

**Why it does not replace your database:** RAM is expensive, durability is optional (turning the AOF on adds cost to every write), and there are no complex queries, only key lookups and structure operations. Use Redis as a cache in front of Postgres or MySQL, not as the primary store.

> **Interview phrasing:** "Redis sits in front of the database, not in place of it: RAM is expensive, durability is opt-in, and there is no query language."

## Documents: MongoDB

MongoDB stores each record as one self-contained document, shaped like a JSON object, instead of rows spread across fixed tables. The whole design question becomes what to put inside a document and what to keep outside it.

### Start with a table that will not hold still

You are building a product catalogue. A laptop has CPU and RAM fields; a t-shirt has size and colour; next month someone adds gift cards with neither. One SQL table needs a column for every field any product might ever have, almost all of them NULL for any given row. MongoDB removes the fixed shape: it stores each record as a **document** [a JSON-like object, held internally in a binary format called BSON], and documents in the same **collection** [MongoDB's equivalent of a table] need not share a schema.

The second idea is where the design skill lives: instead of joining across tables, you can nest related data inside one document. There are two ways to model a relationship, and choosing between them is the main MongoDB decision.

**Embedding** puts the related data inside the document itself:

```json
{ "_id": "user123", "name": "Will",
  "addresses": [ {"type": "home", "city": "Singapore"} ] }
```

What you gain: one read fetches everything, and an update confined to a single document is atomic. The trap: if the embedded array can keep growing (every order a user ever placed, say), the document grows without bound.

**Referencing** keeps separate collections linked by ID, the same move as a foreign key in SQL:

```json
{ "_id": "user123", "name": "Will" }                       // users
{ "_id": "order456", "user_id": "user123", "total": 99 }   // orders
```

What you gain: no bloat, and each side lives and changes independently. The cost: fetching both takes extra queries, or `$lookup` (MongoDB's join).

**The rule:** embed when the data is accessed together and bounded in size; reference when it is large, accessed independently, or shared between parents.

**Use MongoDB for:** records whose fields vary (the mixed catalogue above), document-centric data (posts with their comments), and rapid schema iteration early in a product's life. **Not for:** complex cross-collection joins or highly relational data. Multi-document transactions exist (since version 4.0) but are costly; if you find yourself needing them everywhere, the data is telling you it wanted SQL.

> **Interview phrasing:** "Embed what you read together and can bound; reference what is large, shared, or read on its own."

## Wide Columns: Cassandra

Cassandra is a database with no machine in charge: every node accepts writes, so write capacity grows as the cluster grows. The price is giving up joins and instant consistency.

### Start with a million sensors

A million sensors each report a reading every second. A database with a single leader funnels every one of those writes through one machine, and that machine becomes the ceiling on the whole system. **Cassandra** removes the funnel: it is a distributed, **masterless** [no primary node; every node is equal and any node can accept a write] **wide-column store** built for huge write throughput and high availability. Data is automatically replicated across nodes, and in CAP terms it is AP: it keeps serving during a partition and converges afterwards.

Its data model is two keys with two different jobs. The **partition key** decides which node stores a row; the **clustering key** decides the sort order of rows within that partition. (A **partition** here means the group of rows sharing one partition key, living together on one node; it is not the network failure from the CAP section.)

```sql
CREATE TABLE sensor_data (
    sensor_id  UUID,
    timestamp  TIMESTAMP,
    value      DOUBLE,
    -- partition key: sensor_id, clustering key: timestamp
    PRIMARY KEY (sensor_id, timestamp)
);
```

All rows for one `sensor_id` sit together on one node, sorted by `timestamp`, so a query that stays inside a single partition ("this sensor, this time range") is very fast.

**Strengths:**

- **Write-optimised:** a write goes to an in-memory **memtable** [the in-RAM table that absorbs writes] plus an append-only **commit log** on disk. Both are sequential appends with no locks, which is why the write path is so fast.
- **Linear horizontal scaling:** add nodes and capacity grows in proportion.
- **High availability:** a configurable **replication factor** [how many nodes hold a copy of each row], and consistency tunable per query (for example `QUORUM`: a majority of the replicas must respond).

**Limitations:**

- No joins; the design unit is one table per query pattern.
- Aggregations (SUM, GROUP BY) work only within one partition. Analytics happen in application code or Spark, not in Cassandra.
- An update is just a new timestamped write, and a delete is a **tombstone** [a marker recording that the value was deleted; too many of them degrade reads, which must skip past them].
- The schema is query-driven: you pick the queries first, then design the tables to serve them, the reverse of relational modelling.

**Use Cassandra for:** time-series data (IoT, metrics, logs), write-heavy workloads, systems that must stay available always, and anywhere eventual consistency is acceptable.

> **Interview phrasing:** "You design Cassandra tables from your queries, not your entities: one table per query pattern."

## Choosing: SQL vs NoSQL

There is no best database, only a best fit for each job. The working default is SQL; you move to a NoSQL store only when you can name the specific pressure it relieves.

### Start with the question as interviewers ask it

The interview form of this whole step is one question: "would you use SQL or NoSQL for X, and why?" The defensible default is SQL, and you move off it only when you can name the specific pressure pushing you.

**Use SQL (Postgres, MySQL) when:**

- **ACID** matters [atomicity, consistency, isolation, durability: a transaction happens completely or not at all, and once committed it survives]: banking, payments, inventory, bookings.
- You need **complex queries and joins** across entities.
- The schema is **stable and well-defined**.
- You want **relational integrity** enforced by the database itself, through foreign keys and constraints.
- Scale is moderate. SQL handles millions of rows comfortably with indexing plus read replicas.

**Use NoSQL when a specific need matches a specific tool:**

| Need | Tool | Why |
|---|---|---|
| Cache, sessions, counters | Redis | In-memory, rich structures, TTL |
| Flexible schema, documents | MongoDB | Embed nested data, schema-free |
| Massive writes, time-series | Cassandra | Write-optimised, scales horizontally |
| Global scale, serverless | DynamoDB | Managed, single-digit-ms latency |
| Full-text search | Elasticsearch | Inverted index, ranking, fuzzy |
| Graph relationships | Neo4j | Native, fast traversals |

The classic composite question is a **chat system**, and the answer is a split: NoSQL (Cassandra or HBase) for the messages, SQL for the user and channel metadata.

- *Messages:* huge write volume, always read the same way (one channel, one time range, which is exactly a partition key plus a clustering key in the Cassandra layout from the previous section), no joins needed, and the product must stay available.
- *Users and channels:* genuinely relational, benefit from ACID and flexible queries, and arrive at far lower volume.

> **Interview phrasing:** "Messages go in Cassandra, users go in Postgres: choose per workload, not one store for everything."

## Replication and Sharding

A database outgrows one machine in two different ways, and each way has its own tool. **Replication** gives several machines full copies of the *same* data; **sharding** gives each machine a *different* piece of it.

### Start with one machine out of headroom

Your database machine is saturated, but "too much" hides two different problems. Too many reads of the same data is one problem; too much data, or too many writes, for one box is the other. Replication answers the first and sharding the second, and the two are orthogonal: you can use either, or both at once.

### Replication: copies of the same data

In the common **leader-follower** design, all writes go to one node, the **leader**; the **followers** copy the leader's write log and serve reads.

```
                    writes
                       |
                       v
                  [ leader ]
                   |      |      ships its write log
                   v      v
           [follower]  [follower]
                ^           ^
                |           |
              reads       reads
```

The one design choice is when the leader acknowledges a write:

- **Async** (the common mode): the leader acks immediately and ships the write to followers later. Fast, but this is precisely the replication lag from the CAP section (replicas trailing by roughly 10-500ms), and a leader crash can lose the newest writes: acked, never shipped.
- **Sync:** the leader waits for a follower's ack before answering. No loss, but writes are slower, and the system stalls if the follower is down.

Be precise about what replication buys: read scale, and **failover** [when the leader dies, promote a follower to be the new leader]. It does *not* buy write scale, because every write still funnels through one leader.

### Sharding: splitting the data itself

**Sharding** (also called horizontal partitioning) splits the rows across nodes by a **shard key**: for example `hash(user_id) % N` over N nodes, or ranges of the key. Now writes and storage scale, because different rows land on different machines. The costs: any query, join, or transaction that crosses shards becomes hard, and a badly chosen key creates a **hotspot** [one shard receiving a disproportionate share of the traffic while the rest sit idle].

There is also a trap inside the naive formula itself: `hash % N` depends on N, so when the node count changes, nearly every key remaps to a different node and the whole dataset migrates.

**Consistent hashing** fixes the remap problem. Place both nodes and keys on a **hash ring** [the hash space treated as a circle, so the largest value wraps around to zero]; each key belongs to the next node walking clockwise from where it lands.

```
 the ring, shown flattened:

   0 ----A---------B--------C----------A again ...
                ^
                key k lands here, walks clockwise,
                belongs to B

   remove B: only the keys between A and B move on
   to C. Everything owned by A and C stays put.
```

Adding or removing a node now remaps only about 1/N of the keys (the departed node's neighbours' share), not everything. Cassandra and the Dynamo-style stores use exactly this, plus **virtual nodes** [each physical server appears at many positions on the ring], which spreads each server's share around the circle and evens out the load.

> **Interview phrasing:** "Replication buys read scale and failover, never write scale; sharding buys write scale and costs you cross-shard queries."
$body$, step = 3
  WHERE title = 'NoSQL, CAP Theorem & When to Use What';

UPDATE questions.bank SET lesson_md = $body$## The Layer Map

Networking is built as a stack of **layers**: each layer solves one delivery
problem and treats the layer below as a finished service. This map of layers
is the frame the rest of networking hangs on.

You click a link. The request crosses your wifi, your home router, a dozen
machines you do not control, and lands in one process on a server in another
country. No single piece of software understands that whole journey; each
layer handles one step of it.

Two models name the layers. **OSI** [Open Systems Interconnection, a
seven-layer reference model] is conceptual. **TCP/IP** is the four-layer
model the internet actually uses. Know both, and how they map:

```
OSI (7 layers)              TCP/IP (4 layers)
7. Application  \
6. Presentation  +------->  Application      HTTP, DNS, SMTP
5. Session      /
4. Transport    --------->  Transport        TCP, UDP
3. Network      --------->  Internet         IP, ICMP
2. Data Link    \
1. Physical      +------->  Network Access   Ethernet, WiFi
```

What each layer owns, bottom up:

- **Physical:** raw bits over a medium (a cable, radio).
- **Data Link:** node-to-node delivery between machines on the same local
  network, using **MAC addresses** [the fixed hardware address of a network
  card] carried in **Ethernet frames** [the data-link unit: a block of bytes
  with the MAC addresses at the front].
- **Network:** routing packets across networks. IP addresses live here, and
  **routers** [machines that read a packet's destination address and forward
  it one network closer] do the moving. So does ICMP [the internet layer's
  control and error protocol].
- **Transport:** process-to-process delivery. Ports, TCP and UDP.
- **Application:** the protocols programs speak: HTTP, DNS, SMTP, WebSocket.

Each layer's message travels as the data of the layer below: a TCP segment
goes inside an IP packet, which goes inside an Ethernet frame.

The map is also a debugging tool: narrow the fault by layer. Does the name
resolve (application, DNS)? Do packets route (network)? Is the cable or wifi
even up (physical)?

> **Interview phrasing:** "Each layer treats the one below as a delivery
> service and adds one guarantee of its own; on the wire, a TCP segment rides
> inside an IP packet inside an Ethernet frame."

## IP Addresses and NAT

An IP address is a machine's number on the network. It does two jobs at
once: it names one machine uniquely, and its structure tells routers which
direction to forward a packet.

A router in the middle of the internet has never heard of your machine. It
sees only the destination address on your packet, and from that alone it
must pick a direction, without a list of every machine on earth.

- **IPv4** addresses are 32 bits, written as four decimal **octets** [an
  octet is 8 bits, one number from 0 to 255]: `192.168.1.1`. That allows
  about 4 billion addresses, which have run out; hence IPv6.
- **IPv6** addresses are 128 bits, written as eight groups of hex:
  `2001:db8:85a3::8a2e:370:7334`. Effectively unlimited.

The structure part is **CIDR** notation [Classless Inter-Domain Routing: an
address, a slash, and a prefix length]. `192.168.1.0/24` means the first 24
bits are the **network prefix** [the part of the address shared by every
machine on one network], leaving 8 bits for hosts: 256 addresses, 254 usable.
Routers decide on the prefix alone, so one table entry covers a whole
network.

Three ranges are **private**, meaning no internet router will carry them:
`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. Every other address is
**public**.

Private addresses create an obvious problem: your home has one public IP and
a dozen devices, each holding an address the internet refuses to route.
**NAT** [Network Address Translation] is the router's fix: it rewrites
outbound traffic so it all appears to come from the router's one public IP,
and it tracks which inside device each response belongs to.

> **Interview phrasing:** "Private ranges plus NAT are how 4 billion IPv4
> addresses stretched this far: an entire network hides behind one public
> address."

## TCP vs UDP

Almost all internet traffic rides one of two transport protocols: TCP, which
guarantees data arrives complete and in order, and UDP, which sends it once
and moves on. Every difference between them follows from that choice.

IP carries a packet to the right machine, and that is its whole promise.
Packets can be lost, duplicated, or arrive out of order, and the address
names a machine, not the process on it that wants the bytes. The transport
layer closes the addressing gap with ports, and offers two answers to the
reliability gap.

**TCP** [Transmission Control Protocol] is reliable, ordered, and
connection-oriented.

- **Reliable:** every **segment** [TCP's unit: one chunk of the byte stream
  with a TCP header on it] is **ACKed** [acknowledged: the receiver reports
  what it has received]; segments not acknowledged in time are retransmitted.
- **Ordered:** segments are numbered, and the receiver reassembles them in
  order before handing bytes to the application.
- **Flow control:** the receiver advertises a window size, so a fast sender
  cannot overwhelm a slow receiver.
- **Congestion control:** the sender watches for signs the network itself is
  overloaded and slows down.
- **The cost:** the handshake, the ACKs and the retransmissions are all
  overhead.
- **Use it when** data must arrive complete and in order: HTTP(S), SSH, FTP,
  SMTP, database connections.

**UDP** [User Datagram Protocol] is fast, connectionless, and best-effort. No
handshake, no ACKs, no ordering, no retransmission. In exchange: very low
latency, low per-packet overhead, and no **head-of-line blocking** [one lost
packet forcing everything that arrived after it to wait until the loss is
repaired]. **Use it when** speed beats reliability, with the application
handling reliability itself if it needs any:

- **DNS:** queries are tiny and easy to retry.
- **Video and VoIP:** skip the late frame; stale audio is useless.
- **Gaming:** the latest state matters, not old state delivered in order.
- **QUIC (HTTP/3):** builds its own reliability and multiplexing on top of
  UDP.

| | TCP | UDP |
|---|---|---|
| Connection | Yes (handshake) | No |
| Reliability | Guaranteed (ACK + retransmit) | None |
| Ordering | Guaranteed | None |
| Speed | Slower | Faster |
| Use cases | HTTP, SSH, DB | DNS, video, gaming, QUIC |

> **Interview phrasing:** "TCP gives a reliable, ordered byte stream and pays
> with a handshake, ACKs and retransmissions; UDP gives raw best-effort
> datagrams and leaves anything stronger to the application."

## A TCP Connection's Life

A TCP connection has a shape: a handshake opens it, a four-message goodbye
closes it, and in between the sender constantly adjusts how fast it may
send. This section follows that life from open to close.

Before the first byte of data, both machines need things settled: the
network may still carry stale packets from an earlier connection between
them, and each side needs proof the other can both send and receive. The
**three-way handshake**, run before any data flows, settles both:

```
Client                                Server
  |--- SYN (seq=x) --------------->|  "connect; my seq starts at x"
  |<-- SYN-ACK (seq=y, ack=x+1) ---|  "ok; my seq is y, got your x"
  |--- ACK (ack=y+1) ------------->|  "got it; established"
  |========== DATA FLOWS ==========|
```

Why three steps? Both sides must agree on **initial sequence numbers
(ISNs)** [the starting values each side uses to number its bytes], and each
must prove it can send and receive: SYN proves the client can send, SYN-ACK
proves the server can receive and send, the final ACK proves the client can
receive. ISNs are randomized so stale packets from an old connection are not
mistaken for current ones.

### Teardown

Closing is four-way, and either side may start it:

```
  |--- FIN --->|   "done sending"
  |<-- ACK ----|
  |<-- FIN ----|   "done too"
  |--- ACK --->|
```

After sending that final ACK, the initiator enters **TIME_WAIT**, holding
the connection's identity for twice the **MSL** [maximum segment lifetime,
the longest a segment may survive in the network]; about 60 seconds on
Linux. Two reasons: it can resend that ACK if a lost one makes the peer
repeat its FIN, and stray packets from this connection die off instead of
leaking into a new connection on the same port. The visible consequence:
restart a server quickly and binding fails with "address already in use",
because the port is still in TIME_WAIT. The fix is the `SO_REUSEADDR`
socket option.

### Congestion control

A sender has no idea how much traffic the path to the receiver can carry, so
TCP probes for bandwidth and backs off on loss:

- **Slow start:** begin with a small **congestion window (cwnd)** [the amount
  of data the sender lets itself have in flight, unacknowledged]; double it
  every **RTT** [round-trip time] until a threshold is reached or a loss
  occurs.
- **Congestion avoidance:** past the threshold, grow linearly instead: one
  **MSS** [maximum segment size, one full-size segment] per RTT.
- **On loss:** assume the network is congested, and halve cwnd.

The weak spot is that last rule: TCP reads every loss as congestion, so a
link that drops packets for other reasons (cellular) makes TCP slow down
again and again. This is why latency-sensitive applications prefer UDP, and
why HTTP/3 uses QUIC, with its own congestion control on top of UDP.

> **Interview phrasing:** "Three steps because each side must prove it can
> send and receive, and both must exchange randomized initial sequence
> numbers so old packets cannot pollute the new connection."

## Ports and Sockets

An IP address gets bytes to the right machine. Ports get them to the right
program on that machine, and a socket is what a program holds to send and
receive.

The machine your packet reaches is running a web server, a database and an
SSH daemon at once, and nothing in the IP header says which of them the
bytes are for. That last hop, machine to process, is the port's job.

A **port** is a 16-bit number (0 to 65535) identifying a process on a host.
The range is carved up by convention:

- **0-1023, well-known:** fixed meanings everyone relies on: HTTP 80, HTTPS
  443, SSH 22, DNS 53, SMTP 25.
- **1024-49151, registered:** claimed by specific applications.
- **49152-65535, ephemeral** [short-lived; assigned by the OS for the client
  end of a connection].

Connect to `api.example.com:443` and the destination port is 443; the OS
assigns the source port from the ephemeral range. The 4-tuple `(client IP,
client port, server IP, server port)` uniquely identifies the connection,
which is how one server holds thousands of connections all arriving at
port 443.

A **socket** is the software endpoint for network I/O, and to your program it
is simply a **file descriptor** [a small number the OS gives a program as its
handle on an open file or connection] that you read and write. The call
sequences:

```
Server: socket() -> bind(IP:port) -> listen() -> accept()
        -> read()/write() -> close()
Client: socket() -> connect(IP:port) -> read()/write() -> close()
```

The step that surprises people: `accept()` returns a **new** socket for each
client while the original keeps listening. That is how one server serves
many clients: one listening socket, one connected socket per client.

> **Interview phrasing:** "The listening socket never carries data; accept()
> hands back a fresh socket per client, and the 4-tuple keeps every
> connection on one port distinct."
$body$, step = 1
  WHERE title = 'The Network Stack & TCP/IP';

UPDATE questions.bank SET lesson_md = $body$## One Page, a Hundred Requests

Every HTTP version since the first has attacked the same problem: requests
waiting in line behind each other. This section is that one problem,
solved a little better in each version.

### Start with the problem

Load a news site and the browser fetches the HTML, then every stylesheet,
script, font and image it references: commonly dozens to a hundred
separate requests. Each one travels over **TCP** [the transport protocol
beneath HTTP: two machines set up a connection with a round-trip
handshake, and it then delivers bytes reliably and in order]. So the
question every version answers: how do a hundred requests share
connections without waiting on each other?

### HTTP/1.0: one connection per request

The original scheme: open a TCP connection, send one request, read one
response, close the connection. Every resource pays a full handshake
before any data moves. For a page with a hundred resources that is a
hundred setups and teardowns, very inefficient.

### HTTP/1.1: reuse the connection, still one at a time

HTTP/1.1 adds **persistent connections** (`keep-alive`): the connection
stays open after a response, and the next request reuses it. The handshake
is paid once, not per resource.

But requests on that connection are still **sequential**: the browser must
wait for response N before sending request N+1, so one slow response holds
up everything queued behind it. That is **head-of-line blocking** [the
item at the front of a queue stalling every item behind it]. The
workaround browsers settled on: open about 6 parallel connections per
domain, so six requests can be in flight at once. **Pipelining** (send
several requests without waiting, receive the responses in order) exists
in the spec but is rarely used and often broken in practice.

### HTTP/2: many streams on one connection

HTTP/2's answer is **multiplexing**: many requests and responses in flight
at once over one TCP connection. Each exchange is a **stream** with its
own ID, so no ordering between them is required; a slow response no longer
blocks the others at the HTTP level.

```
HTTP/1.1   A────A  B────B  C────C     one exchange at a time
HTTP/2     A1 B1 C1 A2 B2 C2 ...      interleaved frames, sorted
                                      back out by stream ID
```

Three more changes ride along:

- **Binary framing**: messages travel as binary frames, faster to parse
  than HTTP/1.1's text format.
- **HPACK** header compression: cuts the overhead of headers repeated on
  every request, like `Cookie` and `User-Agent`.
- **Server push**: the server can send a resource before it is asked for.
  Rarely used.

The limit: HTTP/2 still runs over TCP, and TCP promises in-order delivery
of the whole byte stream. Lose one segment [one TCP packet's worth of that
stream] and TCP holds back every byte behind it until the retransmit
arrives, which stalls all streams at once. Head-of-line blocking is back,
one layer down (TCP-level HOL blocking).

### HTTP/3: replace TCP with QUIC

HTTP/3 runs on **QUIC**, a transport built on **UDP** [the bare packet
protocol: no connection, no delivery guarantee, no ordering] that
implements reliability itself, separately per stream. A lost packet now
blocks only the stream it belonged to; the others keep flowing. The gains:
no TCP-level HOL blocking, faster setup (**0-RTT** on reconnect [zero
round trips: a returning client sends data in its very first packet]), and
better behaviour on lossy or cellular networks. HTTP/3 is now widely
supported by browsers and CDNs.

> **Interview phrasing:** "HTTP/2 fixed head-of-line blocking at the HTTP
> layer; HTTP/3 fixed it at the transport layer."

## Anatomy of a Request

An HTTP exchange is a **method** (what the client wants done) and a
**status code** (how it went). This section is those two vocabularies and
the promise each entry makes.

### Start with a retry

A client sends an order, the response times out, and the client retries.
Did the customer just buy twice? The answer is decided entirely by which
method the request used, and questions like it (retry or not, 401 or 403,
200 or 204) are what this section's two tables answer.

On the wire, a request is a small block of text:

```
POST /api/orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbG...

{"product_id": "abc123", "quantity": 2}
```

The first line names the method, a path, and the protocol version. Then
come **headers** [name: value lines attached to a request or response], a
blank line, and an optional body.

### Methods, and the two properties that matter

A method is **safe** if it has no side effects: calling it changes nothing
on the server. A method is **idempotent** if N calls have the same effect
as one, so repeating it is harmless.

| Method | Idempotent? | Safe? | Use |
|---|---|---|---|
| GET | Yes | Yes | Retrieve (no side effects) |
| POST | No | No | Create / trigger action |
| PUT | Yes | No | Replace resource entirely |
| PATCH | No* | No | Partial update |
| DELETE | Yes | No | Delete resource |
| HEAD | Yes | Yes | Like GET, no body |
| OPTIONS | Yes | Yes | List methods (CORS preflight) |

This is why the retry question has an answer: `PUT /orders/123` always
yields the same final state however many times it runs, so retrying it is
safe. `POST /orders` creates a new order each time, so the same retry
creates a duplicate. (*The asterisk: PATCH is not guaranteed idempotent;
a patch meaning "increment the quantity" gives a different result on every
run.)

**PUT vs PATCH:** PUT replaces the whole resource, so fields you omit get
cleared. PATCH updates only the fields you send.

### Status codes, know cold

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

The common gotcha in that table is **401 vs 403**. 401 means "who are
you?": the request is unauthenticated, because credentials are missing or
invalid. 403 means "I know you, but you can't do this": authenticated but
not authorized.

> **Interview phrasing:** "401 is an authentication failure; 403 is an
> authorization failure."

## Caching: Not Fetching Twice

Caching is keeping a copy of a response and reusing it instead of asking
the server again. HTTP controls it with two dials: how long a copy can be
trusted, and how to check cheaply whether it is still current.

### Start with the repeat download

Your site's stylesheet changes maybe once a month, and every visitor
downloads it on every page view. That is latency the user feels and
bandwidth you pay for, spent re-fetching bytes the browser already holds.
**HTTP caching** lets the browser, or a proxy on the path, reuse a stored
response instead of re-fetching it.

### Cache-Control: how long a response stays fresh

The server attaches a `Cache-Control` header to its response:

- `max-age=N`: fresh for N seconds. While fresh, the copy is served
  straight from cache without hitting the server at all.
- `public`: intermediaries (CDNs, proxies) may cache it too. `private`:
  the browser only.
- `no-store`: never cache this (sensitive data).
- `no-cache`: the cache may store it, but must revalidate with the server
  before every use. (The name misleads: it does not mean "don't cache".)
- `s-maxage=N`: like max-age, but for shared caches.

### Validation: asking "has it changed?" after expiry

When freshness runs out, the browser does not have to re-download; it can
revalidate, which costs a round trip but no body. Two header pairs do
this:

- **ETag**: the server sends `ETag: "abc123"` [an identifier for this
  exact version of the content, typically a content hash]. The browser's
  next request sends it back as `If-None-Match: "abc123"`. If the content
  is unchanged, the server answers `304 Not Modified` with no body; if it
  changed, a full `200` with the new content and a new ETag.
- **Last-Modified**: the server sends a date; the browser's next request
  carries `If-Modified-Since`; the server returns 304 or fresh content.

```
GET /styles.css   If-None-Match:"abc123"   (after expiry)
→ 304 Not Modified      (unchanged: no body, fast)
→ 200  ETag:"xyz456"    (changed: full new response)
```

### stale-while-revalidate: hide the check entirely

`Cache-Control: max-age=60, stale-while-revalidate=3600` says: fresh for
60 seconds, and for the next 3600 after that, serve the stale copy
instantly and revalidate in the background. The user never waits on the
check: no user-facing latency, at the price of sometimes seeing a copy
that is moments out of date.

> **Interview phrasing:** "max-age avoids the request entirely; an ETag
> avoids only the body."

## HTTPS and the TLS Handshake

HTTPS is ordinary HTTP sent over an encrypted connection. The encryption
is agreed in a short negotiation before any HTTP flows, and this section
is that negotiation.

### Start with the open wire

Plain HTTP is plaintext. Between browser and server sit the wifi network,
the ISP, and routers nobody you know controls, and anyone on that path can
read the traffic (passwords included) or alter it in transit. **HTTPS** is
HTTP wrapped in **TLS** [Transport Layer Security, the protocol that
encrypts a connection and verifies who is on the other end]. It has to
solve two problems at once: encrypt the traffic, and prove the server is
really the one you meant to reach.

### The handshake, step by step

1. **ClientHello:** the client sends its TLS version, the **cipher
   suites** [named combinations of encryption algorithms] it supports,
   and a client random value.
2. **ServerHello:** the server picks a cipher suite, sends its own random
   value, and its **certificate**: the server's public key, signed by a
   **CA** [certificate authority, an organization browsers are built to
   trust, which signs a certificate only after verifying who owns the
   domain].
3. **Verify the certificate:** the browser checks the CA chain of
   signatures, that the domain matches, and that it has not expired.
4. **Key exchange:** both sides run an algorithm (typically ECDHE) that
   lets each derive the same shared **session key** without ever sending
   it. An eavesdropper who recorded every byte still cannot reconstruct
   the key.
5. **Finished:** each side sends a message encrypted under the session
   key, confirming both derived the same one.
6. **Data:** all traffic now flows encrypted with the symmetric session
   key (e.g. AES-GCM).

### Why two kinds of cryptography

**Asymmetric** cryptography [a key pair: data encrypted with one key can
only be decrypted with the other; RSA and ECDHE are examples] can
establish a secret over a public channel, but it is slow. **Symmetric**
cryptography [one shared key for both directions; AES is the standard] is
fast, but both sides must already share the key. TLS uses each where it is
strong: the slow asymmetric step is paid once, in the handshake, to secure
the key exchange; the fast symmetric cipher then carries all the data
afterward.

One practical note: the spec allows HTTP/2 without TLS, but no browser
implements that, so in practice HTTP/2 needs TLS.

> **Interview phrasing:** "Asymmetric crypto is paid once to agree on a
> key; symmetric crypto carries all the data."

## Cookies and Sessions

HTTP has no memory: nothing connects one request to the next. A **cookie**
is a small piece of data the server hands the browser, and the browser
attaches it to every later request so the server can recognize you.

### Start with the server that forgets

You log in, and on the very next request the server treats you as a
stranger. Not a bug: HTTP is **stateless**, meaning each request stands
alone. But "logged in" is state, so state has to be added on top, and
cookies are the mechanism.

### The mechanism

After login, the server's response carries a header (shown wrapped here to
fit the page; on the wire it is one line):

```
Set-Cookie: session_id=abc123; HttpOnly; Secure;
  SameSite=Strict; Max-Age=3600
```

The browser stores the cookie and automatically attaches
`Cookie: session_id=abc123` to every later request to that site. The
server now has a thread connecting your requests.

### The flags, each blocking an attack

- `HttpOnly`: JavaScript on the page cannot read this cookie. Blocks
  cookie theft via **XSS** [cross-site scripting: an attacker gets a
  malicious script injected into your page, where it runs with the page's
  privileges].
- `Secure`: sent only over HTTPS, never in plaintext.
- `SameSite=Strict`: not sent on cross-site requests. Blocks **CSRF**
  [cross-site request forgery: another site triggers a request to yours,
  and the browser's auto-attach rule sends your cookies along with it].
  `SameSite=Lax` relaxes this: sent on top-level navigation only.
- `Max-Age=N`: expires after N seconds. Without it, it is a session
  cookie, gone when the browser closes.

### What the cookie points at: session vs JWT

The cookie carries an identifier; the design question is where the user's
actual data lives.

- **Server-side session:** the cookie holds only a session ID, and the
  server stores the data it maps to (in a database or Redis). Stateful.
  Easy to invalidate (delete the server-side record and the ID is dead),
  but every request pays a lookup.
- **JWT** [JSON Web Token: a token holding the user's claims, signed by
  the server]: the token itself carries the data, and the server only
  verifies the signature, no lookup. Stateless, and it scales well. The
  cost: hard to invalidate before it expires; the fix is a blocklist of
  revoked tokens, which re-adds exactly the lookup you were avoiding.

> **Interview phrasing:** "A session keeps state on the server and is easy
> to revoke; a JWT keeps state in the token and is hard to revoke."

## CORS and the Same-Origin Policy

By default the browser forbids one website's JavaScript from reading
another website's responses. **CORS** [cross-origin resource sharing] is
how a server grants exceptions, and the browser is the one enforcing all
of it.

### Start with the attack being prevented

You are logged in to your bank. In another tab you open a malicious page,
and its JavaScript fires a request at the bank's API. The browser attaches
your bank cookies automatically (that is what cookies do), so the request
arrives authenticated as you. If that page could also read the response,
any site you visit could read your data from any site you are logged in
to, riding on your credentials.

Browsers prevent this with the **Same-Origin Policy**: JavaScript on
`app.example.com` cannot read responses from `api.otherdomain.com`. An
**origin** is the combination scheme + host + port, so the http and https
versions of one host are already different origins.

### CORS: the server opting back in

Legitimate systems span origins too (a frontend on one domain calling an
API on another), so servers need a way to allow specific cross-origin
readers. CORS is that mechanism: the server declares its policy in
headers, and the browser enforces it.

- **Simple request (no preflight):** GET or POST with standard headers.
  The browser sends the request with an `Origin` header; the server
  replies with `Access-Control-Allow-Origin` naming that origin (or `*`);
  only then does the browser let the page's JS read the response.
- **Preflight:** for non-simple requests (PUT or DELETE, custom headers,
  a JSON content type), the browser asks permission first with an
  `OPTIONS` request before sending the real one:

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

`Access-Control-Max-Age: 86400` lets the browser cache the preflight
answer for a day instead of asking before every call.

### The bug everyone hits

CORS headers get added on the success path and forgotten on the error
path: present on 200 responses, missing on 4xx and 5xx. The browser needs
them on errors too; without them the JS cannot read the error response,
and the client sees a generic CORS failure instead of the real error.

> **Interview phrasing:** "CORS is enforced by the browser, not the
> server; the server only declares the policy."

## WebSockets

A **WebSocket** upgrades one HTTP request into a permanent two-way
channel: after the upgrade, either side can send at any time. It exists
because plain HTTP only lets the server answer, never speak first.

### Start with the message you never asked for

In a chat app, your screen has to change when the other person types. HTTP
cannot deliver that: it is strictly request then response, so when your
partner's message reaches the server, the server has news for you and no
request of yours to answer it with. A WebSocket fixes this by being
**full-duplex** [both directions at once: either side can send at any
moment, no request needed], unlike HTTP's request-and-response cycle.

### It starts as HTTP, then stops being HTTP

A WebSocket begins life as a normal HTTP request carrying an upgrade
offer:

```
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

→ HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
```

If the server answers `101 Switching Protocols`, the connection stays open
and changes character: from that point it carries raw WebSocket messages
in both directions and is no longer HTTP at all.

### The alternatives, side by side

| | Short polling | Long polling | WebSocket |
|---|---|---|---|
| How | Poll every N sec | Server holds request open until data | Persistent bidirectional |
| Latency | Up to N sec | Near real-time | Real-time |
| Overhead | High | Medium | Low after handshake |
| Use case | Periodic updates | Near-real-time over HTTP | Chat, collaboration, live data |

### Choosing

- **Use WebSockets** for real-time bidirectional needs: chat,
  collaborative editing, live dashboards, multiplayer games, sub-second
  notifications.
- **Don't use them** for periodic data (polling or **SSE** [server-sent
  events: one HTTP response the server holds open and appends events to,
  one-way] is simpler), for plain request/response work (ordinary HTTP is
  enough), or for flaky mobile clients, where keeping a persistent
  connection alive is hard.

> **Interview phrasing:** "A WebSocket starts life as an HTTP request;
> after the 101 it is no longer HTTP."
$body$, step = 2
  WHERE title = 'HTTP Deep Dive';

UPDATE questions.bank SET lesson_md = $body$## DNS: From Name to Address

Computers reach each other by number; people and programs use names. DNS is
the system that turns each name into a number, and both its speed and its
slowness come from the same place: caching.

### Start with the problem

Your program wants to talk to `api.example.com`, but to send anything it
must open a TCP connection, and TCP addresses machines by IP address, like
`93.184.216.34`. The name says nothing about which machine answers to it,
so before any request can leave, the name must be turned into an address.

The system that does this is **DNS** [the Domain Name System: a worldwide
directory mapping names to records, most importantly to IP addresses]. It
is **distributed** (no single machine holds all the names), **hierarchical**
(a name is resolved one level at a time, each level run by a different
authority), and **heavily cached** (most lookups are answered from a nearby
cache, not by walking the hierarchy).

### The lookup, step by step

The full chain, worst case:

```
browser cache -> OS cache -> recursive resolver -> root NS
                                                -> TLD NS (.com)
                                                -> authoritative NS
```

1. **Browser cache.** A recent, unexpired answer is used as is. Done.
2. **OS cache and hosts file.** The operating system keeps its own cache
   and checks `/etc/hosts` [a local file that pins names to addresses by
   hand].
3. **Recursive resolver** [a DNS server, run by your ISP or a public
   operator such as `8.8.8.8`, that performs the whole lookup on your
   behalf]. It checks its own cache first; on a miss it does the lookups
   below.
4. **Root nameservers.** There are 13 root server addresses, each served by
   many physical machines worldwide via **anycast** [one IP address
   announced from many locations, with routing delivering each query to the
   nearest machine]. The root does not know `example.com`; it answers
   "where is `.com`?" by pointing at the TLD servers.
5. **TLD nameserver** [top-level domain: the name's final label, such as
   `.com`, which is run by Verisign]. It points at the domain's
   authoritative server.
6. **Authoritative nameserver**, run by the domain's owner, returns the
   actual record: the IP.
7. The resolver caches the answer for its TTL (below) and hands it back.
   Only now can the TCP and TLS handshakes to that IP begin.

### Record types

A name does not map only to an IPv4 address. DNS stores several kinds of
record, all resolved the same way:

| Type | Maps | Example |
|---|---|---|
| A | domain → IPv4 address | `example.com → 93.184.216.34` |
| AAAA | domain → IPv6 address | `example.com → 2606:2800:...` |
| CNAME | domain → another domain | `www.example.com → example.com` |
| MX | domain → mail server | `example.com → mail.example.com` |
| TXT | arbitrary text (SPF, DKIM) | `"v=spf1 include:..."` |
| NS | domain → authoritative nameserver | `example.com → ns1.example.com` |

(SPF and DKIM are email-authentication policies published as text records.)

### TTL: why DNS changes feel slow

Every record carries a **TTL** [time to live: how many seconds a resolver
may keep the record before it must ask again]. The trade is direct: a short
TTL means changes reach clients fast but resolvers query your nameservers
more often; a long TTL means fewer queries but slow changes.

Old copies cannot be forced out: once a resolver somewhere has cached your
record with a TTL of 86400 seconds, nothing you do can make it forget
early, so a change can take up to 24 hours to be seen everywhere. What
people call "propagation" is just old caches expiring. Hence the standard
migration move: a day ahead, lower the TTL to 60 to 300 seconds, so every
old high-TTL copy has expired by the time you switch; make the change; then
raise the TTL back.

> **Interview phrasing:** "You cannot expire someone else's cache. DNS
> propagation is just the old TTL running out."

### Using DNS to steer traffic

Because DNS decides which IP a client ever sees, it is also the first place
load can be spread:

- **DNS round robin:** publish several A records for one name; resolvers
  cycle through them, so clients land on different servers. Crude: it
  ignores both server health and current load.
- **GeoDNS:** answer with a different IP by client location, so a client in
  Asia gets the address of the Singapore data centre.
- **Anycast**, now for the service itself: one IP announced from many
  locations via **BGP** [Border Gateway Protocol, the routing protocol
  networks use between themselves to announce which addresses they reach],
  so routing carries each client to the nearest node. Used by CDNs and
  DDoS-protection services.

### CDNs: caching at the edge

Your servers sit on one continent, your users on all of them, and physics
puts a floor under every cross-ocean round trip. A **CDN** [content
delivery network: Cloudflare, Akamai, CloudFront] answers with a global
fleet of **edge servers** [servers placed physically close to users] that
cache your content near the people requesting it.

- Clients reach the nearest edge via GeoDNS or anycast. A cache hit is
  served from the edge; on a miss the edge fetches from the **origin**
  [your own servers] and caches the response per its `Cache-Control` header
  [the HTTP header saying whether and how long a response may be cached].
- Wins: lower latency (the **RTT** [round-trip time] to a nearby edge is
  short), origin offload, and absorption of traffic spikes and DDoS.
- Best for static assets (JS, CSS, images, video). Modern CDNs also
  terminate TLS at the edge and can cache API GET responses.

## Load Balancing

One server handles your traffic until it cannot; after that you run several,
with one machine in front sharing the requests out. This section is how that
machine chooses a server, how much of each request it reads, and how it
notices a dead one.

### Start with the problem

For each incoming request, someone must decide which server takes it, and
clients cannot: they do not know which servers exist, which are healthy, or
which are busy. So the deciding machine sits in front: a **load balancer**,
which accepts every request and spreads the work across a **pool** of
backend servers. This buys throughput (N servers do N times the work) and
availability (a dead server can be skipped).

### Choosing a server: the algorithms

- **Round robin:** server 1, then 2, then 3, then back to 1. Simple, and it
  assumes the servers are equal.
- **Weighted round robin:** bigger servers get a larger share.
- **Least connections:** each request goes to the server with the fewest
  active connections. Best when request durations vary a lot: a server
  stuck on slow requests naturally stops receiving new ones.
- **IP hash:** hash the client's IP to pin that client to one server. This
  buys **session affinity** [the same client always landing on the same
  server], which matters when a server holds per-client state in memory.
  The flaw: add or remove a server and the hash outputs reshuffle,
  remapping nearly every client. The fix is the next algorithm.
- **Consistent hashing:** place servers and keys on a ring [the hash output
  space treated as a circle] and give each key to the first server
  clockwise from it.

```
              the hash ring

                  S1
              .        .
           k3            k1        each key is owned by the first
              .        .          server clockwise from it:
           S3            S2       k1 -> S2   k2 -> S3   k3 -> S1
              .        .
                  k2              remove S2: k1 moves to S3;
                                  k2 and k3 do not move at all
```

Adding or removing a server now remaps only about 1/N of the keys, not
nearly all of them. This is the key technique behind distributed caches
(Redis, Memcached), CDN edge selection [choosing which cache server a user
hits], and routing to shards [partitions of a larger dataset].

### L4 vs L7: how much the balancer reads

A balancer must read something of each request to route it, and the choice
is how deep. The names come from the network layering model: layer 4 is
transport (TCP and UDP), layer 7 is application (HTTP).

**L4 (transport):** routes by IP address and port only, forwarding TCP or
UDP traffic without ever reading the payload. Very fast, and blind to HTTP:
no URLs, headers, or cookies. Use for raw TCP, maximum throughput, and
latency-sensitive traffic.

**L7 (application):** speaks HTTP itself, so it can route by URL, hostname,
header, or cookie; terminate SSL/TLS [decrypt incoming traffic so backends
receive plain HTTP]; do session affinity with a cookie instead of an IP;
and run HTTP-level health checks. Examples: Nginx, HAProxy, AWS ALB. Use
for HTTP microservices, content-based routing, A/B tests, and canary
releases [sending a small slice of traffic to a new version].

> **Interview phrasing:** "An L4 balancer forwards by address and port and
> never reads the payload; an L7 balancer is itself an HTTP server that
> picks a backend based on the request's content."

### Health checks and zero-downtime deploys

Suppose one backend in a pool of three crashes. Round robin does not know,
so every third request fails. The balancer therefore probes its backends
continually with **health checks**, at three depths:

- TCP: can a connection even be opened?
- HTTP: does `GET /health` return a 200?
- Custom: does the response body contain `"status":"ok"`?

A backend that fails its checks is pulled from rotation and gets no traffic
until it passes again. The same machinery enables zero-downtime deploys,
one server at a time:

```
drain one server (send it nothing new, let current requests finish)
  -> deploy the new version onto it
  -> wait until its health check passes
  -> put it back in rotation, then repeat with the next server
```

## Three API Styles: REST, gRPC, GraphQL

An API style is an agreement about what requests and answers look like, and
about who controls the shape of the data. Three styles dominate, each the
right tool for a different job, and comparing them is a favourite interview
question.

### REST: resources and verbs

**REST** [representational state transfer: an architectural style for HTTP
APIs] models the API as a set of **resources**, named by noun URLs and
manipulated with the standard HTTP verbs:

- **Stateless:** each request carries everything the server needs; nothing
  depends on the server remembering a previous request.
- **Resources are nouns:** `/users/123/orders`, never `/getUserOrders`. The
  verb comes from HTTP, not the URL.
- **The verbs:** GET reads, POST creates, PUT and PATCH update, DELETE
  deletes.

```
GET    /users/123          get user
POST   /users              create user
PUT    /users/123          replace user
PATCH  /users/123          partial update
DELETE /users/123          delete user
GET    /users/123/orders   user's orders
```

Pros: universal, human-readable, stateless, and GET responses are easy to
cache. Cons: **over-fetching** [the endpoint returns fields this client
does not need], **under-fetching** [one screen needs several round trips to
different endpoints], and no strong typing.

### gRPC: function calls across the network

Between two services, REST gives you no checked, typed contract. **gRPC**
is Google's high-performance **RPC** framework [remote procedure call: a
request to another machine written as if calling a local function]. The
interface is a schema in a `.proto` file using **Protocol Buffers** [a
compact binary serialization format], carried over HTTP/2.

```protobuf
service OrderService {
    rpc GetOrder(OrderRequest) returns (Order);
    // server streaming: one request, a stream of replies
    rpc StreamOrders(UserRequest) returns (stream Order);
}
message OrderRequest { string order_id = 1; }
message Order {
    string order_id = 1;
    double total = 2;
    repeated string items = 3;
}
```

The `protoc` compiler generates client and server code in many languages
from that one file, so services in different languages share one typed
contract.

Pros: small, fast binary payloads; strong typing (the schema is the
contract); streaming built in; HTTP/2 multiplexing [many concurrent calls
on one connection]; great for polyglot microservices [services written in
different languages]. Cons: not human-readable on the wire; no native
browser support (browsers need a gRPC-Web proxy to translate); schema
changes need client and server coordination.

Use it for internal microservices where you own both ends, and for
performance-critical or streaming APIs.

### GraphQL: the client names its fields

REST's two cons made concrete: a mobile screen needs a user's name, email,
and the id and total of their last five orders; with REST that is several
endpoints, each returning extra fields. **GraphQL** inverts control: one
endpoint, and the **client asks for exactly the fields it wants**:

```graphql
query {
  user(id: "123") {
    name
    email
    orders(last: 5) { id total }
  }
}
```

The server returns exactly that shape and nothing more.

Pros: no over- or under-fetching; a single endpoint; self-documenting via
**introspection** [the schema itself can be queried, so tools can discover
the API]; great for nested data and fast-changing frontends. Cons: a harder
backend, chiefly N+1 queries (below); hard to cache, because every query
can differ; no HTTP verb semantics, since every request is a POST; overkill
for simple CRUD [create, read, update, delete].

The **N+1 problem**: resolving 10 users and then naively resolving each
user's orders runs 1 + 10 = 11 database queries. The standard fix is
**DataLoader** [a layer that batches and dedupes the lookups made while
resolving one query].

### The comparison

| | REST | gRPC | GraphQL |
|---|---|---|---|
| Protocol | HTTP/1.1 or 2 | HTTP/2 | HTTP/1.1 or 2 |
| Format | JSON (text) | Protobuf (binary) | JSON |
| Typing | loose (OpenAPI optional) | strong (proto) | strong (schema) |
| Streaming | limited (SSE/WS) | native (4 modes) | subscriptions |
| Browser | native | needs gRPC-Web | native |
| Caching | easy (GET + CDN) | hard | hard |
| Best for | public APIs, CRUD | internal microservices | complex frontend data |

> **Interview phrasing:** "REST models resources, gRPC models function
> calls, GraphQL models the client's data needs."

## API Design: Surviving Real Clients

A live API faces four recurring problems: changing without breaking clients
already shipped, returning huge lists a piece at a time, surviving retried
requests, and containing clients that send too much. Each problem has one
standard mechanism, and this section covers all four.

### Versioning

Rename a field in a response and every mobile app already installed breaks,
because you do not control when clients update. Three ways to handle
change:

- **URL versioning** (`/v1/users`): explicit, easy to route, the most
  common choice. The cost: clients must update their URLs to move versions.
- **Header versioning** (`Accept: ...; version=2`): keeps URLs clean, but
  is harder to test in a browser, which cannot express a header.
- **No versioning, evolve instead:** only backwards-compatible changes. Add
  fields freely; never remove or rename one.

### Pagination

`GET /orders` cannot return a million rows at once, so clients fetch a page
at a time. Two schemes:

- **Offset** (`?limit=20&offset=40`): skip 40 rows, return the next 20.
  Simple, with two failures at scale: rows inserted between page fetches
  shift everything, so items get duplicated or skipped across pages; and a
  high offset is slow, because the database must scan and discard every
  skipped row.
- **Cursor** (`?limit=20&after=cursor_xyz`): the cursor is an **opaque
  pointer** [a token the client sends back but never interprets], typically
  the last row's ID or timestamp. "Rows after this one" is stable under
  inserts and efficient, because the database jumps straight to the cursor.
  The one loss: no jumping to an arbitrary page. Use cursor pagination at
  scale.

### Idempotency keys

A client sends a payment POST and the request times out. Did the charge
happen? The client cannot know, so retrying risks a double charge and not
retrying risks a lost order.

The fix, for POSTs that must not run twice (payments, orders): the client
generates a UUID and sends it as the `Idempotency-Key: <uuid>` header. A
key the server has seen before is not executed again; the response stored
the first time is returned. A new key is executed and its response stored.
Retried and timed-out requests can no longer double-charge: however many
times the request arrives, it runs once.

> **Interview phrasing:** "An idempotency key turns retries from at least
> once into exactly once: same key, same stored response, one execution."

### Rate limiting

One client, buggy or malicious, can flood the backend and starve everyone
else. **Rate limiting** caps requests per client, identified by API key or
IP. Over the limit, the answer is `429 Too Many Requests` plus a
`Retry-After` header saying when to come back.

The classic algorithm is the **token bucket**: tokens refill at a steady
rate, each request spends one, and a request finding the bucket empty is
rejected. Unused tokens accumulate, so a quiet client can burst briefly
above the steady rate, which is usually what you want to allow.

```
refill: r tokens per second, up to the bucket's capacity
     |
     v
[ bucket ]  request arrives: take 1 token -> allowed
            bucket empty                  -> 429 + Retry-After
```

Enforce the limit at the gateway or load balancer, with the counters in a
shared store (Redis), so the limit holds across all servers instead of each
server counting alone.
$body$, step = 3
  WHERE title = 'DNS, Load Balancing & API Design';

UPDATE questions.bank SET lesson_md = $body$## Why OOP Exists

The whole idea of OOP: keep data and the code allowed to change it
together, and keep everyone else out.

You are debugging a program written the old way: a pile of procedures
operating on shared global data. A user's balance is wrong. The balance is a
global variable [a variable visible to every function in the program], so the
suspect list is the entire codebase: any function could have changed
anything, at any time, and nothing recorded which one did. That is why bugs
in this style were untraceable.

**Object-oriented programming** flips the ownership. Data and the code that
uses it are bundled together into **objects** [an object is one bundle of
data plus the methods that operate on that data], and the object controls
what outside code can touch. Instead of "anyone can write the balance," you
get "only these methods can, and each one checks the rules first." The
suspect list shrinks from the whole codebase to one class.

Four mechanisms make this work, and they are called the **four pillars**:
encapsulation, abstraction, inheritance, and polymorphism. This step of the
topic covers all four, then the vocabulary for how classes relate.

> **Interview phrasing:** "OOP exists to control who can touch what: it
> bundles state with the code allowed to change it, so an invariant is
> enforced in one class instead of trusted across the whole program."

## Pillar 1, Encapsulation

**Encapsulation** means a class keeps its data private, and the only way in
is through the class's own methods, which check the rules.

Here is the one-line bug it prevents: `user.age = -5`. If `age` is a field
any code can reach, nothing stops that line, and every place in the program
that reads `age` now has to cope with nonsense.

The fix: bundle the data (the **fields** [the variables
each object carries]) and the methods that act on it into one **class** [the
template declaring the fields and methods every object of that type has],
and restrict direct access to the data with **access modifiers** [keywords
on a field or method saying who may touch it]. Java has four levels:

- `private`: only inside the class
- *(no modifier)*: same package only (Java's "package-private" default)
- `protected`: subclasses plus same package
- `public`: anyone

**Why it matters:** without it, any code can do `user.age = -5`. With it,
access goes through methods that validate, so the class enforces its own
**invariants** [rules that must always hold, like "balance is never
negative"] and stays the single source of truth for its state.

```java
class BankAccount {
    private double balance;            // can't be set directly
    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException();
        balance += amount;
    }
}
```

**Encapsulation vs abstraction (the common confusion):**

- **Encapsulation = how** you hide internals (access modifiers, getters and
  setters). It is the mechanism.
- **Abstraction = what** you expose (a simple public interface over
  complexity). It is the design goal.

You use encapsulation to achieve abstraction.

> **Interview phrasing:** "Encapsulation is the mechanism, hiding internals
> behind access modifiers; abstraction is the design goal, a simple public
> interface over complexity. You use the first to achieve the second."

## Pillar 2, Abstraction

**Abstraction** means giving callers a simple surface and hiding the
machinery behind it: hide the complex implementation, expose only what is
relevant.

Every useful class works this way. When you call a library's `list.sort()`
you do not know which algorithm runs, and you do not need to: the method
signature is the whole story from the outside. A simple interface over huge
complexity.

*(Left out on purpose: the source illustrated this with driving a car
without knowing how fuel injection works; the `sort()` example above makes
the same point in code.)*

In code you achieve abstraction with two tools: abstract classes and
interfaces.

An **abstract class** cannot be **instantiated** [you can never write
`new Shape()`; the class exists only to be extended]. It provides a partial
implementation and forces subclasses to fill the gaps:

```java
abstract class Shape {
    // subclasses must implement this
    abstract double area();
    // shared concrete method, inherited by every subclass
    void printArea() { System.out.println(area()); }
}
class Circle extends Shape {
    double radius;
    double area() { return Math.PI * radius * radius; }
}
```

An **interface** is a pure contract: what a class must do, not how.
(**Default methods** [method bodies written inside an interface] are allowed
in Java 8 and later.)

```java
interface Serializable {
    String serialize();
    void deserialize(String data);
}
```

### Abstract class vs interface

| | Abstract class | Interface |
|---|---|---|
| State (fields) | Yes | No (constants only) |
| Constructor | Yes | No |
| Implementation | Partial | None (or default methods, Java 8+) |
| Multiple inheritance | No, one only | Yes, implement many |
| Use when | Sharing code among related classes | A contract for unrelated classes |

Rule of thumb: **abstract class = "is-a" with shared code; interface =
"can-do" contract.** `Dog extends Animal` (is-a); `Dog implements
Serializable` (can-do).

**Why only one superclass? The diamond problem.** If `D` could extend both
`B` and `C`, and each of them overrides the same inherited method, which
version does `D` get? There is no good answer, so Java avoids the ambiguity
by allowing one superclass only. Implementing many interfaces is safe
because interfaces carry no state; and if two default methods clash, the
compiler forces the class to override the method and choose.

> **Interview phrasing:** "Java forbids multiple class inheritance because
> of the diamond problem. Multiple interfaces are safe because they carry
> no state, and a clash between default methods is a compile error the
> class must resolve by overriding."

## Pillar 3, Inheritance

**Inheritance** lets a class reuse another class's code by extending it, so
shared behaviour is written once, in the parent.

The problem it solves: you have `Dog`, `Cat`, and `Horse`, and each needs
the same `eat()` method. Copy it three times and every bug fix must now be
made three times, and one copy is the one that gets forgotten.

Inheritance removes the copies: a **subclass** inherits its parent's
fields and methods and can extend or override them. It promotes reuse.

```java
class Animal {
    String name;
    void eat() { System.out.println(name + " is eating"); }
}
class Dog extends Animal {
    // Dog gets eat() for free; bark() is its own extension
    void bark() { System.out.println(name + " is barking"); }
    // overriding: replace the parent's version
    @Override
    void eat() { System.out.println("Dog gulps food"); }
}
```

**Method overriding**: a subclass replaces a parent method, and its version
is the one that runs at runtime for that object.

**The fragile base class problem:** inheritance is tight coupling. The
subclass depends on details of its parent, so changing the parent, even in
a way that looks harmless, can break subclasses. That is why the standard
advice is to "favour composition over inheritance."

**Avoid inheritance when:**

- The relationship is "has-a", not "is-a" (a `Car` *has* an `Engine`; it is
  not a kind of engine).
- You need runtime flexibility (an object's superclass is fixed when the
  code is compiled; you cannot swap inheritance at runtime).
- The hierarchy goes deeper than 2 to 3 levels.

> **Interview phrasing:** "Inheritance is the tightest coupling in the
> language: a harmless-looking change to the base class can break every
> subclass. That is the fragile base class problem, and it is why we
> favour composition over inheritance."

## Pillar 4, Polymorphism

**Polymorphism** ("many forms") lets one piece of code work with objects of
many different types, each type supplying its own behaviour.

The problem it solves: you write `makeNoise`, and it has to work for `Dog`,
`Cat`, and every animal anyone adds next year. Without help from the
language that is a chain of `if (a instanceof Dog) ... else if
(a instanceof Cat) ...`, and the chain must be found and edited every time
a new type appears.

Polymorphism deletes the chain: one interface refers to objects of
different types, and the right behaviour is chosen automatically. It comes
in two kinds.

**Compile-time polymorphism (method overloading)**: same method name,
different parameters; the compiler picks the version by looking at the
arguments.

```java
class Calculator {
    int add(int a, int b) { return a + b; }
    double add(double a, double b) { return a + b; }
}
```

**Runtime polymorphism (method overriding plus dynamic dispatch)**: a
parent **reference** [a variable whose declared type is the parent class]
points to a child object, and which method body runs is decided at runtime
by the object's real type.

```java
Animal a = new Dog();
a.speak();   // runs Dog's speak(), decided at RUNTIME
```

**How dynamic dispatch works (the vtable):** each class with overridable
methods has a **vtable**, an array of **method pointers** [each entry holds
the address of one method body]. Calling `a.speak()` looks up the vtable of
the object's real type (Dog's) and calls its `speak()`:

```
Animal a = new Dog();
a.speak();

  a --> Dog object --> Dog's vtable:
                         speak --> Dog.speak()   this one runs
                         eat   --> Dog.eat()
```

**Why it matters:** you write code against the abstraction, like
`void makeNoise(Animal a) { a.speak(); }`, and it works with any
implementation. There are no `instanceof` chains to maintain when you add
a type.

> **Interview phrasing:** when asked how runtime polymorphism works, say
> "vtable" and "dynamic dispatch": the call goes through the real type's
> vtable, so the child's method runs even through a parent reference.
> Naming the mechanism shows you know more than the concept.

## Class Relationships

Beyond inheritance, classes connect in four standard ways, and each name
answers two questions: who owns whom, and whether the parts die together.

These come up in low-level design questions ("design a parking lot",
"design a library system"): you sketch a handful of classes, and the
follow-up is always how they relate. What separates the four relationships
is ownership and **lifecycle** [whether one object's lifetime is tied to
the other's].

- **Association**: A uses B; neither owns the other or controls its
  lifecycle. `Doctor treats Patient`.
- **Aggregation** ("has-a", weak ownership): A holds a reference to B, but
  B can outlive A. `Department has Employees`; close the department and the
  employees still exist.
- **Composition** ("has-a", strong ownership): A owns B, and B dies with A.
  `House has Rooms` (the rooms are created inside it and have no life of
  their own).
- **Dependency**: A uses B temporarily, as a parameter or a local variable.
  `report.generate(Printer p)`.

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

> **Interview phrasing:** "Aggregation and composition are both has-a; the
> test is lifecycle. If the part can outlive the whole, it is aggregation;
> if it dies with the whole, it is composition."
$body$, step = 1
  WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = $body$## The SOLID Principles

**SOLID** [an acronym for five design principles: Single Responsibility,
Open/Closed, Liskov Substitution, Interface Segregation, Dependency
Inversion] is five rules for keeping code easy to change. All five attack
the same enemy: a change in one place that forces edits or breakage in a
place that should not have cared.

### Start with the problem

You are asked to change the wording of a welcome email. The pull request
ends up touching the class that registers users, and the registration tests
have to be re-run and re-reviewed. Nothing about registration changed;
it just shares a class with the email code, so every email change puts
registration back in play.

That is the shape of most maintainability failures in object-oriented
code, and each principle is a named answer to it, aimed at a different way
the coupling sneaks in. Together the five are what "maintainable,
extensible, testable" means in practice.

Interviewers test SOLID more than they test design patterns. For each
principle, know three things: the statement, a concrete violation, and the
fix. That violation-plus-fix pair is the expected answer shape.

### S: Single Responsibility

The email scenario above is this principle's violation. Here it is in code:

```java
class UserService {
    void registerUser(User u)     { /* saves to DB */ }
    void sendWelcomeEmail(User u) { /* email */ }      // not its job
    void generateReport()         { /* reporting */ }  // not its job
}
```

**"A class should have only one reason to change."**

If a class does auth *and* sends emails *and* writes reports, an email
change forces you to touch auth code. The class has three reasons to
change, and every one of them risks the other two.

**Fix:** split into `UserService`, `EmailService`, `ReportService`. Each
now has exactly one reason to change, so a diff in one cannot break the
others.

**Tip:** SRP is not only about classes. It applies to functions and to
microservices too: a service handling both orders and payments violates
SRP at the architecture level, and the failure mode is the same, one
concern's deploys and outages dragging the other along.

### O: Open/Closed

Marketing adds a new discount type every month. Each time, someone edits
the same method that already works in production, and the whole method is
back under review, with every existing discount at risk from a typo in the
new branch:

```java
// Violation: adding a discount type means editing this method
class DiscountCalculator {
    double calculate(String type, double price) {
        if (type.equals("VIP"))    return price * 0.8;
        if (type.equals("Member")) return price * 0.9;
        return price;
    }
}
```

**"Open for extension, closed for modification."** Add new behaviour with
new code; do not edit tested code.

The fix is to put an **interface** [a named list of method signatures that
a class promises to implement] between the calculator and the discounts,
and make each discount its own class:

```java
// Fix: each discount is its own class behind one interface
interface DiscountStrategy { double apply(double price); }

class VIPDiscount implements DiscountStrategy {
    public double apply(double p) { return p * 0.8; }
}
class StudentDiscount implements DiscountStrategy {
    public double apply(double p) { return p * 0.85; }
}
// A new discount is a new class; existing code stays untouched.
```

This is the reason "program to an interface" is a rule and not a taste.
The interface is the part that stays closed; new implementations are the
extension.

### L: Liskov Substitution

Someone models geometry. A square is a rectangle, so `Square extends
Rectangle` looks obviously correct. Then ordinary rectangle code runs:

```java
// Classic violation: Square extends Rectangle
class Square extends Rectangle {
    void setWidth(int w)  { this.width = w; this.height = w; }
    void setHeight(int h) { this.width = h; this.height = h; }
}

Rectangle r = new Square();
r.setWidth(5);
r.setHeight(3);
r.area();   // expected 15, actual 9: broken
```

**"A subclass must be usable anywhere its superclass is, without breaking
the program."**

The caller held a `Rectangle` and did only legal `Rectangle` things, and
still got the wrong answer. A square is geometrically a rectangle, but
behaviourally it breaks the width/height contract: setting one dimension
silently changed the other. When substituting a subclass breaks behaviour
like this, the hierarchy itself is wrong. **Fix:** drop the inheritance.
Give both a `Shape` interface with `area()`, or use **composition**
[holding another object and delegating to it, instead of inheriting from
it].

The same idea appears as `Penguin extends Bird` overriding `fly()` to
throw an exception. If code works with a `Bird`, it must work with a
`Penguin`; since it cannot, fix the hierarchy by splitting `FlyingBird`
out of `Bird`.

**Tip:** LSP violations have two reliable smells in real code:
`instanceof` checks (the caller is asking "which subclass is this really?"
because it cannot trust the contract) and `UnsupportedOperationException`
thrown from subclasses (the subclass is refusing part of the contract).

### I: Interface Segregation

You are implementing a basic printer, and the interface you must satisfy
demands `scan()` and `fax()`. Your class ends up full of empty stubs for
machinery it does not have:

```java
// Violation: a fat interface forces empty stubs
interface Printer { void print(); void scan(); void fax(); }
```

**"Clients shouldn't be forced to depend on methods they don't use."**
Prefer several small interfaces over one fat one.

```java
// Fix: split it
interface Printable { void print(); }
interface Scannable { void scan(); }
interface Faxable   { void fax(); }

class SimplePrinter implements Printable { /* ... */ }
class OfficePrinter
        implements Printable, Scannable, Faxable { /* ... */ }
```

The simple printer now implements only what it truly does; the office
machine composes all three. ISP connects back to SRP: a fat interface
usually means the thing behind it holds more than one responsibility.

### D: Dependency Inversion

`OrderService` builds its own database access:

```java
// Violation: a hardcoded concrete dependency
class OrderService {
    private MySQLDatabase db = new MySQLDatabase(); // can't swap or mock
}
```

Now `OrderService` cannot be tested without a running MySQL, and moving to
any other store means editing this class. The high-level policy (placing
orders) is chained to a low-level detail (which database).

**"High-level modules and low-level modules should both depend on
abstractions, not on each other."** Depend on interfaces; inject the
implementation.

```java
// Fix: depend on an interface, receive the implementation
interface Database { void save(Order o); }

class OrderService {
    private final Database db;
    OrderService(Database db) { this.db = db; } // injected from outside
    void placeOrder(Order o)  { db.save(o); }
}
// prod: new OrderService(new MySQLDatabase());
// test: new OrderService(new MockDatabase());
```

In tests you hand it a **mock** [a stand-in implementation that exists
only so a test can run without the real thing]. The "inversion" in the
name is literal, and it is the direction of the dependency arrows:

```
 Before:   OrderService --> MySQLDatabase
           (the high-level class names the low-level one)

 After:    OrderService --> Database <-- MySQLDatabase
           (both point at the abstraction; the arrow touching
            the concrete class has flipped direction)
```

DIP is the basis for **dependency injection** frameworks [tools that
construct your objects and pass each one its dependencies, so no class
builds its own] such as Spring and Guice. The rule to say out loud:
**inject, don't instantiate.**

> **Interview phrasing:** "SRP and ISP split things that change for
> different reasons; OCP and DIP put an interface between what changes
> and what must not; LSP keeps every subclass honest about the
> interface's promises."

## Creational Patterns

**Creational patterns** [design patterns that control how objects are
created] all make one move: take the decision of what to build, and how,
out of the code that uses the object, and give it a single home.

### Start with the problem

Every `new` in a codebase is a decision frozen at that line: which
concrete class, built how, and one more instance right now. When those
decisions are scattered across a hundred call sites, changing any of them
means a hundred edits. Three patterns that fix this come up constantly:
Singleton, Factory Method, and Builder.

### Singleton

Some things must exist exactly once per process: configuration loaded at
startup, a pool of database connections. If any code can call `new`, any
code can accidentally make a second one.

**Singleton** [a class that permits one instance of itself, globally
accessible] closes that door by making the constructor private and handing
out the single instance through a static method.

The subtle part is making that safe under threads. A plain `synchronized`
method works but takes the lock on every call, long after the instance
exists. The version below is **double-checked locking**, which pays for
the lock only during the first creation. It needs two pieces:
**synchronized** [a Java block only one thread may be inside at a time]
and **volatile** [a Java keyword forcing reads and writes of a field to go
through shared memory, so no thread can observe a half-built object]:

```java
class Config {
    private static volatile Config instance;
    private Config() {}              // no outside instantiation

    public static Config getInstance() {
        if (instance == null) {               // fast path, no lock
            synchronized (Config.class) {
                if (instance == null) {       // re-check under lock
                    instance = new Config();
                }
            }
        }
        return instance;
    }
}
```

The second `if` exists because two threads can both pass the first check
before either takes the lock; without the re-check, each would build its
own instance.

**Why it is widely called an antipattern:** it is global mutable state
(any code anywhere can change it), it hides dependencies (a class that
uses it never declares the need, so nothing in its constructor warns you),
and it breaks testing (every test shares the one instance, and you cannot
inject a mock).

**Acceptable for** truly shared infrastructure with no mutable business
state: connection pools, loggers, and **immutable** [never modified after
construction] config loaded once at startup.

### Factory Method

You write `new Dog()` at every place an animal is needed. The product now
needs cats. Switching means touching every site; supporting both means a
conditional at every site. Creation is welded to use.

**Factory Method** [an abstract creation method that subclasses override
to decide which class gets instantiated] centralises the decision and
decouples creation from use:

```java
abstract class AnimalFactory {
    abstract Animal create();            // subclass decides
    void handle() { create().speak(); }
}

class DogFactory extends AnimalFactory {
    Animal create() { return new Dog(); }
}
class CatFactory extends AnimalFactory {
    Animal create() { return new Cat(); }
}
```

Notice what `handle()` shows: the base class owns the workflow around an
object it does not know how to build. That is the pattern's whole value.

Three similarly named things get confused in interviews; keep them apart:

- **Simple Factory**: a static `create()` with a switch inside. Not a GoF
  [Gang of Four, the classic patterns book] pattern, just a helper.
- **Factory Method**: an abstract method; subclasses override it to
  produce different objects. This is the one above.
- **Abstract Factory**: creates *families* of related objects. A
  `MacUIFactory` makes a `MacButton` plus a `MacTextBox`; a
  `WindowsUIFactory` makes the matching Windows set, so a whole family
  swaps together.

### Builder

A class has 10 optional fields. With plain constructors you get
**telescoping constructors** [a ladder of overloads, each adding one more
parameter] or one huge parameter list where every call site counts commas
to work out which argument is which.

**Builder** [a companion object that collects a complex object's fields
step by step, then constructs it in one validated go] replaces both:

```java
User user = new User.Builder("John", "john@example.com") // required
    .age(25)
    .city("Singapore")
    .premium(true)
    .build();          // validates + constructs
```

The builder holds state as you chain calls; only `build()` validates the
whole set and returns the finished object, which is often immutable
precisely because every field arrived before construction. **Examples:**
`StringBuilder`, Java's `HttpRequest.Builder`, and ORM query builders.

> **Interview phrasing:** "Factory Method centralises *which* class gets
> built, Builder centralises *how* it gets built, and Singleton rations
> *how many*; each takes a creation decision away from the call sites."

## Structural Patterns

**Structural patterns** [design patterns that deal with how classes and
objects are composed] are about fitting existing pieces together: each
one wraps or fronts objects you already have so their shapes match.

### Start with the problem

All your classes work; the shapes just do not fit. A vendor library's
method names do not match the interface your code expects. A feature list
wants every combination of optional behaviours without a class per
combination. A single operation needs four services, and every caller is
expected to know all four. The standard moves for those three misfits are
Adapter, Decorator, and Facade.

### Adapter

Your system expects `PaymentGateway.charge(request)`. The processor you
must use is a legacy class exposing
`processPayment(amount, currency)`. Neither side can change: yours is an
interface the whole codebase depends on, theirs is vendor code.

**Adapter** [a wrapper that implements the interface the caller expects
and translates each call into the incompatible object's own methods] sits
between them:

```java
interface PaymentGateway { void charge(PaymentRequest req); }

class LegacyAdapter implements PaymentGateway {
    private LegacyPaymentProcessor legacy;
    LegacyAdapter(LegacyPaymentProcessor p) { this.legacy = p; }

    public void charge(PaymentRequest req) {
        // translates the call the caller makes into
        // the call the legacy class understands
        legacy.processPayment(req.getAmount(), req.getCurrency());
    }
}
```

**Examples:** `InputStreamReader` adapts an `InputStream` (bytes) to a
`Reader` (chars); the wrapper classes teams write around third-party
SDKs.

### Decorator

Messages need optional encryption, compression, and logging, in any
combination. Modelling that with inheritance explodes into
`EncryptedCompressedLoggedMessage`-style classes, one per combination.

**Decorator** [a wrapper that implements the same interface as the object
it wraps, adding one behaviour and delegating the rest] makes each feature
a single wrapper instead. Behaviour is added to an object at runtime by
wrapping it; no subclassing:

```java
interface Message { String getContent(); }

class TextMessage implements Message {
    private String text;
    public String getContent() { return text; }
}

class EncryptedMessage implements Message {
    private Message wrapped;
    EncryptedMessage(Message m) { this.wrapped = m; }
    public String getContent() {
        return encrypt(wrapped.getContent());
    }
}

// Compose at runtime:
Message m = new EncryptedMessage(
                new CompressedMessage(
                    new TextMessage("Hello")));
```

The call travels inward through the layers, and each layer transforms the
result on the way back out:

```
 m.getContent()
   -> EncryptedMessage.getContent()
        -> CompressedMessage.getContent()
             -> TextMessage.getContent()   returns "Hello"
        <- the compressed form of "Hello"
   <- the encrypted, compressed form of "Hello"
```

Because every wrapper shares the `Message` interface, any layer can wrap
any other, so the combinations come free.

**Examples:** Java I/O, where `new BufferedReader(new FileReader(...))`
is exactly this shape, and HTTP **middleware** chains [functions each
request passes through in order, one wrapping the next].

**Decorator vs inheritance:** Decorator composes behaviour at runtime and
avoids the class explosion; inheritance fixes the combination at compile
time.

### Facade

Placing an order really means: reserve the items, charge the card,
schedule shipping, send a confirmation. If every caller must know those
four services and their correct order, every caller can get it wrong.

**Facade** [one simple interface placed in front of a complex subsystem]
gives all callers a single method and keeps the choreography in one place:

```java
class OrderFacade {
    private InventoryService    inventory;
    private PaymentService      payment;
    private ShippingService     shipping;
    private NotificationService notifications;

    // The caller sees one call and is unaware of the 4 services
    void placeOrder(Order order) {
        inventory.reserve(order.items);
        payment.charge(order.total);
        shipping.schedule(order);
        notifications.sendConfirmation(order.userId);
    }
}
```

**Examples:** a web app's service layer, API gateways, and SDK wrappers
over messy cloud APIs.

> **Interview phrasing:** "Adapter changes an object's interface,
> Decorator keeps the interface and adds behaviour, Facade fronts many
> objects with one interface."
$body$, step = 2
  WHERE title = 'SOLID Principles + Creational & Structural Patterns';

UPDATE questions.bank SET lesson_md = $body$## Observer

An object that changes keeps a list of the objects that
care, and tells each of them automatically.

### Start with the problem

Your backend just placed an order. Three other parts of the system care:
the email service must send a confirmation, analytics must count the sale,
inventory must decrement stock. The obvious code has the order logic call
all three directly. Now the order code knows the name of every interested
party, and each new one (a fraud check, say) means editing the order code
again. The thing that changed is forced to know everyone who cares.

Flip the dependency. The order code keeps a list of interested objects,
and when its state changes it walks the list and calls one agreed method,
`update()`, on each. It never learns what any of them do with the news.

That is the **Observer** pattern: a **one-to-many** relationship where,
when one object changes, all its dependents are notified automatically.
It is the first of the **behavioural patterns** [the family of design
patterns about how objects interact and communicate, as opposed to how
they are created or structured]; this step covers six of them. Two roles:

- The **subject** holds the state and the list of observers, and notifies
  them on change.
- An **observer** is any object that registered itself; it exposes an
  `update()` the subject calls when it changes.

```java
interface Observer { void update(String event); }

class EventSystem {                       // the subject
    private List<Observer> observers = new ArrayList<>();
    void subscribe(Observer o)   { observers.add(o); }
    void unsubscribe(Observer o) { observers.remove(o); }
    void notifyObservers(String event) {
        for (Observer o : observers) o.update(event);
    }
}

class EmailNotifier implements Observer {
    public void update(String event) {
        System.out.println("Email: " + event);
    }
}

// events.subscribe(new EmailNotifier());
// events.notifyObservers("order_placed");
```

### Push vs pull

Two ways to hand over the news. **Push** sends the data inside `update()`
itself: simple, but every observer receives whatever the subject decided
to send, needed or not. **Pull** sends only "something changed", and each
observer queries the subject for exactly the pieces it wants: more
decoupled, at the cost of a call back.

### Observer vs Pub/Sub

Interviewers like this boundary. Observer is direct, **synchronous** [the
notify loop calls each `update()` in turn and waits for it to finish],
and lives inside a single process; observers hold a reference to the
subject, because `subscribe` needs the subject object in hand. **Pub/Sub**
[publish/subscribe] puts a **broker** [a separate message-routing program,
such as Kafka or RabbitMQ] in the middle: publisher and subscriber never
know each other, communication is asynchronous, and it can span machines.

Where you have already met Observer: UI event listeners, React
re-rendering when state changes, notification systems.

> **Interview phrasing:** "Observer is one-to-many, synchronous, and
> in-process; Pub/Sub adds a broker so publisher and subscriber never
> meet, and it crosses machine boundaries."

## Strategy

Put each algorithm in its own class behind one shared
interface, so the code that uses an algorithm can be handed a different
one without being edited.

### Start with the problem

A `Sorter` class picks its algorithm with a switch: quicksort down one
branch, mergesort down another. Every new algorithm means editing
`Sorter`, which violates the **open/closed principle (OCP)** [code should
be open to extension but closed to modification: you add behaviour by
adding code, not by editing code that already works]. The class that uses
an algorithm and the list of all algorithms are welded together.

The fix is to name the part that varies. Put the algorithm behind an
interface, make each algorithm its own class, and have `Sorter` hold one
and delegate to it.

```java
interface SortStrategy { void sort(int[] data); }

class QuickSort implements SortStrategy {
    public void sort(int[] d) { /* ... */ }
}
class MergeSort implements SortStrategy {
    public void sort(int[] d) { /* ... */ }
}

class Sorter {
    private SortStrategy strategy;
    Sorter(SortStrategy s) { this.strategy = s; }
    // swap the algorithm at runtime
    void setStrategy(SortStrategy s) { this.strategy = s; }
    void sort(int[] data) { strategy.sort(data); }
}
```

This is the **Strategy** pattern: define a family of interchangeable
algorithms and swap them at runtime, as `setStrategy` does above.

Against if/else: Strategy replaces conditionals with **polymorphism**
[one call site, many behaviours: the method that runs is chosen by the
object's actual class, not by a branch you wrote]. A new algorithm is a
new class, with no changes to existing code.

Backend examples: swappable authentication methods, payment processors,
compression algorithms.

> **Interview phrasing:** "Strategy replaces a conditional over
> algorithms with polymorphism: adding an algorithm is adding a class,
> not editing a switch."

## Command

Wrap a request in an object, so the request can be stored,
queued, logged, and reversed instead of vanishing when the call returns.

### Start with the problem

A text editor must support Ctrl+Z. A job server must take a request now
and run it later, on another worker. An audit trail must record exactly
what was asked. All three hit the same wall: a plain method call is
gone the moment it returns. You cannot store it, ship it to another
machine, or reverse it.

So make the request itself an object: one that carries everything needed
to perform the operation, and optionally everything needed to reverse it.
That is the **Command** pattern. Its roles:

- **Command**: an interface with `execute()`, optionally `undo()`. A
  **concrete command** wraps exactly one operation.
- The **invoker** holds and runs commands (and can keep a history of
  them). The **receiver** [the object the command actually operates on]
  does the real work.

```java
interface Command { void execute(); void undo(); }

class InsertCommand implements Command {
    private TextEditor editor;    // the receiver
    private String text;
    private int pos;
    InsertCommand(TextEditor e, String text, int pos) {
        this.editor = e; this.text = text; this.pos = pos;
    }
    public void execute() { editor.insert(text, pos); }
    public void undo()    { editor.delete(pos, pos + text.length()); }
}

class CommandHistory {            // the invoker, with an undo stack
    Deque<Command> history = new ArrayDeque<>();
    void execute(Command c) { c.execute(); history.push(c); }
    void undo() { if (!history.isEmpty()) history.pop().undo(); }
}
```

Undo works only because the command kept its own inputs: it remembers
`pos` and `text`, so reversing is a delete of that exact range. The
invoker never knows what any command does; it just pushes each one onto
a stack, and Ctrl+Z pops and calls `undo()`. The pattern is what enables
undo/redo, queuing, and logging.

Backend examples: job queues (each job is a serialised Command),
database transactions (each operation is a command, rollback is its
undo), audit logs.

> **Interview phrasing:** "Command turns a method call into an object,
> and once a request is an object you can queue it, log it, and undo it."

## Template Method

A parent class fixes the order of an algorithm's steps
once, and each subclass fills in what the individual steps do.

### Start with the problem

You write a data importer: read the input, process it, write the output,
send an alert. Then a second importer for another format: the same four
steps, in the same order, with a different middle. Copy the skeleton and
you now have two copies of the order, and one day someone reorders the
steps in one of them.

Put the skeleton in a base class instead. One method fixes the order of
the steps and is marked `final`, so no subclass can change it; each
individual step is a method a subclass fills in.

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

This is the **Template Method** pattern: fix an algorithm's skeleton in a
base class and let subclasses fill in specific steps. Note the two kinds
of step: the `abstract` ones every subclass must supply, and `sendAlert`,
which has a default body and is only overridden when the default is
wrong.

When to reach for it: several classes share the same structure but
differ in individual steps. It is common in frameworks, where the
framework owns the lifecycle and your code fills in the steps: Spring's
`JdbcTemplate`, request lifecycle hooks.

> **Interview phrasing:** "The parent owns the order of the steps; the
> subclasses own the steps."

## Iterator

Every collection hands out its elements through the same
two calls, so a loop never needs to know how the collection stores them.

### Start with the problem

Your function walks a result set with an index: `for (i = 0; i <
list.size(); i++)`. Then the data structure changes to a tree, or the
rows start arriving from a database in batches. Every index-based loop
breaks, because indexing was a promise about the collection's internal
structure, and the structure changed.

The fix: the collection hands out a small object whose only job is to
produce elements one at a time, through two calls, `hasNext()` and
`next()`. Loops are written against those two calls and never learn the
shape underneath. Lists, trees, graphs, and DB cursors [a database
handle that yields result rows as you advance it, without loading them
all at once] all iterate through the same interface.

That object is an **Iterator**: traverse a collection without exposing
its internal structure. Java's for-each loop is built on it, which is
why the range below can be looped over despite storing no elements at
all, only two ints:

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

// prints 1 through 5
for (int n : new NumberRange(1, 5)) { System.out.println(n); }
```

Examples: Java's `Iterable`/`Iterator`, Python's `__iter__`/`__next__`,
DB cursors.

> **Interview phrasing:** "hasNext and next decouple the loop from the
> shape of the collection, so a list, a tree, and a cursor are all
> consumed by the same code."

## Proxy

Put a stand-in with the same interface in front of an
object, so every call can be checked, cached, or delayed before the real
object sees it.

### Start with the problem

Three situations with the same shape. `getProduct` calls a slow remote
service, and every caller pays the full cost on every call. Every data
access must pass a permission check, and the checks are scattered across
call sites. An object is expensive to build and might never be used.
Each time, you want to slip logic in front of an object without touching
the object or any of its callers.

The move: a stand-in class that implements the same interface as the
real object and holds a reference to it. Callers cannot tell the
difference, and the stand-in decides when (and whether) to pass each
call through. That is the **Proxy** pattern: control access to another
object. Three uses:

**1. Caching**: avoid repeated expensive calls.

```java
class CachedProductService implements ProductService {
    private ProductService real;
    private Map<String, Product> cache = new HashMap<>();
    public Product getProduct(String id) {
        // on a miss, ask the real service and remember the answer
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
        if (!user.hasPermission(resource))
            throw new UnauthorizedException();
        return real.getData(user, resource);
    }
}
```

**3. Lazy loading**: defer expensive initialisation until first use.
JPA/Hibernate [Java libraries that load database rows into objects] do
exactly this: `user.getOrders()` does not hit the database until you
actually access the orders.

**Proxy vs Decorator** [a wrapper with the same interface whose purpose
is adding behaviour on the way through]: a Decorator *adds behaviour*,
composing features; a Proxy *controls access* to the real object, with
the same interface, managing its lifecycle and access. The class shape
is nearly identical; the intent is the difference.

> **Interview phrasing:** "Decorator adds behaviour, Proxy controls
> access: same shape, different intent."

## Composition over Inheritance

Build an object from swappable parts instead of growing a
tree of subclasses, so a new combination of abilities is a constructor
call, not a new class.

### Start with the problem

You model dogs by subclassing, and each new capability grows the chain:

```
Animal -> Pet -> Dog -> GuideDog -> TrainedGuideDog
```

Deep inheritance is brittle. Every class is coupled to its parent, so a
change to `Dog` can break everything below it. Then the requirement
arrives for a `SwimmingGuideDog`, and inheritance can only answer with
another class. One class for every combination of capabilities: that is
**class explosion**.

The alternative is **composition** [building an object out of parts it
holds references to, and delegating work to those parts]: inject the
behaviour instead of inheriting it.

```java
class Dog {
    private MovementBehaviour movement;
    private TrickBehaviour tricks;
    Dog(MovementBehaviour m, TrickBehaviour t) {
        this.movement = m; this.tricks = t;
    }
    void move()    { movement.move(); }
    void perform() { tricks.perform(); }
}

Dog guide   = new Dog(new GuideWalk(), new AdvancedCommands());
Dog swimmer = new Dog(new Swim(), new BasicTricks());
// a swimming guide dog is a constructor call, not a new class:
// new Dog(new Swim(), new GuideCommands())
```

A new combination is a new constructor call, not a new class. The
injected parts are exactly the Strategy pattern from earlier in this
step: each behaviour is a swappable object behind an interface.

**The rule:** favour composition for "has-a" relationships (has a
behaviour, has a strategy). Use inheritance only for genuine "is-a"
relationships that are stable and shallow.

> **Interview phrasing:** "Inheritance fixes behaviour per class at
> compile time; composition picks it per object at construction time,
> so combinations multiply without new classes."

*The full pattern cheat-sheet (all 13, with backend examples) is in the
overview.*
$body$, step = 3
  WHERE title = 'Behavioural Patterns + Composition vs Inheritance';

UPDATE questions.bank SET lesson_md = $body$## The Interview Framework (Memorise This)

A system design interview is passed with structure, not
perfect answers, and the structure is five fixed steps with a time budget
for each. Interviewers reward exactly that.

"Design Twitter," says the interviewer, and the clock starts. The two
standard failures are opposites: start drawing immediately and you design
the wrong system; discuss requirements for twenty minutes and nothing gets
designed at all. So run the same script on every question:

```
Step 1. Clarify requirements     (5 min)
Step 2. Estimate scale           (3 min)
Step 3. High-level design        (10 min)
Step 4. Component deep dives     (15 min)
Step 5. Bottlenecks & trade-offs (5 min)
```

**Step 1, clarify.** Pin down **functional requirements** [what the system
does: post a message, follow a user] and **non-functional requirements**
[the qualities it must have: scale, latency, consistency, availability].
Ask before drawing: real-time or eventual? Read-heavy or write-heavy?
Global or single region?

**Step 2, estimate.** Turn that into **DAU** [daily active users], **QPS**
[queries per second arriving at the system], and storage. The conversions
worth memorising:

- A day is about 86,400 seconds, so 1M requests/day is about 12 QPS and
  1B requests/day is about 12K QPS.
- 1M DAU making 10 requests each per day is about 115 QPS; 100M DAU at
  that rate is about 11.5K QPS.
- 1 KB per request at 10M requests/day is 10 GB/day, about 3.6 TB/year.
- Latency anchors: an SSD read is about 0.1 ms, a network round trip
  inside one datacenter about 0.5 ms, an HDD seek about 10 ms.

**Step 3, high-level design.** Boxes first, no detail yet:

```
Client -> Load balancer -> API servers -> Database / Cache
```

**Step 4, deep dives.** Pick the 2-3 components the interviewer probes and
go deep. This is where you differentiate; anyone can draw step 3's boxes.

**Step 5, bottlenecks.** What breaks at 10x the scale? What did the design
sacrifice?

> **Interview phrasing:** "Before I draw anything: is this read-heavy or
> write-heavy, real-time or eventual, global or one region?"

## Scaling from Zero to Millions

Every large system grew out of one machine by the same
short sequence of moves, and knowing the sequence lets you rebuild it on
demand.

A side project starts as web server, application and database on one
machine, and then traffic grows. The parts fail in a predictable order,
and the standard architecture falls out of fixing each failure in turn.

**Single server.** Everything on one box: fine for a side project. The
first bottleneck is the database, competing with the app for the one
machine's resources.

**App/DB split.** Move the database to its own machine, so app tier and DB
tier scale independently.

**Load balancer and multiple app servers.** One app server has a ceiling,
so run several identical ones behind a **load balancer** [a machine that
receives every request and forwards each to one of several servers]:

```
Client -> DNS -> Load balancer -> [App 1]
                               -> [App 2]
                               -> [App 3]
```

This buys **horizontal scaling** (add servers when busy), no **single
point of failure** [a component whose death takes the whole system down],
and zero-downtime deploys (update servers one at a time).

How the balancer picks a server:

- **Round robin**: rotate through the servers in order. Simple default.
- **Least connections**: the server with the fewest active requests.
  Better when requests vary in cost.
- **Hash**: hash the user or IP to a server, so a client always lands on
  the same one. Use **consistent hashing** [adding a server moves only a
  small fraction of keys; mechanism in the sharding section of this step]
  so adding a server does not reshuffle everyone.

Balancers come in two kinds, named by the network layer they read. **L4**
sees only IP and port: fast, content-blind. **L7** reads the HTTP request,
so it can route by path or cookie, slightly costlier per request.

**Health checks**: the balancer pings each server and pulls failures out
of rotation. Failover and zero-downtime deploys only work because this
check is running.

The trap in "several identical servers": a server that keeps a user's
session in its own memory is the only server that can handle that user,
forcing **sticky routing** [the balancer pins each user to one server].
The fix is **stateless** app servers: sessions live in Redis, not on the
box, so any server handles any request. Essential for horizontal scaling.

The two scaling directions: **vertical** (scale up) means more CPU/RAM in
one machine; simple, no code change, but a hard ceiling, still a single
point of failure, and expensive at the top. **Horizontal** (scale out)
means more machines; needs stateless design and more ops complexity, but
scales roughly indefinitely. Preferred for production.

> **Interview phrasing:** "Stateless servers behind a load balancer: any
> server takes any request, so I add machines instead of buying a bigger
> one."

## Database Replication

Keep live copies of the database on several machines, so
reads spread out and losing a machine is survivable.

The app tier scales now, but every server still hits one database, reads
usually dwarf writes, and if that one DB machine dies, everything is gone.
Both problems share a fix: keep copies. **Replication** runs one
**primary** [the single database accepting all writes] and several
**replicas** [databases receiving an asynchronous copy of every change,
serving reads]:

```
Writes -> Primary
Reads  -> Replica 1, Replica 2
```

Three wins: **read scaling** (add replicas for more read capacity), **high
availability** (promote a replica if the primary fails), and **analytics**
(heavy queries run on a replica without slowing production).

The price is **replication lag**: the copies are asynchronous, so replicas
trail the primary by milliseconds to seconds, and a read right after a
write can miss it. Update your profile photo, refresh, and a lagging
replica serves the old one. This is **eventual consistency** [all copies
converge, but a read in the meantime may see an old value] at the DB
layer.

**Failover** [replacing a dead primary] is three moves: detect the failure
(a **heartbeat**, a periodic "I'm alive" ping, stops arriving); elect a
new primary (consensus via Raft or ZooKeeper, or a managed database does
it for you); repoint the app or DNS at the winner.

> **Interview phrasing:** "Replication scales reads and gives me failover;
> the price is lag, so a read right after a write can be stale."

## Caching

Keep a copy of frequently read data in a store faster than
the database, and answer from the copy.

One user profile is read thousands of times a second, and each DB read
costs 1-10 ms to produce an answer that barely changes. A **cache** [a
small, fast store holding copies of recently used data] answers in under
1 ms in-process, or about 0.5 ms from Redis. For read-heavy workloads with
repeated queries, caching is the highest-leverage win.

The most common pattern is **cache-aside** (lazy loading): check the cache
first, fill it on a miss.

```
check cache -> HIT:  return the cached value
            -> MISS: query DB -> populate cache -> return
```

```python
def get_user(user_id):
    user = cache.get(f"user:{user_id}")
    if not user:
        user = db.query("SELECT * FROM users WHERE id = ?", user_id)
        cache.set(f"user:{user_id}", user, ttl=3600)
    return user
```

Pro: only data somebody asked for gets cached. Con: the first read after a
miss is slow, and entries can go stale.

Two other write policies: **write-through** writes cache and DB together,
so the cache is always fresh, but every write pays twice and the cache
fills with maybe-unread data. **Write-behind** (write-back) writes the
cache now and flushes to the DB asynchronously later: very fast writes,
but data is lost if the cache dies before flushing.

A full cache must throw something out: **eviction**. Three policies:
**LRU** [least recently used: drop what has gone longest unread; most
common, good for **temporal locality**, meaning recently used data is
likely to be used again], **LFU**
[least frequently used], and **TTL** [time to live: expire entries after a
fixed time].

Expiry has a failure mode of its own: a hot key expires and thousands of
concurrent requests all miss and hit the DB at once, a **cache stampede**
(thundering herd). Fixes: probabilistic early refresh (renew shortly
before expiry); a mutex lock (one request refills, the others wait or
serve the stale value); **stale-while-revalidate** (serve the old value
while one background refresh runs).

The same idea applied geographically is a **CDN** [content delivery
network: a geo-distributed cache for static assets such as images, JS,
CSS and video]. Users hit the nearest edge server, not your origin.

- **Push CDN**: you push content to the edges. Good for rarely-changing
  assets.
- **Pull CDN**: an edge fetches from the origin on a miss, then caches.
  Good for varied or dynamic access.
- **Cache-hit ratio** [the fraction of reads the cache answers]: aim above
  90%; a low ratio means too much origin traffic and defeats the point.

> **Interview phrasing:** "Cache-aside with a TTL is my default; the two
> failure modes I watch for are staleness and stampedes."

## Database Sharding

When the data outgrows one machine, split the data itself
into pieces and give each machine one piece.

Replication copies the whole dataset to every machine, so it scales reads
but not storage or writes: every write still lands on one primary, and
every replica holds the full copy. When one table outgrows one machine,
the fix is **sharding**: horizontal partitioning that splits one big table
across several DB instances (**shards**), each holding a subset of rows.
For example, users 1 to 1M on shard 1, users 1M to 2M on shard 2.

The **shard key** [the column whose value decides which shard a row lives
on] is the whole design decision; a bad one creates a **hotspot** [one
shard taking far more load than the rest]:

- `created_at`: every new write hits the current shard while old shards
  sit idle.
- `user_id % N`: adding a shard changes N and remaps almost every row.
- Better: hash the key and place it with consistent hashing (below), so a
  resize remaps only a minimal fraction.

Sharding solves storage and write scale, and charges four ways:

- **Cross-shard joins**: joining tables on different shards means
  fetching from each and joining in the application. Expensive.
- **Cross-shard transactions**: **ACID** [atomicity, consistency,
  isolation, durability: the all-or-nothing guarantees one database gives
  a transaction] across shards needs distributed transactions such as
  **two-phase commit** [a coordinator asks every shard to prepare, then
  commits only if all agree]. Complex and slow.
- **Hotspots**: one celebrity's rows can overwhelm their shard even with
  a good key. Mitigate by appending a random suffix to the key for hot
  entities, spreading their rows out.
- **Rebalancing**: adding or removing shards moves data. Almost all of it
  without consistent hashing; about 1/N of it with.

**Consistent hashing** is the mechanism behind that 1/N: hash servers and
keys onto the same ring, and a key belongs to the first server clockwise
from where it lands.

```
 the hash space, drawn as a ring unrolled into a line:

      S1         S2                  S3            (wraps to S1)
  ----|----------|-------------------|-------------------------
       ^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^
       S2 owns    S3 owns             S1 owns
       these keys these keys          these keys

 add S4 between S2 and S3:

      S1         S2        S4        S3            (wraps to S1)
  ----|----------|---------|---------|-------------------------
                  ^^^^^^^^^
                  only these keys move (to S4);
                  every other key stays where it was
```

Adding a server moves only the keys between it and the previous server;
removing one moves only its keys to the next server clockwise. About 1/N
of the keys remap, not all. One refinement: **virtual nodes** [each
physical server takes many ring positions instead of one] even out the
load and prevent the hotspots uneven spacing would create.

> **Interview phrasing:** "Consistent hashing means a resize remaps about
> 1/N of the keys instead of nearly all of them."

## CAP Theorem (Applied)

When a network failure splits a system in two, each half
must choose between answering possibly wrong and not answering at all.

Your system spans two datacenters and the link between them dies: a
**network partition** [a failure splitting the machines into groups that
cannot reach each other]. A write lands on one side; a read arrives on the
other. The read side has exactly two options: refuse to answer until the
link returns, or answer with possibly stale data. That is the **CAP
theorem**: during a partition you keep **C**onsistency or
**A**vailability, not both. A system that refuses is **CP** (consistent);
one that answers anyway is **AP** (available).

- **Pick CP** when stale data costs money: payments, inventory ("1 left
  in stock"), seat booking, bank transfers.
- **Pick AP** when slight staleness is fine: social feeds, view counts,
  analytics, DNS, search indexes.
- **Middle ground**, the realistic answer: most systems are AP for most
  data and CP only where it matters, such as an AP feed next to CP
  payments.

> **Interview phrasing:** "During a partition I choose: refuse to answer,
> or answer possibly stale. CP where staleness costs money, AP everywhere
> else."
$body$, step = 1
  WHERE title = 'Foundations & Building Blocks';

UPDATE questions.bank SET lesson_md = $body$Six designs that interviews reuse constantly. Each one is walked the same
way: requirements, a rough estimation, the high-level design (HLD), then the
deep dives and bottlenecks an interviewer will push on.

## Design a Rate Limiter

Count how many requests each client sends, and refuse the
ones over a set budget. The design questions are how to count fairly and
where the count lives once there is more than one server.

### Start with the problem

One buggy script, or one attacker, can send your API thousands of requests a
second. A server never says no on its own; it accepts work until it falls
over, and the flood crowds out every well-behaved user. So something in front
has to count each client's requests and refuse the ones over budget. The
component that does the counting and refusing is a **rate limiter**.

### Four ways to count

- **Token bucket:** each client gets a bucket holding at most N tokens,
  refilled at R tokens per second. Every request takes one token; a request
  that finds the bucket empty is rejected. A full bucket can be spent all at
  once, so this allows bursts up to the bucket size.
- **Leaky bucket:** requests join a queue that drains at a fixed rate; when
  the queue is full, the overflow is dropped. The output is smooth and
  constant, and bursts are impossible.
- **Fixed window counter:** count requests per window (say, per minute) and
  reset the count at each boundary. The flaw: 100 requests at 11:59 plus 100
  more at 12:00 is 200 requests inside about two seconds straddling the
  boundary, and both windows report the client as within its limit.
- **Sliding window counter:** estimate the last 60 seconds as a weighted
  blend of the current window's count and the previous window's count. It is
  as memory-efficient as a fixed window and has no boundary flaw. This is
  the best interview answer of the four.

### Where the counter lives

```
Client → LB → [API Gateway + Rate Limiter] → Backend
                        ↕
            [Redis: counters per user/IP/route]
```

The **LB** is a load balancer [a machine that spreads incoming requests
across servers]. The **API gateway** [the single front-door service that all
requests enter through] is where the limiter runs, and the counters live in
**Redis** [an in-memory data store, here acting as one fast shared counter
per user, per IP, or per route].

```
INCR   rate:{user_id}:{minute}        # atomic increment
EXPIRE rate:{user_id}:{minute} 120    # auto-clean old windows
```

`INCR` is **atomic** [it completes as one indivisible step, so two
simultaneous increments cannot read the same old value]. The `EXPIRE` makes
each minute's key delete itself after 120 seconds, so old windows clean
themselves up.

The sliding count reads two of these keys. Fifteen seconds into the current
minute, the sliding 60 seconds still covers the last 45 seconds of the
previous minute, so the estimate is the current minute's count plus 0.75
times the previous minute's count. Reading only the current key would be a
fixed window again, boundary flaw included.

**The distributed gotcha:** give each of 3 gateway nodes its own local
counter and each node allows the full limit on its own, so 3 times the limit
gets through in total. The fix is one shared Redis that every node counts
in. That adds a small network hop to every check, and it is worth it for
correctness.

**The response:** a rejected request gets `429 Too Many Requests`, with
`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers
so a polite client can pace itself.

> **Interview phrasing:** "Per-node counters multiply the limit by the node
> count; the counter has to be shared to mean anything."

## Design a Key-Value Store

Spread billions of keys across many machines, and keep
copies of each key so no single failure loses data. Every choice after that
is a trade between fast answers and up-to-date answers.

### Start with the problem

The requirements are two operations, GET(key) and PUT(key, value), over
billions of keys, with **high availability** [the store keeps answering
while individual machines fail] and tunable consistency. Billions of keys do
not fit on one machine, so three questions decide the design: which machine
holds which key, what happens when that machine dies, and what "the latest
value" means once there are copies.

### Partitioning: consistent hashing

Hash every node and every key onto the same circle of hash values; a key
belongs to the first node clockwise from where it lands. This is
**consistent hashing**.

```
ring:  ...---A---------B---------C---------(wraps back to A)---...

key k hashes to a point between A and B, so B owns k.
Remove B: k moves clockwise to C. Keys owned by A and C stay put.
```

Adding or removing a node remaps only about 1/N of the keys; a naive
`hash(key) mod N` would remap nearly all of them.

### Replication and quorums

One copy of a key is one machine failure away from loss, so each key is
stored on N nodes (N = 3 is typical): the owning node plus the next N-1
clockwise on the ring. The store then survives losing a node.

With copies comes the consistency question. Let N be the replica count, W
the number of replicas that must acknowledge a write, and R the number that
must answer a read. If W + R > N, every read overlaps every write on at
least one replica, so a read always sees the newest acknowledged write:
**strong consistency**. If W + R ≤ N, a read can land entirely on stale
replicas: **eventual consistency** [all replicas converge on the latest
value, but a read in the meantime may return an old one]. With N = 3:
W = 2, R = 2 is strong and tolerates one failed node; W = 1, R = 1 is the
fastest and only eventual.

### Conflicts and membership

Two clients can write the same key on different replicas at once, so the
store needs a rule for conflicts. **LWW (last write wins)** keeps the value
with the newer timestamp: simple, but it trusts machine clocks, and **clock
skew** [two machines' clocks disagreeing] can crown the wrong winner.
**Vector clocks** track causality instead: each value carries (node,
counter) pairs, so the store can tell "B overwrote A" apart from "A and B
were concurrent", and when versions really are concurrent it returns both
and lets the client resolve them.

Finally, membership: who tells every node that a node has died or joined?
Nobody central. With **gossip**, each node periodically shares what it knows
with a few random peers, and news reaches the whole cluster in O(log N)
rounds with no central coordinator. Cassandra and Amazon's Dynamo both work
this way.

> **Interview phrasing:** "W + R > N forces every read to overlap every
> write on at least one replica, so a read cannot miss an acknowledged
> write."

## Design a URL Shortener

Store a mapping from a short code to a long URL, and
redirect anyone who opens the code. The design is mostly about generating
codes that never collide and serving reads that vastly outnumber writes.

### Start with the numbers

The job: take a long URL, hand back a short code, and redirect anyone who
opens it. Size it first, because the numbers drive the design:

- 100M new URLs a day is about 1,200 write **QPS** [queries per second].
- Reads outnumber writes about 10 to 1, so about 1B redirects a day, which
  is roughly 12K read QPS.
- At about 500 bytes per URL, ten years of this is about 365 billion stored
  URLs, roughly 180 TB.

### Generating the short code

- **Hash:** run MD5 or SHA256 over the long URL and keep the first 7
  characters. Two URLs can share that prefix (a collision), so on collision
  you retry with a counter appended to the input.
- **Base62 of an auto-increment ID (preferred):** let the database assign a
  sequential BIGINT id, then encode that id in **Base62** [the 62 characters
  a-z, A-Z and 0-9 used as digits]. 62^7 ≈ 3.5 trillion codes, comfortably
  more than the 365 billion above. No collisions, so no retry logic. The
  cost: sequential ids produce guessable, enumerable codes; name that as a
  trade-off rather than hiding it.

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

### Serving the redirect

The redirect status code is a real decision. A **301** (moved permanently)
is cached by the browser, so repeat clicks skip your server entirely: that
saves load, but those clicks are invisible to you, so click analytics are
lost. A **302** (temporary) brings every click to your server: more load,
and every click is countable. Use 302 to track clicks.

Reads vastly outnumber writes, so cache the mapping from `short_code` to
`long_url` in Redis with **LRU** eviction [least recently used: when the
cache is full, the entry idle longest is evicted first]. Popular links then
never touch the database at all.

> **Interview phrasing:** "301 saves you traffic, 302 buys you analytics;
> choose by product requirement, not by habit."

## Design a News Feed

Show each user the newest posts from the accounts they
follow. Everything turns on one question: build each user's list when posts
are written, or when the feed is read.

### Start with the problem

You open the app and expect the newest posts from the several hundred
accounts you follow, instantly. Somebody has to assemble that list, and the
core decision is when: when a post is written, or when your feed is read.

- **Fan-out on write (push)** [**fan-out** is the work of copying one event
  to everyone who should receive it]: when a user posts, precompute the post
  into every follower's stored feed (Redis sorted sets). Reads are instant,
  the feed is already built. But one post costs one write per follower, so a
  celebrity with 10M followers costs 10M writes per post. Too much.
- **Fan-out on read (pull):** store nothing per follower; when a feed is
  loaded, query the recent posts of every followed account and merge them.
  Writes are cheap; reads are expensive and degrade as the user follows more
  people.
- **The hybrid (what Twitter and Meta run):** regular users, under roughly
  10K followers, are fanned out on write; celebrities are fanned out on
  read, merged into the precomputed feed at load time. Most reads stay fast,
  and write amplification stays bounded.

### Storing the feed

Each user's feed is one Redis **sorted set** [a Redis structure that keeps
members ordered by a numeric score]: the key is `feed:{user_id}`, each
member is a `post_id`, and the score is the post's timestamp.

```
ZREVRANGE feed:{user_id} 0 19    # highest scores first: the 20
                                 # newest post ids in the feed
```

That returns the 20 latest post IDs; the post bodies are then fetched from
cache or the database.

> **Interview phrasing:** "Fan out on write for everyone except celebrities;
> merge celebrities in at read time."

## Design a Notification System

Other services report events, and one dedicated service
delivers them to users by push, email or SMS. A queue in the middle keeps
slow or failing delivery from ever slowing the services doing the reporting.

### Start with the problem

An order ships, and the buyer should hear about it by push notification,
email or SMS. The order service could call the SMS provider directly, but
then a provider outage or a traffic spike stalls order processing, and every
service that ever notifies anyone has to know delivery details. Instead,
producers drop an event on a queue and one dedicated service does delivery.

```
Producers (Order/User svc) → Kafka topic "notifications"
                                  ↓
                Notification Service (consumer)
                reads event → looks up prefs → routes
                                  ↓
        Push (APNs/FCM)   Email (SendGrid)   SMS (Twilio)
```

- **Why Kafka** [a durable, ordered message log that many services can write
  to and read from]: it decouples producers from delivery, buffers spikes
  instead of dropping them, lets workers consume at their own pace, and
  holds messages so failed sends can be retried from the queue.
- **Retry:** a failed send is retried with **exponential backoff** [wait 1s,
  then 2s, 4s, 8s, doubling each time] up to about 5 tries, then parked in a
  **dead-letter queue** [a separate queue holding messages that kept
  failing, kept for inspection instead of being retried forever].
- **Dedup:** retries mean the same notification can be sent twice. Give each
  one a `notification_id`, and check-then-mark-sent atomically before
  delivering, using Redis `SETNX` [set the key only if it does not already
  exist, as one atomic step] or a database unique constraint.
- **Preferences:** before sending anything, check the user's do-not-disturb
  hours, unsubscribe flags, and channel choice.

> **Interview phrasing:** "Retries make delivery at-least-once;
> deduplication at the consumer is what makes it effectively once."

## Design a Web Crawler

Download pages by following links from page to page, to feed
a search index. The design is about never fetching the same page twice and
never overloading any one website.

### Start with the problem

A search engine needs a copy of billions of pages, kept reasonably fresh.
The web is a graph: pages link to pages, the same page is reachable by many
routes, and every fetch spends some site's bandwidth. The crawler has to
explore that graph without fetching anything twice and without hammering any
one site.

```
Seed URLs → URL Frontier (priority queue) → Downloader → Parser
  → Seen-URL Filter (dedup) → Content Storage → Scheduler (re-crawl)
```

Seed URLs enter the **URL frontier** [the priority queue of URLs waiting to
be fetched]; the downloader fetches each page, the parser extracts its
links, new links pass the dedup filter back into the frontier, the content
is stored, and the scheduler decides when a page is due for a re-crawl.

- **Dedup:** billions of seen URLs will not all fit in memory. A **bloom
  filter** [a tiny probabilistic set that answers "definitely new" or
  "probably seen" without storing the items themselves] handles the fast
  check; it can be wrong in only one direction (calling a new URL "seen"),
  so canonical URLs also live in a database for the definitive answer.
- **Politeness:** per-domain rate limits, respect for `robots.txt` [the file
  a site publishes saying what crawlers may fetch], and spacing out requests
  to the same host.
- **URL normalisation:** `Example.com/path?b=2&a=1` and
  `example.com/path?a=1&b=2` are the same page; normalise (lowercase the
  host, sort the parameters) before the dedup check, or the filter counts
  them as two.
- **Distributed:** many workers pull from a shared frontier (Redis or
  Kafka), partitioned by a hash of the domain so that each worker owns
  particular domains, which makes per-domain politeness a local concern
  instead of a coordination problem.

> **Interview phrasing:** "A bloom filter is only ever wrong in one
> direction: it may call a new URL seen, never a seen URL new."
$body$, step = 2
  WHERE title = 'Classic HLD Problems';

UPDATE questions.bank SET lesson_md = $body$## Design a Chat System

At bottom, a chat system is two jobs: push a message instantly to someone who never asked for it, and store conversations so the recent ones read back fast and in order. Everything in this design serves one of those two jobs.

The request: build messaging that supports 1:1 and group chat, delivers each conversation's messages in order, shows **presence** [whether a user is online right now], keeps history, and reaches offline users with a push notification. Start with delivery, because it decides the protocol.

When user A sends a message, the server suddenly has news for user B, and B asked for nothing. Plain HTTP cannot hand that over: the server only ever answers requests. **Polling** [the client asking "anything new?" on a timer] fakes it, but every message arrives up to one interval late and most requests return nothing, so it is high-latency and wasteful. The fix is a **WebSocket** [a connection that stays open after one HTTP handshake and then carries messages in both directions]: it is persistent and **full-duplex** [either side can send at any time], so the server pushes the message to B the moment A sends it.

One server cannot hold every connection, so at scale clients land on different chat servers, and the servers must route messages between each other: A's server has to reach B's.

```
Client A -WS-> Chat Server 1 --+
Client B -WS-> Chat Server 2 --+--> Message Queue (Kafka)
                                          |
                                          v
                            Message Service (store + route)
                                          |
                                          v
                                Chat DB (Cassandra)
                                          |
                                          v
                    Push Notification Service (offline users)
```

The **message queue** [a buffer service that stores messages so sender and receiver do not have to be up, or fast, at the same moment], usually Kafka, sits between the servers. Cross-server routing then works one of two ways. Either it goes through the queue: Server 1 publishes to Kafka, Server 2 is subscribed and delivers to B down B's WebSocket. Or it goes direct: a presence service in **Redis** [an in-memory key-value store] records which server each user is connected to, so Server 1 looks up B's server and sends straight to it.

Storage next. Chat traffic is write-heavy, and it is always read the same way: one conversation, a recent time range. That is exactly the shape **Cassandra** [a distributed NoSQL database built for heavy writes, where you lay each table out to fit one query] is built for:

```sql
CREATE TABLE messages (
    conversation_id UUID,
    message_id      TIMEUUID,      -- time-sortable
    sender_id       UUID,
    content         TEXT,
    PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

The **partition key** [the column whose value decides which node stores a row] is `conversation_id`, so a whole conversation is colocated on one node. The **clustering key** [the column that sorts rows within one partition] is `message_id`, and because a **TIMEUUID** is a UUID [a 128-bit unique identifier] whose leading bits are a timestamp, sorting by it is sorting by time. The result: `... WHERE conversation_id = ? LIMIT 20`, the load-recent-history query, is one fast sequential read.

Ordered delivery needs ids that sort by time. A database auto-increment column gives that, but it needs a central generator every message must pass through, and that generator becomes a bottleneck at scale. A **Snowflake ID** removes the coordination: every machine builds 64-bit ids on its own, laid out as 1 unused sign bit, 41 bits of timestamp, 5 bits of datacenter id, 5 bits of machine id, and 12 bits of per-millisecond sequence. Unique, roughly time-sortable, no coordination.

Presence uses expiry instead of detection. Each open connection sends a **heartbeat** [a tiny periodic "still here" message] roughly every 5 seconds, and the server refreshes a `presence:{user_id}` key in Redis with a short **TTL** [time to live: the store deletes the key itself when the timer runs out]. When the heartbeats stop, the key expires on its own, and a missing key means offline. Nothing ever has to notice the disconnect; the data cleans itself up.

For a user who is offline, the message is stored as usual and a push goes out through **APNs or FCM** [Apple's and Google's push services, the way to reach a phone whose app is not open]. When the client reconnects, it fetches every message since its last-seen timestamp, so nothing sent in the gap is lost.

> **Interview phrasing:** "Chat is write-heavy and always read by conversation plus time range, so I partition by conversation and cluster by a time-sortable message id; recent history is then one sequential read."

## Design Search Autocomplete

Autocomplete comes down to one trick: the answers must appear faster than a person types, and nothing computed on the spot is that fast, so every answer is precomputed and a lookup only reads it.

The scenario: a user has typed "se" into a search box, and before the next keystroke lands the box should already be showing suggestions. The requirement is the **top-K** completions [the K best-ranked results, say the top five] for any prefix, ranked by how often each query is searched, in under 100ms. This feature is also called **typeahead**.

The structure built for by-prefix lookup is the **trie** [also called a prefix tree: a tree that stores strings one character per node, so all words sharing a prefix share a path]:

```
root -> s -> e -> n -> d      ("send")
             \
              -> a            ("sea")
        a -> p -> p -> l -> e ("apple")
```

Searching "se" walks two steps from the root, and every word below that node is a completion. But "every word below" means traversing the subtree, and for a deep trie that is too slow for the latency budget. The fix is to **cache the top-K at every node**: the "se" node itself stores a precomputed list like `["search", "send", "service"]`, so a lookup is a short walk plus reading one list, with no traversal at all.

Three moves take it to scale:

- **A Redis cache in front.** Map each prefix to its suggestion list, warmed with the most popular prefixes. Most traffic hits the cache and never reaches the trie at all.
- **Shard the trie by prefix range** once it outgrows one machine: one server holds a to m, another holds n to z.
- **Build in batch.** Do not update frequencies on every search. Aggregate the query logs, rebuild the whole trie periodically (hourly or daily) with a tool like Spark [a framework for batch computation over large log volumes], and swap the new trie in atomically.

```
type "se" -> API -> Redis GET autocomplete:se
   HIT  -> return top-K
   MISS -> trie service -> cache result -> return

Pipeline: search logs -> Kafka -> Spark (count freq, filter spam)
          -> new trie daily
```

> **Interview phrasing:** "Precompute top-K at every trie node and rebuild in batch from query logs; the read path is a walk plus a cached list, never a subtree traversal."

## Design YouTube: Upload and Streaming

Everything in a video system follows from one fact: the files are huge. So uploads are cut into pieces, the heavy processing runs in the background, and playback is served from copies kept near the viewer.

Two users, two problems. One uploads a 4GB video over a connection that will drop at least once before it finishes. The other presses play on a train, where bandwidth changes every few seconds. Upload and playback are separate pipelines, and each problem has its own fix.

```
Upload: User -> Upload Service -> raw storage (S3)
        -> async transcode (1080p / 720p / 360p) -> CDN

Stream: User -> nearest CDN edge
        -> origin (the S3 transcoded file) on a cache miss
```

S3 here is object storage [cheap, durable storage for large files, Amazon's in this case], and the **CDN** [content delivery network: caching servers placed physically near users] is what actually serves most playback; the origin is only consulted when an edge server misses.

**Chunked upload.** A multi-GB file sent as one request fails as one request. Split it into 5-10MB chunks, upload each chunk independently, and reassemble them server-side. The upload becomes resumable, and when something fails, only the failed chunk is re-uploaded, not the whole file.

**The transcoding pipeline.** **Transcoding** [re-encoding the raw video into each target resolution and format] is CPU-heavy: a 1-hour video can take 30+ minutes. That cannot happen inside any request, so it runs async. When the last chunk arrives ("all chunks received"), the service enqueues a job on a queue (SQS or Kafka); a worker pool picks jobs up and runs FFmpeg [the standard video-encoding tool], writes the output to S3 and the CDN, updates the video's metadata, and notifies the user. Each resolution is its own independent job, so the resolutions transcode in parallel.

**Adaptive bitrate.** The train problem: a player locked to 1080p stalls the moment bandwidth dips. Under **HLS or DASH** [the two standard adaptive-streaming protocols], the video is split into 2-10 second segments at every resolution, and the player first fetches a **manifest** [a small index file listing every segment at every resolution]. As the network changes, the player switches resolution at the next segment boundary. Quality degrades smoothly instead of playback stopping to buffer.

**Metadata** lives in an ordinary relational database: `video_id, user_id, title, status, duration_s, view_count, created_at`, where `status` moves through uploading, processing, published, or failed. One column is a trap: `view_count` is written constantly, on every single view, and that many concurrent increments against one row serialize on the row's lock (**hot-row contention** [one row so popular that waiting for its lock becomes the bottleneck]). So views are incremented in Redis and flushed to the database periodically, turning a flood of row writes into a few.

> **Interview phrasing:** "Upload is a pipeline, not a request: chunk the file, store it raw, transcode each resolution as a parallel async job, and serve segments from the CDN."

## LLD: Design a Parking Lot

This is a different kind of interview question: not a system of servers, but the classes inside one program, and what it grades is clean object-oriented design.

The name for it is **LLD** [low-level design: the class-level design of one component, as opposed to the distributed systems above]. "Design a parking lot" tests object-oriented design in a design context: turning entities into classes, giving each one the right responsibilities, and justifying every pattern you reach for.

The entities (a `?` marks a field that is sometimes empty):

```
ParkingLot       floors[]
                 getAvailableSpot(vehicle)
                 parkVehicle(vehicle) -> Ticket
Floor            spots[]
                 getAvailableSpot(VehicleType)
ParkingSpot      id
                 type: COMPACT | LARGE | HANDICAPPED | MOTORCYCLE
                 status: AVAILABLE | OCCUPIED | RESERVED
                 vehicle?
Vehicle          abstract: license_plate, type
                 subclasses: Car, Truck, Motorcycle
Ticket           id, spot, vehicle, entry_time, exit_time?
PaymentStrategy  calculate(ticket) -> double
                 implementations: CashPayment, CardPayment
```

Four classic patterns show up, each at a real variation point:

- **Strategy** [a family of interchangeable algorithms behind one interface]: the payment method. `CashPayment` and `CardPayment` both implement `calculate(ticket)`, so adding a payment type touches no existing code.
- **Singleton** [a class the program instantiates exactly once]: the `ParkingLotManager`, because there is one lot and every caller must see the same state.
- **Factory** [one place that decides which concrete class to construct]: `SpotFactory.create(VehicleType)` chooses the spot type, so that decision is not scattered across callers.
- **Observer** [objects subscribe to another object's events and get notified on change]: the admin is notified when a floor is full, without `Floor` knowing who is listening.

A spot's status is a small state machine, worth drawing:

```
AVAILABLE --park--> OCCUPIED --leave--> AVAILABLE
    \
     --reserve--> RESERVED --use--> OCCUPIED
```

> **Interview phrasing:** "I list the entities and their lifecycles first, then apply a pattern only where a variation point exists: Strategy for payment, Factory for spot creation."

## The Trade-offs Cheat Sheet

Every design choice buys something by paying for something else. The skill this section drills is knowing the price of your own choices.

The scenario: you say "I'd use Cassandra here" and the interviewer goes quiet, waiting. What they are waiting for is the cost. Name trade-offs unprompted, before being asked: it is the single biggest differentiator between candidates.

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

The rows in one line each, for any term the table assumes:

- **ACID** [atomicity, consistency, isolation, durability: the transactional guarantees relational databases make]. NoSQL trades them away for horizontal scale and flexible schemas.
- **Cache-aside**: the application reads the cache first and fills it from the database on a miss, so the cache can go stale. **Write-through**: every write goes to cache and database together, so nothing is stale but every write pays twice.
- **Fan-out on write** precomputes each follower's feed when a post is created, so reads are instant; one celebrity post becomes millions of writes, which is the **write amplification**. **Fan-out on read** assembles the feed when it is requested instead.
- **Strong consistency** means every read sees the latest write; **eventual consistency** means replicas converge but a read can be briefly stale, in exchange for staying available and fast.
- **Normalised** data stores each fact exactly once and joins at read time; **denormalised** data duplicates facts into the shape reads want, trading storage and integrity for speed.
- A **monolith** [one deployable program] is simple to build and run; **microservices** scale and deploy independently at the cost of that simplicity.
- **Sync** work happens inside the request; **async** work is queued and done later, buying throughput and resilience at the cost of a simple call-and-return flow.
- **Push** notifications arrive immediately but need connection machinery and can be missed; **pull** is simpler but late.
- A **301** [permanent redirect] is cached by browsers, so repeat visits skip your server entirely: less load, but those visits vanish from your analytics. A **302** [temporary redirect] keeps every visit coming through, so you can count them.
- A short cache **TTL** propagates changes quickly but sends more queries to the source; a long one is the reverse.

> **Interview phrasing:** "Every choice buys something and pays for it somewhere; I name the price before the interviewer asks for it."

## Full Framework, Worked Example

A strong system-design answer has one repeatable shape: agree on what to build, put numbers on it, sketch the whole thing, go deep on two parts, then attack the weak points. This section runs that shape once, end to end.

The question: "design a chat system for 50M DAU" [daily active users]. Five steps, in order, each feeding the next.

1. **Clarify.** 1:1 or groups? What is the maximum group size? Is history kept, and with what retention? Is presence required? What latency is acceptable? The requirements decide the architecture, so they come before any of it.
2. **Estimate.** 50M DAU × 20 messages per day = 1B messages/day, which is about 12K write **QPS** [queries per second] averaged across the day. At roughly 200 bytes per message that is 200 GB/day, and about 365 TB over 5 years. These numbers are what justify everything after them: this is a write-heavy system that needs a distributed store.
3. **High-level design.** WebSockets into a fleet of chat servers; a message queue between the servers to decouple and buffer them; Cassandra for messages, because the load is write-heavy and partitions naturally by conversation; Redis for presence and a recent-messages cache; a push service for offline users.
4. **Deep dive on two parts.** Pick two and go deep rather than staying shallow everywhere:
   - *Storage.* Cassandra keyed `(conversation_id, message_id TIMEUUID)`. The partition colocates a conversation on one node, and the TIMEUUID gives time-sorted reads for free.
   - *Presence.* A heartbeat every 5 seconds refreshes `presence:{user_id}` in Redis with a 10 second TTL; no heartbeat means the key expires, and an expired key means offline. Self-cleaning: no code ever has to detect the disconnect.
5. **Bottlenecks.** WebSocket connections can saturate a single server, so scale that tier out and route each user to a server by **consistent hashing** [a hashing scheme where adding or removing a server moves only a small share of keys] on user_id, with cross-server delivery through Kafka. Very large groups (over 500 members) make per-message fan-out too expensive, so they switch to fan-out on read: the feed is assembled when a member opens the chat instead of being pushed to every member on send.

> **Interview phrasing:** "Clarify, estimate, high-level design, two deep dives, then bottlenecks; the estimates are what let every later choice defend itself."
$body$, step = 3
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
