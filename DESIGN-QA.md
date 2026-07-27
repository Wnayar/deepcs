# DeepCS — Design Q&A

Working notes on the parts of `DESIGN.md` I'm still going through. Everything
else that was here has been merged into the design doc itself; the full earlier
version is in git history.

**Contents**

- [**0. Foundations — the machine, drawn**](#0)
  - [0.1 The map](#0-1)
  - [0.2 What each box physically is](#0-2)
  - [0.3 Why the timings look like that](#0-3)
  - [0.4 Inside one core](#0-4)
  - [0.5 RAM, addresses, and why processes can't touch each other](#0-5)
  - [0.6 Threads, and what the scheduler physically does](#0-6)
  - [0.7 The kernel, the NIC, and who is actually waiting](#0-7)
  - [0.8 Blocking vs non-blocking — where your thread physically is](#0-8)
  - [0.9 Concurrency vs parallelism](#0-9)
  - [0.10 Two server designs on this hardware](#0-10)
  - [0.11 Races: one machine vs two](#0-11)
  - [0.12 Little's Law — the formula behind `--concurrency`](#0-12)
  - [0.13 Percentiles](#0-13)
  - [0.14 A Cloud Run instance, on the map](#0-14)
  - [0.15 The map with DeepCS on it](#0-15)
  - [0.16 Carry these into 33 / 37 / 47](#0-16)
- [33. max-instances vs concurrency](#33)
- [37. k6 + concurrency fundamentals](#37)
- [47. Threads, the event loop, and what Node actually does](#47)

---

<a id="0"></a>
# 0. Foundations — the machine, drawn

This section builds **one picture of a computer** and then never leaves it.
Every idea in §33, §37 and §47 is a specific place on that picture: the event
loop is a thing happening in one box, a race condition is two boxes that aren't
wired together, `--concurrency=80` is a number you can read off it.

So when something below stops making sense, the fix is always the same: **find
it on the map.** Each subsection starts by telling you where it lives.

<a id="0-1"></a>
## 0.1 The map

This is one server. Not a metaphor for one — this is the layout of the actual
board, with the round-trip time to reach each part written on the right.

```
┌──────────────────────────────────────────────────────────────────┐
│  ONE PHYSICAL SERVER  (a machine in a rack in a datacenter)      │
│                                                                  │
│  ┌────────────── CPU PACKAGE — one chip, ~2 cm² ─────────────┐   │
│  │                                                           │   │
│  │  ┌─CORE 0──┐  ┌─CORE 1──┐  ┌─CORE 2──┐  ┌─CORE 3──┐       │   │
│  │  │registers│  │registers│  │registers│  │registers│ 0.3ns │   │
│  │  ├─────────┤  ├─────────┤  ├─────────┤  ├─────────┤       │   │
│  │  │L1  32 KB│  │L1       │  │L1       │  │L1       │  1 ns │   │
│  │  ├─────────┤  ├─────────┤  ├─────────┤  ├─────────┤       │   │
│  │  │L2   1 MB│  │L2       │  │L2       │  │L2       │  4 ns │   │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │   │
│  │       └────────────┴─────┬──────┴────────────┘            │   │
│  │           ┌──────────────┴──────────────┐                 │   │
│  │           │  L3 CACHE — 32 MB, shared   │           40 ns │   │
│  │           └──────────────┬──────────────┘                 │   │
│  │              ┌───────────┴───────────┐                    │   │
│  │              │   MEMORY CONTROLLER   │                    │   │
│  │              └───────────┬───────────┘                    │   │
│  └──────────────────────────┼────────────────────────────────┘   │
│                             │  memory bus                        │
│              ┌──────────────┴──────────────┐                     │
│              │  RAM — DRAM sticks,  16 GB  │            100 ns   │
│              └─────────────────────────────┘                     │
│                                                                  │
│  ══════════════════════ PCIe bus ═══════════════════════════     │
│          │                                  │                    │
│   ┌──────┴───────┐                 ┌────────┴────────┐           │
│   │  NVMe SSD    │  150 µs         │      NIC        │  500 µs   │
│   │  512 GB      │                 │  network card   │           │
│   └──────────────┘                 └────────┬────────┘           │
│                                             │                    │
└─────────────────────────────────────────────┼────────────────────┘
                                              │
                                    ──────────┴──────────
                                     to the switch, then
                                     Postgres, Redis, users
```

Three things to read off it before anything else.

**It is a hierarchy of distance.** Registers are micrometres from the arithmetic
unit; L1 is a millimetre or two away; RAM is on a separate stick you can pull out
with your fingers; the NIC is on the far side of a bus and everything past it is
another machine entirely. **Time goes up as you go down the picture**, and it
goes up brutally — the bottom of this diagram is a million times slower than the
top.

**Only the CPU package executes anything.** RAM does not compute. The SSD does
not compute. They store and they transfer. Every line of your JavaScript happens
inside one of those four little CORE boxes.

**Everything below the memory controller is somebody else's problem.** When your
code asks Postgres for rows, the request leaves through the NIC and the CPU has
literally nothing to do until it comes back. That gap — drawn to scale — is
what the rest of this document is about.

<a id="0-2"></a>
## 0.2 What each box physically is

Worth having, because "cache" and "RAM" are not two sizes of the same thing —
they're built from different circuits, and that's *why* they have different
speeds.

**Transistor** — a switch made in silicon, with no moving parts. Roughly 10–50
billion of them are on that one chip. Every box in the CPU package is some
arrangement of them.

**Register** — about 64 bits of storage, sitting directly against the arithmetic
unit. A core has a few dozen. **All arithmetic happens here and nowhere else** —
if you want to add two numbers in RAM, they must first be copied into registers.
Total capacity of all registers in a core: about 2 KB.

**Cache — SRAM** [static RAM: ~6 transistors per bit, arranged so the bit holds
itself stable as long as there's power]. Fast, because reading it is just
switching some transistors. Expensive and physically large per bit, which is why
L1 is 32 KB and not 32 GB.

**RAM — DRAM** [dynamic RAM: 1 transistor + 1 capacitor per bit]. A bit is
"stored" as charge in a tiny capacitor. That's incredibly dense — hence 16 GB —
but it has two consequences you can feel:

- The capacitor **leaks**. Every bit must be read and rewritten thousands of
  times per second or it decays to noise. That's the *dynamic* in DRAM, and it's
  why RAM forgets everything the moment you cut power.
- Reading it is **destructive**. Sensing the charge drains it, so a read is
  really read-then-write-back. That's a chunk of the 100 ns.

**SSD — NAND flash** [charge trapped on an insulated gate]. The insulation means
the charge stays put with no power, which is why the disk survives a reboot. But
writing means forcing charge *through* the insulator, which slowly damages it —
that's why SSDs have a finite write endurance and RAM doesn't.

**NIC** [network interface card] — converts bits in memory into electrical or
optical signal on a cable, and back. Crucially it can read and write RAM by
itself, without the CPU (§0.7).

**Bus** — a set of parallel wires plus a protocol for who's allowed to talk on
them. The memory bus connects the CPU to the DIMM slots; PCIe connects the CPU to
plug-in cards. A bus is shared, so devices take turns, and that queueing is part
of the timings.

The pattern: **fast, small, volatile at the top; slow, large, persistent at the
bottom.** No technology is good at both, and the whole hierarchy exists to hide
that.

<a id="0-3"></a>
## 0.3 Why the timings look like that

**On the map:** you are following one request for data down the right-hand side,
from a core towards the bottom.

When a core needs the value at some address, it doesn't "go to RAM". It asks each
level in turn:

```
   core needs the value at address X
     │
     ├─► in L1?   ── yes ──► done, ~1 ns
     │   no  (+1 ns already spent)
     ├─► in L2?   ── yes ──► done, ~4 ns
     │   no  (+4 ns)
     ├─► in L3?   ── yes ──► done, ~40 ns
     │   no  (+40 ns)
     ▼
   memory controller → open the right DRAM row → sense the charge →
   send it back up the bus → refill L1, L2, L3 on the way
                                                       total ~100 ns
```

That last step is called a **cache miss**, and the ~100 ns is mostly not travel
time. It's DRAM row activation, the sense-and-rewrite from §0.2, the bus
protocol, and queueing behind other requests. Signal flight time across the board
is only a nanosecond or two of it.

**Which of these numbers are physics and which are engineering** — worth knowing,
because it tells you which ones might improve:

| Step | Dominated by | Can it get much better? |
|---|---|---|
| L1/L2/L3 | transistor switching, wire length on-die | slowly, with process shrinks |
| RAM | DRAM cell behaviour, bus protocol | somewhat |
| SSD | flash sensing + controller + PCIe queueing | yes, and has been |
| network, same datacenter | switch hops + kernel network stacks at both ends | yes |
| network, cross-ocean | **speed of light in glass** | **no. ever.** |

That last row is the only hard physical floor here. Light in optical fibre travels
about 200,000 km/s. London to Sydney is ~17,000 km as the crow flies and further
as the cable runs, so a round trip cannot beat roughly 170 ms no matter who builds
it. **This is why `asia-southeast1` for DeepCS is a correctness-of-experience
decision, not a cost one** — no amount of optimisation moves a user in Singapore
closer to a database in Virginia.

### The same numbers, rescaled

The ratios are impossible to feel at nanosecond scale. So multiply every number
by 3.3 billion — a pure unit change, nothing added:

```
   if ONE CPU INSTRUCTION took 1 second, then:

   execute 1 instruction        1 second        █
   read L1 cache                3 seconds       █
   read RAM                     5 minutes       ██
   read 4 KB from SSD           6 days          ████████
   network round trip, same DC  19 days         ████████████
 ► your Postgres query          3 YEARS         ██████████████████████████
   network RTT, cross-ocean     16 YEARS        ███████████████████...
```

Sit with the marked row. **Your Postgres query, on this scale, takes three
years.** If the CPU waits for it, you have bought a machine that can do a billion
things a second and asked it to do nothing for three years.

```
   one "typical" DeepCS request, drawn to scale:

   |CPU 2ms|················ waiting on Postgres 30ms ···············|
     ~6%                              ~94%
```

**Every remaining idea in this document is one question: what does the machine do
during that 94%?**

<a id="0-4"></a>
## 0.4 Inside one core

**On the map:** you are inside a single CORE box, top-left.

A core does exactly one thing, forever. Zoomed in:

```
   ONE CORE
   ┌────────────────────────────────────────────────────────────┐
   │                                                            │
   │   ┌──────────┐   "what's next?"                            │
   │   │  FETCH   │ ◄─────────────────  the instruction pointer │
   │   └────┬─────┘                     holds ONE address       │
   │        │  raw bits from memory: 48 83 E8 01                │
   │   ┌────▼─────┐                                             │
   │   │  DECODE  │   "that means: SUB, register rax, by 1"     │
   │   └────┬─────┘                                             │
   │        │              ┌───────────────────────────────┐    │
   │   ┌────▼─────┐        │ REGISTERS                     │    │
   │   │ EXECUTE  │◄──────►│  rax  rbx  rcx  rdx  …        │    │
   │   │  (ALU)   │        │  RIP = 0x401a3f   ← "I'm here"│    │
   │   └────┬─────┘        └───────────────────────────────┘    │
   │        │                                                   │
   │        └──► advance the instruction pointer, repeat        │
   │                                                            │
   └────────────────────────────────────────────────────────────┘
```

**ALU** [arithmetic logic unit] — the circuitry that actually adds, subtracts and
compares. **Instruction pointer** (also called the program counter, `RIP` on
x86-64) — one register holding the address of the next instruction. It is the
core's entire sense of "where am I".

**The rule to hold onto: one core executes one instruction stream at a time.**
Not two. Every claim later about "running many things at once" resolves to
either *the core switching between streams very fast* or *there being more than
one core box*. There is no third option.

Now watch a single line of JavaScript become instructions:

```js
tokens = tokens - 1;
```

```
   LOAD   rax ← [address of tokens]     ← reaches into RAM.  ~100 ns
   SUB    rax, 1                        ← happens in a register.  0.3 ns
   STORE  [address of tokens] ← rax     ← writes back to RAM
```

**Three separate instructions.** Nothing in the hardware ties them together;
between any two of them, the core can be taken away and given to something else.
Hold onto that — it is the entire mechanism of §0.11.

Note also the shape of it: the two slow instructions exist purely to move the
value to where arithmetic is possible and back again. That's the memory hierarchy
showing up in a one-line assignment.

### Multiple cores

A modern chip has several core boxes on the same die. "8 cores" means eight
independent fetch/decode/execute units, each with its own registers and
instruction pointer, sharing L3 and the memory controller.

**Eight cores means at most eight instructions retiring per cycle across the
whole machine.** It does not mean anything runs faster on its own. A single
instruction stream — like all your JavaScript, §0.10 — uses exactly one of those
boxes and the other seven sit idle as far as it's concerned.

<a id="0-5"></a>
## 0.5 RAM, addresses, and why processes can't touch each other

**On the map:** the RAM box, and one piece of hardware inside each core that the
map doesn't show yet.

- A **program** is a file on the SSD. It does nothing.
- A **process** is a program that's running: instructions in RAM, a core
  executing them, and its own private view of memory.

That privacy is not a rule the operating system politely follows. It is enforced
by a circuit. Every core contains an **MMU** [memory management unit], and it
sits between the core and everything else:

```
       PROCESS A                          PROCESS B
   "read address 0x1000"              "read address 0x1000"
            │                                  │
            ▼                                  ▼
   ┌────────────── MMU — inside the core ──────────────────────┐
   │                                                           │
   │  looks up whichever PAGE TABLE is currently installed.    │
   │  "which one is current" is itself just a register         │
   │  (CR3 on x86). The kernel rewrites that register every    │
   │  time it switches processes.                              │
   │                                                           │
   └────────┬──────────────────────────────────┬───────────────┘
            │  A's table: 0x1000 → 0x7F3A2000  │  B's table:
            │                                  │  0x1000 → 0x11C40000
            ▼                                  ▼
   ┌────────────────────── PHYSICAL RAM ───────────────────────┐
   │  …  [0x11C40000: B's bytes]  …  [0x7F3A2000: A's bytes] … │
   └───────────────────────────────────────────────────────────┘
```

Same number in, different bytes out. And the isolation is total: **there is no
instruction process A can execute that reaches B's memory**, because A's page
table contains no entry pointing there, and the MMU is the only path from an
address to a physical location. A can't "just try" — the address it would need to
try doesn't exist in its map.

**This is the hardware fact under every isolation guarantee in DeepCS.** One
Cloud Run instance crashing cannot corrupt another. It's also, read the other
way, the reason two instances can't share a counter (§0.11).

A **page** is the unit of all this — 4 KB on x86-64. Page tables map pages, not
bytes.

**TLB** [translation lookaside buffer] — translating on every single memory
access would be ruinous, so each core caches recent translations in a small
buffer. Switching processes invalidates much of it, which is a real part of the
cost in §0.6.

### The address space a process sees

Because of the MMU, every process sees a clean, private, apparently-huge range of
addresses. Its layout:

```
   ┌─────────────────────────────┐  high addresses
   │  STACK          ↓ grows down│  function calls and their local
   │                             │  variables. Automatic, strictly
   │                             │  last-in-first-out.
   │      (unmapped space)       │  ← not backed by any physical RAM
   │                             │
   │  HEAP           ↑ grows up  │  anything that must outlive the
   ├─────────────────────────────┤  function that created it
   │  GLOBALS / static data      │
   ├─────────────────────────────┤
   │  CODE (the instructions)    │
   └─────────────────────────────┘  low addresses
```

**Stack:** calling a function pushes a **stack frame** — its arguments, its local
variables, and the address to return to. Returning pops it, and that space is
instantly reusable. Fast and completely automatic. Also *small* (commonly 1–8 MB
per thread) and strictly ordered: a frame cannot outlive its function.

**Heap:** memory you request explicitly, which lives until freed (in C) or
garbage-collected (in JavaScript). Slower to allocate, but it can outlive the
function that created it and it can be large.

**The connection to §47.** That section says an `await`ed function "suspends onto
the heap and its stack frame unwinds." In map terms: the paused function stops
being a region of stack and becomes an object in the heap region. That's the
entire reason one Node process can hold 80 requests at once — 80 parked stacks
would cost real memory and real scheduler attention; 80 small heap objects cost
almost nothing.

**One correction to the usual telling:** that diagram is the *virtual* address
space, not physical RAM. A page only consumes physical RAM once it's actually
touched. So "8 MB of stack per thread" is 8 MB of address space and typically
only tens of KB of real memory — which matters in §0.10, where the standard
explanation of why threads don't scale is subtly wrong.

<a id="0-6"></a>
## 0.6 Threads, and what the scheduler physically does

**On the map:** the CORE boxes, and a queue the kernel keeps in RAM.

A **thread** is one flow of execution through code. It is what the operating
system places onto a core.

A thread owns exactly two things: **its own stack** and **its own instruction
pointer** (plus its register values while running). Everything else — the heap,
the code, open sockets — is shared with the other threads in the same process.

```
   PROCESS  (one private memory map, one page table)
   ┌──────────────────────────────────────────────────────┐
   │   CODE  +  HEAP     ← SHARED by every thread here    │
   │                       (this sharing is where the     │
   │                        hazard in §0.11 comes from)   │
   │                                                      │
   │   ┌──────────┐   ┌──────────┐   ┌──────────┐         │
   │   │ thread 1 │   │ thread 2 │   │ thread 3 │         │
   │   │  stack   │   │  stack   │   │  stack   │ ← private
   │   │   IP     │   │   IP     │   │   IP     │ ← private
   │   └──────────┘   └──────────┘   └──────────┘         │
   └──────────────────────────────────────────────────────┘
```

Threads are not cores. There are always far more threads than cores, so the
kernel keeps a **run queue** — the list of threads that want a core right now —
and hands cores out in slices of a few milliseconds:

```
   run queue:  [ T4 ][ T7 ][ T2 ][ T9 ]  ← want to run, waiting their turn
                 │
   ┌─CORE 0──┐   │   ┌─CORE 1──┐
   │   T1    │◄──┘   │   T3    │        ← actually executing right now
   └─────────┘       └─────────┘

   wait queue: [ T5 blocked on socket 7 ][ T8 blocked on a file read ]
                 ↑
        these are NOT in the run queue. The scheduler doesn't
        even consider them. They are not "slow" — they are absent.
```

That wait queue is the single most important thing on this diagram, and §0.8 is
entirely about it.

### What a context switch actually costs

When the kernel moves a core from thread A to thread B:

```
   1. save A's registers + instruction pointer into A's kernel record
   2. load B's registers + instruction pointer
   3. if B is in a DIFFERENT process: install B's page table
      (rewrite CR3) — which invalidates most of the TLB
   4. resume
```

Steps 1–2 are cheap: roughly a microsecond. The expensive part is invisible and
comes afterwards — **B starts running with caches full of A's data.** Every early
memory access B makes is a cache miss (~100 ns each, §0.3) and every address
translation is a TLB miss, until B's working set is pulled back in. The direct
cost is ~1 µs; the indirect cost can be several times that.

**Two consequences to keep:**

- Two threads in the same process can genuinely execute at the same instant, on
  two different core boxes, both touching the same heap. That's the power and the
  hazard.
- Two separate *processes* cannot touch each other's memory at all — different
  page tables, §0.5. That is exactly the situation of two Cloud Run instances.

<a id="0-7"></a>
## 0.7 The kernel, the NIC, and who is actually waiting

**On the map:** the NIC box, the PCIe bus, and the RAM box — plus a hardware
detail that changes everything.

The **kernel** is the core of the operating system. It is the only code allowed
to talk to hardware directly, decide which thread sits on which core, and hand
out physical memory.

This isn't a convention either — it's a mode bit in the CPU. x86 has privilege
levels (**rings**); the kernel runs at ring 0, your program at ring 3. Certain
instructions simply fault if attempted at ring 3.

```
   ┌──────────────────────────────────────────────────┐
   │  YOUR PROGRAM                ring 3 / user space │
   │  "please read from socket 7"                     │
   │                  │                               │
   │                  │  the `syscall` instruction    │
   │                  │  flips the mode bit AND jumps │
   │                  │  to a fixed kernel address    │
   │                  │  chosen by the kernel at boot │
   │                  ▼                               │
   ├──────────────────────────────────────────────────┤ ← the only door,
   │  KERNEL                    ring 0 / kernel space │   and the kernel
   │  owns: CPU scheduling, page tables,              │   picked where it
   │        the NIC, the SSD                          │   leads
   ├──────────────────────────────────────────────────┤
   │  HARDWARE                                        │
   └──────────────────────────────────────────────────┘
```

You can't jump to an arbitrary kernel address and land in ring 0 — the transition
and the destination are fixed together in hardware. That's the whole security
model.

A **socket** is the kernel's record of one network connection. A **file
descriptor** is just an integer your program uses to name one — socket 7, socket
8. When §47 says "tell me when file descriptor 7 is readable", this is what it
means.

### The part that makes everything else work: DMA

Here is what physically happens when Postgres replies:

```
   1. bits arrive on the wire from the switch
                                          ┌───────────┐
      ────────────────────────────────►   │    NIC    │
                                          └─────┬─────┘
   2. the NIC writes them into RAM              │  DMA — direct
      BY ITSELF. The CPU is not involved.       │  memory access,
      No instructions execute for this.         ▼  no CPU
                                          ┌───────────┐
                                          │    RAM    │ ← the packet is
                                          └───────────┘    now here

   3. the NIC then raises an interrupt
      line — a physical wire to the CPU   ┌───────────┐
      ──────────────────────────────────► │   CORE    │
                                          └─────┬─────┘
   4. the core abandons its current             │
      instruction stream and jumps to           ▼
      the kernel's handler                kernel copies the bytes into
                                          socket 7's buffer and moves the
                                          waiting thread from the WAIT
                                          queue back to the RUN queue
```

**DMA** [direct memory access] is why "the CPU is free during the wait" is
literally true and not a figure of speech. The transfer genuinely happens without
the CPU. A **hardware interrupt** is a physical signal that forces a core to stop
its current instruction stream and jump to a kernel address — the only way the
outside world can get the CPU's attention without being asked.

**So: your program never waits for the network. It asks the kernel to arrange for
the hardware to interrupt when something arrives.** The only thing that differs
between the two models in §0.8 is what *your thread* does in the meantime.

<a id="0-8"></a>
## 0.8 Blocking vs non-blocking — where your thread physically is

**On the map:** the run queue and wait queue from §0.6.

Two ways to ask the kernel for data that hasn't arrived yet.

**Blocking** — "give me the data, and don't come back until you have it."

```
   BEFORE the call                    AFTER read() blocks
   ┌─CORE 0──┐                        ┌─CORE 0──┐
   │ thread A│ ◄── running            │ thread Q│ ◄── someone else entirely
   └─────────┘                        └─────────┘

   run queue:  [Q][R]                 run queue:  [R]
   wait queue: []                     wait queue: [A — socket 7]
```

Thread A is not slow. Thread A is **not scheduled**. It holds no core, executes
no instructions, and the scheduler will not consider it again until the NIC
interrupt from §0.7 moves it back. From the core's point of view, thread A has
ceased to exist.

**Non-blocking** — "give me the data if it's ready this instant, otherwise say
'not ready' immediately and let me carry on."

```
   BLOCKING — one thread, one request
   thread: [ 2ms work ]▓▓▓▓▓▓▓ in the wait queue, 30ms ▓▓▓▓▓▓[ 1ms ]
                       └── holds no core, achieves nothing


   NON-BLOCKING — one thread, three requests
   thread: [r1 2ms][r2 2ms][r3 2ms]……[r1 resumes][r2 resumes][r3 …]
                                    ↑
           all three 30 ms waits are happening at the NIC and in the
           kernel, overlapping each other, while the thread stays
           in the run queue and keeps executing
```

Blocking isn't *bad*. It's simple, and with one thread per request it's fine —
parking one thread parks one request. It becomes a disaster only when one thread
is serving many requests, because then parking it parks everybody.

**`epoll`** is the syscall that makes non-blocking practical at scale. Asking
"is socket 1 ready? is socket 2 ready?" across a thousand sockets would be a
thousand syscalls, each a ring transition. `epoll` is *one* call meaning: *"here
are a thousand descriptors — tell me which are ready, and if none are, put me in
the wait queue until at least one is."* (`kqueue` on macOS, IOCP on Windows —
same idea.) This is the machinery underneath Node, nginx, and every server that
holds a lot of connections.

<a id="0-9"></a>
## 0.9 Concurrency vs parallelism

**On the map:** how many CORE boxes are lit up at the same instant.

- **Concurrency** — several tasks are *in progress* during the same period. They
  take turns. A property of how the program is **structured**.
- **Parallelism** — several tasks are *executing in the same instant*. Requires
  more than one core box. A property of how it **runs**.

```
   CONCURRENCY — 1 core, 2 tasks
   CORE 0: [A][B][A][B][A][B][A][B]
   CORE 1: (idle)
           └──────── time ────────►
           both tasks are "in progress"; never simultaneous


   PARALLELISM — 2 cores, 2 tasks
   CORE 0: [A][A][A][A][A][A][A][A]
   CORE 1: [B][B][B][B][B][B][B][B]
           └──────── time ────────►
           genuinely in the same instant
```

The full picture:

|  | **One thread** | **Multiple threads** |
|---|---|---|
| **One core** | Concurrency only — the event loop takes turns | Concurrency only — the OS takes turns |
| **Multiple cores** | Concurrency only — one thread occupies one core box | **Parallelism possible** |

Two cells people get wrong. **Bottom-left:** Node on a 16-core machine still runs
your JavaScript inside one core box; the other 15 do nothing for it. **Top-right:**
two threads on a single core are *not* parallel — they interleave, exactly like an
event loop, just with the OS choosing the switch points rather than your `await`s.

**Threads make parallelism possible; cores make it actual; concurrency needs
neither.**

<a id="0-10"></a>
## 0.10 Two server designs on this hardware

**On the map:** how many threads you place on those core boxes to serve N users.

```
  MODEL 1 — THREAD PER REQUEST          (Apache, classic Java/Spring)

    request 1 ──► thread 1  [work]▓▓ in wait queue ▓▓[work] ──► response
    request 2 ──► thread 2  [work]▓▓ in wait queue ▓▓[work] ──► response
    request 3 ──► thread 3  [work]▓▓ in wait queue ▓▓[work] ──► response

    ✓ code reads top to bottom; blocking is fine, it parks one request
    ✓ uses every core box automatically — the scheduler spreads threads
    ✗ falls apart in the thousands (see below)


  MODEL 2 — EVENT LOOP                  (Node, nginx, Redis)

    request 1 ┐
    request 2 ┼─► ONE thread ──► [r1][r2][r3][r1][r3][r2] ──► responses
    request 3 ┘                  └ switches at every await ┘

    ✓ a paused request is a small heap object, not a parked thread
    ✓ tens of thousands of connections on one thread
    ✗ ONE slow CPU-bound function freezes every other request
    ✗ one thread occupies one core box — scaling out needs more processes
```

**Why thread-per-request actually fails at 10,000 threads** — the usual
explanation is "each thread reserves 8 MB of stack, so 10,000 threads is 80 GB."
That's wrong, and worth correcting because you'll meet it: as §0.5 says, the 8 MB
is *address space*, and only touched pages consume real RAM. 10,000 threads is
typically a few hundred MB resident, which a server has.

The real costs are the ones on this map:

- **Scheduler work.** The kernel maintains and re-sorts a run queue with 10,000
  entries, on every timer tick, on every core.
- **Cache and TLB destruction.** §0.6: each switch leaves the new thread running
  against caches full of the previous thread's data. With 10,000 threads rotating
  through 4 cores, the L1/L2 working set is never anyone's. The machine spends
  its time refilling caches rather than computing.

This has a name — the **C10K problem** — and the fix was `epoll` plus model 2.

### The event loop is not mysterious

It is a loop, written in C, running on one thread inside one core box:

```
  while (there is outstanding work) {

      run any timer callbacks that are now due;

      call epoll_wait: "which I/O finished?"    ← the thread enters the
                                                  WAIT QUEUE here if
      for each finished one:                      nothing is ready
          run the JavaScript callback for it;   ← YOUR CODE RUNS HERE

      run any close/cleanup callbacks;
  }
```

Two consequences fall straight out of that shape:

1. **Your JavaScript runs in bursts, and each burst runs to completion.** The
   loop cannot interrupt your function partway through — there's no other thread
   to interrupt it *with*. Nothing slips between two of your lines. This is what
   makes single-threaded JS safe to write without locks.
2. **If one burst takes 250 ms, the loop is stuck for 250 ms.** It cannot reach
   `epoll_wait`. Completed database results for every other request sit in kernel
   socket buffers — already DMA'd into RAM, already interrupted, already
   waiting — unread. That is "blocking the event loop", and it's the failure §33
   warns about.

Note where the data physically is during that failure: **in RAM, done, metres
from the core that's ignoring it.** The requests aren't slow. Nothing is
executing that would notice they've finished.

<a id="0-11"></a>
## 0.11 Races: one machine vs two

**On the map:** whether two things touching the same value have a wire between
them.

A **race condition** is when two operations happening at once interleave on
shared data and produce a result neither would produce alone. The shape to
memorise is **read-modify-write** — §0.4 already showed one line of JS becoming
three instructions:

```
   LOAD   tokens → register     (read)
   SUB    register, 1           (modify)
   STORE  register → tokens     (write)
```

Here's the DeepCS rate-limiter bug:

```
   starting value: tokens = 1        (exactly ONE request should pass)

   Gateway instance A            Gateway instance B
   ──────────────────            ──────────────────
   LOAD  tokens → 1
                                 LOAD  tokens → 1    ← reads before A writes
   SUB               → 0
   STORE tokens = 0
                                 SUB               → 0
                                 STORE tokens = 0    ← A's write silently lost

   final: tokens = 0, but TWO requests got through
```

That's a **lost update**. **Atomic** means an operation that cannot be observed
half-finished and cannot be interleaved: it either has happened or it hasn't.

The question is what makes atomicity possible — and the answer is entirely about
wiring.

```
   TWO THREADS, ONE MACHINE — the hardware can see the conflict

   ┌── CORE 0 ──┐              ┌── CORE 1 ──┐
   │ L1:        │              │ L1:        │
   │ tokens = 1 │              │ tokens = 1 │   ← both cached a copy
   └──────┬─────┘              └─────┬──────┘
          └────────────┬─────────────┘
                ┌──────┴──────┐
                │  L3 / RAM   │   tokens = 1
                └─────────────┘

   The cores are physically wired together through L3. A cache
   coherence protocol runs on that wiring: before core 0 may write,
   it takes exclusive ownership of that 64-byte cache line and
   invalidates core 1's copy. A LOCK-prefixed instruction — which is
   what an atomic increment, and ultimately a mutex, compiles down
   to — holds that ownership across the whole read-modify-write.

   The fix exists because the wire exists.


   TWO CLOUD RUN INSTANCES — no wire, nothing to coordinate

   machine in rack 12            machine in rack 40
   ┌── CORE ──┐                  ┌── CORE ──┐
   │tokens = 1│                  │tokens = 1│   ← two unrelated values
   └────┬─────┘                  └────┬─────┘      that happen to share
   ┌────┴─────┐                  ┌────┴─────┐      a variable name
   │   RAM    │                  │   RAM    │
   └────┬─────┘                  └────┬─────┘
        │                             │
       NIC ────── network ─────────  NIC
        │                             │
        └─────────────┬───────────────┘
                ┌─────┴──────┐
                │   REDIS    │  ← the only memory both can see
                │ (a third   │
                │  machine)  │
                └────────────┘

   There is no shared cache line. No LOCK prefix crosses a network
   cable. The two "tokens" are different bytes in different DRAM in
   different racks.
```

So the three tools, and exactly where each one reaches:

| Tool | What it relies on | Works across… |
|---|---|---|
| **Atomic CPU instruction** (compare-and-swap, `LOCK` prefix) | cache coherence between cores on one chip | threads in one process, one machine |
| **Mutex / lock** | built on the above, plus the kernel's wait queue | threads in one process, one machine |
| **Atomic operation in a shared external store** | Redis executes one command — or one Lua script — start to finish on its single thread | **separate machines** ← DeepCS needs this |

**Scenario → failure → fix.** Two Gateway instances, one user, a burst of
requests. A mutex in Gateway's memory would compile down to a `LOCK` on a cache
line in rack 12's RAM — a line instance B's CPU has never heard of and cannot
address (§0.5). B sails straight through it. The user gets double their rate
limit. **The fix is not a better lock; it's putting the operation where the
single copy of the state lives.** The shared state is in Redis's RAM, so the
indivisibility has to be enforced by Redis's own single command-executing thread.
**That is the entire reason for the Lua script.**

<a id="0-12"></a>
## 0.12 Little's Law — the formula behind `--concurrency`

One formula, and `--concurrency=80` stops being arbitrary:

```
      L        =        λ        ×        W

  average number      arrival rate      average time
  of requests    =    (requests     ×   each one spends
  in flight            per second)      in the system
```

For DeepCS: if 100 requests/second arrive and each takes 32 ms end to end:

```
   L = 100 × 0.032 = 3.2 requests in flight on average
```

So `--concurrency=80` isn't a guess about traffic — it's roughly 25× headroom
over that average, sized for bursts. And it works on one thread because of §0.3:
of those 32 ms, only ~2 ms needs a core box at all.

The same formula tells you when the model breaks. If `W` rises — a slow query, a
CPU-bound function — then `L` rises for the *same* traffic, and you hit the
concurrency ceiling with no increase in load at all. **Latency problems become
capacity problems.** Worth being able to say out loud.

<a id="0-13"></a>
## 0.13 Percentiles

With concurrency, an average actively misleads you.

```
   100 requests, sorted by duration:

     10ms  ████████████████████████████████████████████  95 requests
   2000ms  ██                                             5 requests

   average = 110 ms   ← NOT ONE REQUEST took anywhere near this
   p50     = 10 ms    ← the median: half were faster
   p95     = 10 ms    ← 95% were at least this fast
   p99     = 2000 ms  ← 1 user in 100 waited two seconds
```

**pN means: N% of requests were faster than this number.** The average sits
between the fast group and the slow group, describing neither.

Report **p95 and p99**, because the tail is what users feel, and the tail is where
contention, queueing, cold starts and garbage collection show up first. A rising
p99 with a flat p50 is the classic early warning that something has started to
queue.

<a id="0-14"></a>
## 0.14 A Cloud Run instance, on the map

A **container** is not a small computer. It is an ordinary process on an ordinary
machine, fenced in by two kernel features:

- **Namespaces** control *what it can see* — its own view of the filesystem,
  process list, and network. It cannot see the host's other processes.
- **cgroups** [control groups] control *what it can use* — a hard cap on CPU time
  and physical memory.

```
   VIRTUAL MACHINE — emulates a whole computer
   ┌───────────┐ ┌───────────┐    heavy: GBs, boots in ~minutes,
   │  your app │ │  your app │    each has its own full kernel
   │  full OS  │ │  full OS  │
   └───────────┘ └───────────┘
         hypervisor
         hardware

   CONTAINER — just a process the kernel is fencing in
   ┌───────────┐ ┌───────────┐    light: MBs, starts in ~ms–seconds,
   │  your app │ │  your app │    no kernel of its own
   └───────────┘ └───────────┘
      SHARED host kernel  ← namespaces + cgroups do the isolating
      hardware
```

Which means one Cloud Run instance, drawn on the map from §0.1, is **a slice**:

```
   SOME GOOGLE MACHINE (many cores, lots of RAM, shared)
   ┌────────────────────────────────────────────────────────────┐
   │  ┌── CPU PACKAGE ────────────────────────────────────────┐ │
   │  │  ┌CORE0┐ ┌CORE1┐ ┌CORE2┐ ┌CORE3┐ ┌CORE4┐ ┌CORE5┐ …    │ │
   │  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘      │ │
   │  │   └──── cgroup caps you at ~1 core's worth ───┘       │ │
   │  └───────────────────────────────────────────────────────┘ │
   │  ┌── RAM ────────────────────────────────────────────────┐ │
   │  │ [your 512 MB][ other tenants' memory, invisible ]     │ │
   │  └───────────────────────────────────────────────────────┘ │
   └────────────────────────────────────────────────────────────┘
```

So, precisely:

> **one Cloud Run instance = one container = one Node process = one main thread
> running your JavaScript, on a slice of somebody else's machine.**

That chain is what ties this whole section to §33:

- `--max-instances=2` — at most two of those processes exist, **and they may be
  on entirely different physical machines** (which is §0.11, and the reason the
  rate limiter must live in Redis).
- `--concurrency=80` — each one holds up to 80 requests in flight on its single
  JS thread.

A **cold start** is that chain being built from nothing, and now you can see what
each step physically costs:

```
   pull image from registry     ← network + SSD writes    100s of ms
   start container              ← kernel creates namespaces, cgroups,
                                  a page table               ~ms
   boot Node                    ← read files from SSD, V8 initialises,
                                  JIT-compile your code    100s of ms
   open the Postgres pool       ← TCP handshakes + TLS + auth,
                                  each a network round trip  10s of ms
   ──────────────────────────────────────────────────────────────────
   ready                                        roughly 1–2 seconds
```

That's the price of `--min-instances=0`, and it lands on a real user's request.

<a id="0-15"></a>
## 0.15 The map with DeepCS on it

Same picture as §0.1. Now labelled with what your system actually does:

```
┌──────────────────────────────────────────────────────────────────┐
│  ONE CLOUD RUN INSTANCE OF `core`                                │
│                                                                  │
│  ┌────────────────────── CPU (your slice) ───────────────────┐   │
│  │                                                           │   │
│  │  ┌─CORE 0──────────────┐   ┌─ other cores ─┐              │   │
│  │  │ Node's MAIN THREAD  │   │ libuv pool ×4 │              │   │
│  │  │ ALL your JavaScript │   │ fs, DNS,      │              │   │
│  │  │ + the event loop    │   │ some crypto   │              │   │
│  │  │ ~2 ms per request   │   │ V8 GC threads │              │   │
│  │  └──────────┬──────────┘   └───────────────┘              │   │
│  └─────────────┼─────────────────────────────────────────────┘   │
│                │                                                 │
│         ┌──────┴──────────────────────────────┐                  │
│         │  RAM  — 512 MB cgroup cap           │                  │
│         │  • 80 suspended async functions     │                  │
│         │    (heap objects — §0.5)            │                  │
│         │  • socket buffers with finished     │                  │
│         │    query results waiting to be read │                  │
│         └──────┬──────────────────────────────┘                  │
│                │                                                 │
│         ┌──────┴──────┐                                          │
│         │     NIC     │                                          │
│         └──────┬──────┘                                          │
└────────────────┼─────────────────────────────────────────────────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
 ┌────────┐ ┌────────┐ ┌──────────┐
 │Postgres│ │ Redis  │ │ browsers │
 │ ~30 ms │ │  ~1 ms │ │ WebSocket│
 │  ↑     │ │   ↑    │ └──────────┘
 │  the   │ │  where │
 │  94%   │ │  your  │
 │        │ │ atomic │
 │        │ │  lives │
 └────────┘ └────────┘
```

Every number in §33 and §37 is now readable off this: `--concurrency=80` is the
count of heap objects in the RAM box; the bcrypt failure is CORE 0 not returning;
the rate-limit race is two of these pictures with no wire between them.

<a id="0-16"></a>
## 0.16 Carry these into 33 / 37 / 47

Twelve sentences. If these are solid, the three sections are mostly consequences.

1. A computer is a hierarchy of distance from the arithmetic unit, and time rises
   brutally as you move away from it: registers, cache, RAM, SSD, network.
2. A CPU can execute ~100 million instructions in the time one Postgres query
   takes. Everything here is about not wasting that.
3. One core box executes one instruction stream at a time; all arithmetic happens
   in registers, so everything else is moving data towards them and back.
4. The MMU translates every address through a per-process page table, which is
   why one process physically cannot reach another's memory.
5. A thread is a stack plus an instruction pointer; the kernel keeps a run queue
   of threads that want a core and a wait queue of threads that don't.
6. Only the kernel touches hardware — enforced by a CPU mode bit, entered through
   the `syscall` instruction.
7. The NIC writes arriving data into RAM by itself (DMA) and interrupts a core
   afterwards, which is why "the CPU is free while waiting" is literally true.
8. Blocking moves your thread to the wait queue; non-blocking keeps it in the run
   queue, and `epoll` lets one thread watch thousands of sockets in one syscall.
9. Concurrency is taking turns; parallelism is genuinely simultaneous and needs
   more than one core box.
10. Node = one thread + an event loop; your JS runs in uninterruptible bursts, so
    a 250 ms CPU burst leaves finished results sitting unread in RAM.
11. Read-modify-write races lose updates. Locks work between cores because cache
    coherence wires them together; nothing wires two machines together, so
    atomicity must live where the single copy of the state lives — Redis.
12. One Cloud Run instance = one container = one process = one JS thread, on a
    slice of a machine it shares with no one you know.

---

<a id="33"></a>
## 33. "how come max instance 2 but concurrency can be 80"

These are two independent axes, and multiplying them gives your capacity.

- **`--concurrency=80`** — how many requests **one instance** handles at the same time.
- **`--max-instances=2`** — how many **instances** can exist.
- Total in-flight capacity for Core: **2 × 80 = 160** simultaneous requests.

**Why 80 on one Node process, when Node is single-threaded.** A typical Core request spends about 2 ms of CPU (parse, serialise) and about 30 ms **waiting** on Postgres. During that wait the thread is free. Node's event loop uses it to start the next request. So one process can hold 80 requests in flight while only ever executing one line of JS at a time, because 78 of them are blocked on I/O.

This only works because the work is I/O-bound. If Core did heavy CPU work — bcrypt is the notable exception, at about 250 ms of pure CPU — the event loop blocks and high concurrency makes latency worse for everyone. Worth knowing about your own login endpoint.

**Why not `--concurrency=1`.** Then 100 simultaneous requests demand 100 instances. With `--max-instances=2` you'd serve 2 requests at a time and queue or 429 everything else — the app appears broken. Without a max-instances cap you'd get 100 containers and a real bill. Concurrency is what keeps a small instance count sufficient.

**How the two interact under load.** Cloud Run adds an instance when existing ones approach their concurrency target. With 100 requests arriving: instance 1 takes 80, Cloud Run starts instance 2 for the remaining 20. At 200 requests: both instances are at 80 (160 total), and the extra 40 queue briefly, then get **429 Too Many Requests** — because max-instances is a hard ceiling. That is the intended behaviour: you'd rather reject traffic than receive a surprise bill.

**Why Collab's numbers differ (250 / 3600 s).** Its unit of work is an open socket that's mostly idle — a user typing occasionally uses almost no CPU. So one instance can hold many more. And here the meaning of the flag changes in an important way: `250 × 2 = 500` becomes your **hard ceiling on concurrent WebSocket connections**. The 501st user is rejected. That's why §8 of the design doc warns that your k6 headline number will hit the *configured* limit before it hits hardware — so raise the flag deliberately before concluding "N is what the system can do".

---

<a id="37"></a>
## 37. "Explain how k6 load test works, also my concurrency knowledge is very weak"

### Concurrency fundamentals first

**Concurrency vs parallelism** — the distinction everything else rests on:

- **Concurrency:** multiple tasks *in progress* over the same period, interleaved. One CPU can be concurrent by switching between tasks.
- **Parallelism:** multiple tasks *executing at the same instant*, which requires multiple cores.

Node gives you concurrency without parallelism for your JS: **one thread runs your JavaScript**, and an **event loop** drives it. When your code does `await db.query(...)`, the query is handed to the OS, your function suspends, and the event loop runs other work. When the result arrives, your function resumes. So 80 requests are in flight with only one line of JS executing at any moment (§33). This is why Node handles I/O-bound work well and CPU-bound work badly: a 250 ms bcrypt hash **blocks the event loop**, and all 79 other requests wait.

**Race condition** — the core hazard. Two concurrent operations interleave on shared state and produce a result neither would alone. The canonical shape is read-modify-write:

```
inst 1: read tokens = 1
inst 2: read tokens = 1     <- same value, before inst 1 writes
inst 1: write tokens = 0
inst 2: write tokens = 0    <- inst 1's decrement is lost
```

That's the **lost update** from §23. Note it needs no threads — two separate *machines* did it. This is the whole reason for Lua scripts.

**Atomic** — an operation that cannot be observed half-done and cannot be interleaved. Redis commands are atomic individually; a *sequence* of them from your app is not. A Lua script makes the sequence atomic.

**Blocking vs non-blocking** — blocking means the thread waits and can do nothing else. In Node, one blocking call harms every concurrent request, not just its own.

**Idempotent** — safe to repeat (§31). This is the practical *defence* when you can't prevent duplication, and duplication is unavoidable in a distributed system.

**Percentiles** — with concurrency, an average lies. If 95 requests take 10 ms and 5 take 2 s, the average is about 110 ms and no request took 110 ms. **p95 = 95% of requests were faster than this.** Always report p95/p99; the tail is what users notice, and the tail is where contention shows up.

### How k6 works

k6 is a load-testing tool. You write a JS script describing what one user does; k6 runs many copies of it and reports timing statistics.

```js
import ws from 'k6/ws';

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // ramp 0 -> 50 virtual users
    { duration: '2m',  target: 50 },   // hold 50
    { duration: '30s', target: 200 },  // ramp to 200
    { duration: '2m',  target: 200 },  // hold
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    edit_latency:    ['p(95)<200'],    // fail the test if p95 > 200ms
    ws_connecting:   ['p(95)<1000'],
  },
};

export default function () {
  ws.connect(`${__ENV.URL}/collab/s42`, { headers: { /* JWT */ } }, (socket) => {
    socket.on('open',    () => { /* send a Yjs update every 2s */ });
    socket.on('message', (m) => { /* record propagation latency */ });
    socket.setTimeout(() => socket.close(), 60_000);
  });
}
```

The mechanics that matter:

- **VU (virtual user)** = one concurrent execution of your script. k6's runtime is Go, so each VU is a goroutine, not an OS thread — one laptop can drive thousands. This is why k6 rather than a Node script: a Node load generator would be limited by its own single event loop and you'd measure your *client*, not your server.
- **Stages** ramp load rather than applying it instantly. Ramping is what reveals the *knee* — the load level where latency stops being flat and starts climbing. A flat 200-VU test tells you pass/fail; a ramp tells you where the limit is.
- **Thresholds** turn the run into a pass/fail check, which is what lets it live in CI.
- **Custom metrics** — for your headline number you need edit-propagation latency, which k6 doesn't know about. You record it yourself: stamp a timestamp into the update you send, and when the echo arrives compute the delta into a `Trend` metric.

**Why the doc runs it twice.** Locally against docker-compose first: fast iteration, free, catches the dumb bugs (a socket leak, an unbounded map, a missing `await`). Then against Cloud Run with the Grafana dashboard open: this is the run that produces the real number, because only there do `--concurrency=250`, cold starts, real network latency to `asia-southeast1`, and Upstash's command limits apply.

**The trap §8 of the design doc warns about**, now that concurrency is clearer: `--concurrency=250` counts each open WebSocket as one in-flight request. So your first ceiling is a **config flag**, not hardware. If you report "holds 250 connections" without noticing, you've measured your own configuration. Raise the flag, re-run, and find where *latency* degrades — that's the real number. And measure from two directions: k6's client-side latency and your `/metrics` WebSocket connection count, so you can tell "the server is saturated" from "my load generator is saturated".

---

<a id="47"></a>
## 47. "one thread runs your JS and an event loop drives it" — what does that actually mean, does Node really have one thread, and does multiple threads mean parallelism?

Four questions. Taking them in the order that makes each one answerable.

### First, what a thread actually is

A **thread** is the unit the operating system schedules onto a CPU core. It carries two things: a **call stack** (which functions are currently part-way through, and their local variables) and an **instruction pointer** (which machine instruction is next). The OS decides which threads sit on which cores, and it can pause one mid-instruction-stream to run another — that's a **context switch**.

A **process** is a running program with its own isolated memory. A process contains one or more threads, and threads inside the same process **share that memory** — which is precisely why multi-threaded code is dangerous: two threads can touch the same variable at genuinely the same instant.

One core executes instructions from exactly one thread at a time. That single fact is what the rest of this rests on.

### "One thread runs your JavaScript"

When you start Node, the OS creates a process. Inside it, one thread — the **main thread** — executes your JavaScript. Every line of JS you write runs on it, one line at a time. **Two of your functions can never be executing simultaneously.** Not "rarely", not "usually not" — the runtime provides no way for it to happen.

That's why `tokens = tokens - 1` inside one Node process is safe from the lost-update race in §37, and why the same operation across two Cloud Run *instances* is not. Different processes, different machines, no shared memory, genuinely simultaneous.

Note the exact claim: **one thread runs your JS.** Not "Node has one thread". Those are different statements, and the second one is false — see below.

### What the event loop is

It's a loop. Written in C, inside a library Node uses called **libuv**, running on that same main thread. Stripped to its skeleton:

```
while (there is still work outstanding) {
    run any timer callbacks whose time has come      // setTimeout, setInterval
    ask the OS which pending I/O operations finished  // <- the loop waits here
    run the callback for each finished operation      // <- YOUR JS RUNS HERE
    run setImmediate callbacks
    run close callbacks (e.g. 'socket closed')
}
```

Each named step is a **phase**, and the loop visits them in that fixed order, over and over. (Node's real loop has a couple of extra internal phases; I'm trimming those because they never change how you reason about your own code.)

So "the event loop drives your JS" means: **your JavaScript does not run continuously.** It runs in bursts. Each burst starts because the loop pulled a finished event off a queue and called the callback attached to it. Your callback runs **to completion** — the loop cannot interrupt it — then returns, and the loop moves on.

Run-to-completion is the property that makes single-threaded JS safe to write. Nothing can interleave inside your function body, so `tokens = tokens - 1` can't be split in half by something else.

### What actually happens on `await db.query(...)`

This is the part that's usually hand-waved, and hand-waving it leaves you unable to predict behaviour. The concrete sequence, on Linux:

1. Your JS calls into Node's C++ layer, which writes the query to an already-open TCP socket. The socket is in **non-blocking mode**, so the write returns immediately rather than waiting for Postgres.
2. Node registers interest with the kernel: *"tell me when file descriptor 7 has data to read."* On Linux the mechanism is **`epoll`** (`kqueue` on macOS, IOCP on Windows).
3. Your `async` function **suspends**. Its local variables and its resume position are saved into a heap-allocated object, and the call stack unwinds — the function is no longer on the stack at all. Control returns to the event loop.
4. The loop carries on. Other callbacks run. Other requests progress.
5. When the loop reaches its polling phase it calls **`epoll_wait`** — a syscall meaning *"which of these hundreds of descriptors are ready? if none, sleep until one is."*
6. The kernel returns "descriptor 7 is readable". Node reads the bytes, parses the result, and **resolves the promise** your function was waiting on.
7. Resolving the promise queues your function's continuation as a **microtask**, which runs the instant the current callback finishes — before the loop advances to the next phase. Your function resumes at the line after the `await`, with its locals restored.

**Two things worth extracting from that.**

The loop *does* block — in step 5, inside `epoll_wait`. That's fine, because it's blocking on "*anything at all* becoming ready", not on one specific query. It sleeps only when there is genuinely nothing to do.

And `await` creates no thread. It means: *suspend this function, hand control back to the loop, resume when this promise settles.* Because a suspended function lives on the heap and not on the stack, you can have 80 of them suspended at once without 80 call stacks — which is exactly what makes `--concurrency=80` (§33) cheap.

### The scenario this predicts — and the failure

Your Core instance, `--concurrency=80`. A request costs ~2 ms of CPU (parse, route, serialise) and ~30 ms waiting on Postgres.

Working case: request 1 uses 2 ms of the thread, hits `await`, suspends. The loop immediately starts request 2. By the time request 1's rows come back, requests 2–80 have all had their 2 ms. The thread is busy roughly 160 ms total while 2,400 ms of waiting happens in the kernel, overlapped. One thread, 80 requests in flight, no parallelism anywhere.

**Failure case:** one request calls a pure-JavaScript password hash costing 250 ms of CPU. There is no `await` inside it that yields — it's a tight computation loop. For 250 ms the event loop **cannot reach step 5**. Postgres results for the other 79 requests arrive in kernel buffers and sit there unread. Every one of those requests stalls, not because they're slow but because nothing is available to process their completions. Your p95 latency spikes across the board, and `/health/ready` can't answer either — long enough and Cloud Run declares the instance unhealthy.

**The fix** is never "make it faster"; it's *get it off the main thread* — a native addon that runs it on the thread pool, a `worker_thread`, or moving the work out of the request path entirely. In DeepCS this became moot: hashing now happens inside Firebase (ADR-04), so no CPU-bound work sits on Core's request path at all.

### Does Node really have only one thread? No.

A Node process is genuinely multi-threaded. What's single is *your JavaScript*.

| Thread(s) | Count | What runs there |
|---|---|---|
| **Main thread** | 1 | All your JS, plus the event loop itself |
| **libuv thread pool** | 4 by default (`UV_THREADPOOL_SIZE`) | Work with no good non-blocking OS interface: **file system** calls, **DNS** resolution via `getaddrinfo`, and some **crypto** (`pbkdf2`, `randomBytes`, native `bcrypt`) |
| **V8 internal threads** | several | Garbage collection helpers, background JIT compilation |
| **`worker_threads`** | 0 unless you create them | Separate V8 isolates, each with its **own** event loop |

Two consequences that actually bite.

**Network I/O does not use the thread pool.** Sockets go through `epoll`, which is why one Node process can hold thousands of connections with four pool threads. **File** I/O does use the pool — so 5 concurrent file reads means one queues behind the other four.

**This corrects a compression in §37.** That section says a 250 ms bcrypt "blocks the event loop". True for `bcrypt.hashSync(...)` or the pure-JS `bcryptjs` package. But `await bcrypt.hash(...)` from the *native* `bcrypt` package runs the hash on a **pool thread**, so the event loop keeps serving — at the cost of occupying one of only four pool slots, meaning a fifth concurrent hash waits. The general lesson stands; the specific claim was too broad.

`worker_threads` deserve one line of precision: they do **not** share ordinary variables. Each has its own isolate and heap; they communicate by copying messages or through an explicitly shared `SharedArrayBuffer`. So spawning workers doesn't hand you the classic shared-memory data races — you have to opt into that.

### Does multiple threads mean parallelism? No — it enables it.

**Parallelism needs three things at once:** more than one thread, more than one core, and the OS actually scheduling those threads onto different cores in the same instant. Threads alone give you only the first.

|  | One thread | Multiple threads |
|---|---|---|
| **One core** | Concurrency only — the event loop interleaves at `await` points | Concurrency only — the OS time-slices, switching rapidly between threads |
| **Multiple cores** | Concurrency only — one thread can occupy just one core | **Parallelism possible** — genuinely simultaneous execution |

The cell people miss is bottom-left: Node on a 16-core machine still runs your JS on one core. The other 15 do nothing for your JavaScript. Scaling out means more processes or more instances, which is exactly what `--max-instances` governs — and exactly why the rate-limit bucket needs Redis rather than a variable in memory.

Top-right is the other easy mistake: two threads on a single core are *not* parallel. They interleave, same as the event loop, just with the OS choosing the switch points instead of your `await`s.

**The precise definitions**, now that the mechanics justify them:

- **Concurrency** is a property of how a program is *structured*: multiple tasks are in progress over the same period. It is achievable on one core, with one thread.
- **Parallelism** is a property of how it *executes*: instructions from different tasks retire in the same instant. It requires hardware.

Node is the clean proof that these are separable — massively concurrent, not remotely parallel.

### The five sentences worth keeping

1. A thread is what the OS schedules onto a core; one core runs one thread at a time.
2. Node runs all your JS on one thread, so two of your functions never execute simultaneously — but a Node *process* has other threads, and other Cloud Run *instances* are fully separate processes.
3. The event loop is a C loop on that thread that asks the kernel which I/O finished and calls the matching JS callback; your code runs in bursts, each burst uninterruptible.
4. `await` suspends a function to the heap and returns control to the loop; it starts no thread and costs no stack.
5. Threads make parallelism *possible*; cores make it *actual*; concurrency needs neither.
