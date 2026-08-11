# Reading the Kubernetes setup

Everything you need to read [`k8s/`](../../k8s/) without guessing. The companion
to [`docker.md`](docker.md), which stops at the point where containers are
started by hand and by `docker compose`. This picks up there.

**The goal is bounded on purpose.** Not "learn Kubernetes". The goal is that the
fourteen files in `k8s/` read as ordinary English, and that you can say what
happens, in order, when a pod is replaced while somebody is using it. That
sentence is the whole reason this cluster exists.

**Don't read this front to back.** Pick the path that matches why you're here:

| If you want to… | Read | Time |
|---|---|---|
| **understand it well enough to explain your work** | **Part 1**, then **Part 3**, then the interview section | **~25 min** |
| know what each file in `k8s/` is | Part 2 | 10 min |
| understand how a rolling update drops nothing | Part 3 | 10 min |
| know why there is no registry | Part 4 | 3 min |
| debug a pod that will not start | Part 6 | as needed |
| know what the cluster does that compose cannot | Part 7 | 5 min |

---

# Part 1 — The whole thing in one page

## The problem compose does not solve

`docker compose up` runs the system. It is genuinely good at that, and it stays
the thing to develop against. What it cannot do is answer the question an
operator actually has:

> I need to replace the Gateway with a new version, right now, while people are
> using it. How many of them notice?

Compose's answer is "all of them, briefly". `docker compose up -d --build`
stops the old container and starts the new one. Between those two moments there
is no Gateway. Every request in that window fails.

That gap is not a bug in compose; it is the absence of a *scheduler*. Making the
gap disappear needs something that will run two copies at once, watch both, know
which one is ready to receive traffic, and move traffic between them without
being told. That thing is an **orchestrator**, and Kubernetes is one.

## The five nouns

Almost all the confusion is that Kubernetes has a noun for each of five things
compose smears into one `services:` entry.

1. **Pod** — one or more containers that share an IP address and a lifetime. In
   this repo every pod is exactly one container, so "pod" and "container" are
   nearly interchangeable here. It is the smallest thing Kubernetes schedules.
   Pods are **disposable**: they are created, they die, they are never repaired.

2. **Deployment** — a standing instruction of the form *"keep two pods of this
   image running at all times"*. You do not create pods; you create a Deployment
   and it creates them. When you change the image, the Deployment replaces them,
   one at a time, according to rules you give it. This is the object that makes
   a rolling update possible at all.

3. **Service** — a **stable name and IP in front of a changing set of pods**.
   Pods come and go and each new one gets a new IP; nothing could address them
   directly. A Service named `users` is reachable at `http://users:8081` from
   anywhere in the namespace, forever, and it forwards to whichever pods are
   currently *ready*. That last word is the load-bearing one, and Part 3 is
   about it.

4. **Ingress** — a rule for getting traffic *in from outside the cluster*. A
   Service is only reachable from within. Exactly one Ingress exists here, and
   it points at the Gateway.

5. **Job / CronJob** — a pod that is expected to *finish*. A Deployment restarts
   a container that exits, because exiting is failure for a server. For the
   migration and for Stats, exiting is success, so they cannot be Deployments.

Two more, which are just files with values in them:

- **ConfigMap** — plain configuration, injected as environment variables.
- **Secret** — the same thing, for values with a password in them. Kubernetes
  base64-encodes it, which is encoding and not encryption; the protection is
  access control, not the encoding.

And one that is only bookkeeping:

- **Namespace** — a name prefix that groups objects. Everything here is in
  `deepcs`, so `kubectl delete namespace deepcs` removes the whole system.

## What `kind` is

**kind** is "Kubernetes IN Docker". It runs a real, unmodified Kubernetes
cluster with the *nodes themselves* as Docker containers.

That is worth pausing on, because it is the part that sounds impossible. A
node is normally a machine. Here, `deepcs-control-plane` is a Docker container
that has containerd inside it, and your pods are containers *inside that
container*. It is genuinely the same Kubernetes that runs in a datacentre, with
the machines faked and nothing else.

```
your laptop
└── docker
    └── deepcs-control-plane          ← one Docker container, the "node"
        ├── kubelet, containerd, the API server
        └── the pods, as containers inside it
            ├── gateway ×2   users ×2   questions ×2
            ├── matching ×2  collab ×2  stats-api ×2
            ├── postgres     redis      firebase-auth
            └── ingress-nginx-controller
```

Port 80 on that node container is published to `localhost:8090` on your laptop
(`k8s/kind-cluster.yaml`), which is the only way in.

## So: one system, two ways to run it

| | `docker compose` | `kind` |
|---|---|---|
| what runs | the `dev` image, `tsx watch` | the `runner` image, bundled `dist/` |
| source | bind-mounted, edits reload | baked in, a change needs a rebuild |
| copies of each service | one | two |
| the way in | published ports, 8080 | Ingress, 8090 |
| ordering at startup | `depends_on` | the order `k8s/up.sh` applies things |
| what it is for | developing | showing what happens when a pod dies |

---

# Part 2 — The files, one at a time

`k8s/` is raw YAML with no Helm and no Kustomize. That is a deliberate choice
and it costs something: the six service files repeat a shape rather than sharing
a template, so a change to probes is six edits. The reason to accept that here
is that the point of the directory is to *be read*, and a template engine means
you cannot read the thing that actually runs without rendering it first.

| File | What it is |
|---|---|
| `kind-cluster.yaml` | the cluster itself: one node, port 80 published to 8090 |
| `00-namespace.yaml` | the `deepcs` namespace |
| `01-config.yaml` | ConfigMap of plain values, Secret of the seven database URLs |
| `10-postgres.yaml` | Postgres, one replica, no persistence at all |
| `11-redis.yaml` | Redis, one replica, persistence explicitly off |
| `12-firebase-auth.yaml` | the Auth emulator |
| `20-migrate.yaml` | a Job: apply the numbered `.sql` files, then exit |
| `30-gateway.yaml` … `35-stats-api.yaml` | the six services, Deployment plus Service each |
| `40-stats-cronjob.yaml` | Stats, as the scheduled job it is |
| `50-ingress.yaml` | the one route in, to the Gateway |
| `up.sh` / `down.sh` | `make k8s-up` / `make k8s-down` |
| `disruption-check.sh` | `make k8s-check`, the measurement in Part 3 |

The number prefixes are the order `up.sh` applies them, and the order matters
for a reason Part 5 explains.

## Why the data tier has one replica and the services have two

Two Postgres pods behind one Service would be two unrelated databases, and the
Service would hand out alternate answers to alternate queries. The same is true
of Redis, where the atomic claim that pairs two people is only atomic within one
Redis. So both are one replica with `strategy: Recreate`, which means "stop the
old one before starting the new one" — the opposite of what the services want,
and correct here.

The six services are two replicas because a single pod cannot be replaced
without a gap, and closing that gap is the entire exercise.

---

# Part 3 — The mechanism this cluster exists to show

## Liveness and readiness are different questions

Every service answers two endpoints, built once in
[`packages/shared/src/service.ts`](../../packages/shared/src/service.ts):

- **`/health/live`** — *is this process wedged?* If this fails, restart the pod.
- **`/health/ready`** — *may traffic be routed here yet?* If this fails, take
  the pod out of the Service's endpoint list, but leave it running.

Conflating them is the classic mistake and it has a specific failure. A service
whose Postgres pool has not finished connecting is **live but not ready**. If
readiness were the only probe, it would be sent traffic it must fail. If
liveness were the only probe, Kubernetes would kill a perfectly healthy process
for the crime of still starting up. Then it would kill its replacement, for the
same reason, forever.

There is a third probe in these manifests, `startupProbe`, which exists to buy
slow starters time without making the other two slow. While a startup probe is
failing, the liveness and readiness probes are not run at all. The Auth
emulator is a JVM and takes seconds; giving it a long `initialDelaySeconds` on
liveness instead would delay every *subsequent* liveness check too, so a
genuinely wedged process would go unnoticed for just as long.

**Readiness is only meaningful if it can say no.** The probe in this repo does:
if the dependency a service cannot work without is unreachable, it answers 503,
and the pod leaves rotation until it recovers. Which dependencies count is a
per-service judgement, and the interesting cases are the ones that are
deliberately *not* included. The Gateway does not fail readiness when Redis is
down, because it fails open on a Redis outage and keeps serving. Questions does
not either, because a cold cache makes it slower, not broken. Listing a
dependency there that the service can survive without would take every replica
out of rotation during an outage the code was written to tolerate.

## The rolling update, in order

When you change a Deployment's pod template, this is what happens. Two
replicas, `maxUnavailable: 0`, `maxSurge: 1`:

1. A third pod is created with the new template. Two old pods are still serving.
2. The new pod starts. Its startup probe fails until the process listens.
3. Its readiness probe passes. **Now** it is added to the Service's endpoints.
4. Only now is one old pod told to go away.
5. That old pod's `preStop` hook runs: it sleeps for five seconds.
6. It gets SIGTERM. Fastify stops accepting new connections and lets in-flight
   requests finish.
7. Repeat from step 1 for the second old pod.

Four settings make that work and removing any one breaks it:

| Setting | What goes wrong without it |
|---|---|
| `replicas: 2` | there is only one pod, so there is nothing to serve during its replacement |
| `maxUnavailable: 0` | the default is 25%, which on two pods rounds to one — a window at half capacity |
| `readinessProbe` | "ready" has no definition, so step 3 is just "the container started", and traffic arrives before the process is listening |
| `preStop` | see below, and this is the one that gets missed |

## The `preStop` race, which is the interesting part

Step 4 above is a lie by omission. When Kubernetes removes a pod, two things
happen **in parallel, not in sequence**:

- the container is sent SIGTERM, and
- the pod is removed from the Service's endpoint list.

The second one is not instant. Endpoint removal has to propagate to the thing
that actually routes packets on every node, and to the ingress controller, which
keeps its own copy. That propagation takes some milliseconds to some hundreds of
milliseconds, and *nothing waits for it*.

So the default sequence is: the process starts refusing connections, while the
Ingress is still confidently sending it requests. Those requests get a refused
connection. They are the dropped requests.

The fix is to make the pod do nothing for a moment before it starts shutting
down. `lifecycle.preStop` runs before SIGTERM is sent, and SIGTERM waits for it:

```yaml
lifecycle:
  preStop:
    exec:
      command: ['sleep', '5']
```

The pod keeps serving normally for those five seconds. The endpoint removal
propagates during them. By the time the process is told to stop, nothing is
routing to it any more.

This is why `terminationGracePeriodSeconds` has to be longer than the preStop
pause plus however long the real shutdown takes. It counts from SIGTERM, and
when it expires the process is SIGKILLed with no further conversation. Collab
gets 45 seconds rather than 30 because its shutdown does real work: it snapshots
every document it is still holding to Postgres before exiting.

## What this does *not* cover: WebSockets

Everything above is about HTTP requests, which are short. A WebSocket is not
short. When a Collab pod is replaced, the sockets attached to it are closed —
`preStop` delays that, it does not prevent it, and no setting in a Deployment
can, because the pod is going away and the socket lives in the pod.

What protects the *user* is on the other two sides of the connection:

- Collab snapshots its documents on SIGTERM, so the state is in Postgres before
  the process exits.
- The browser client reconnects on an unexpected close and resumes from that
  snapshot ([`frontend/src/collab.ts`](../../frontend/src/collab.ts)).

So the accurate sentence is *"a replaced Collab pod costs a reconnect, not any
edits"*, and it is worth being precise about that rather than claiming a
disruption nobody notices at all. What the measurements say about this is in
[`../system/09-running-it.md`](../system/09-running-it.md).

---

# Part 4 — How the images get in, with no registry

Normally a node pulls images from a registry. There is no registry here, and
setting one up locally would be a service to run and a decision to explain for
no benefit.

`kind` has a direct route instead:

```bash
kind load docker-image --name deepcs deepcs/gateway:local
```

That takes an image out of your laptop's Docker and pushes it into the node
container's containerd. No network, no registry, no credentials.

It has one consequence that will bite you exactly once. The tag `deepcs/gateway:local`
exists nowhere in the world. If a pod ever tried to *pull* it, the pull would
fail and the pod would sit in `ErrImagePull` forever. So every manifest sets:

```yaml
imagePullPolicy: IfNotPresent
```

which means "use the local copy if there is one, and only then try to pull".
The default for a tag that is not `:latest` is already `IfNotPresent`, so this
is belt and braces — but it is the kind of default that is easy to lose by
renaming a tag, and the failure it prevents is a confusing one.

The second consequence: **`kind load` again after every rebuild**. An image
rebuilt on your laptop does not reach the node on its own. `make k8s-up` does
both, which is why it is the command to re-run after a code change rather than
`kubectl apply`.

---

# Part 5 — Reading `k8s/up.sh`

The script is mostly one idea: **Kubernetes has no `depends_on`.**

Compose can be told that a service must not start until the migration container
has exited successfully (`condition: service_completed_successfully`). Kubernetes
has no equivalent. Everything you apply starts immediately and in parallel.

That matters here for a specific reason. If the services came up before the
migration ran, they would not crash — they would come up perfectly happily,
answer their readiness probe (which is `SELECT 1`, and succeeds against an empty
database), be added to their Services, and start serving queries against tables
that do not exist yet.

So the ordering lives in the script:

1. create the cluster if it is not there
2. install the ingress controller, and wait for it
3. build the eight images, and `kind load` them
4. apply the namespace and config
5. apply Postgres, Redis and the emulator, and **wait for all three**
6. delete and re-apply the migration Job, and **wait for it to complete**
7. only then apply the six services, the CronJob and the Ingress

Two details in there are worth knowing.

**The Job is deleted before it is applied.** A Job's pod template is immutable
once it exists, so `kubectl apply` over a Job that has already run is rejected
rather than re-run. Deleting first also means every `make k8s-up` starts from a
known schema. Re-running is safe because the runner records each file in
`public.schema_migrations` and skips what it has applied, and the seeds are
written `ON CONFLICT DO UPDATE` for exactly this.

**The wait on the Job watches for failure too.** `kubectl wait --for=condition=complete`
sits there until its timeout when the Job fails rather than succeeds. Three
minutes of silence is the least useful way to find out the database is not
there, so the script checks and prints the Job's logs.

---

# Part 6 — Debugging

| Symptom | Command |
|---|---|
| what is running | `kubectl -n deepcs get pods` |
| why is that pod not starting | `kubectl -n deepcs describe pod <name>` — read **Events** at the bottom first |
| what did it say before it died | `kubectl -n deepcs logs <name> --previous` |
| is it ready, and why not | `kubectl -n deepcs get pod <name> -o jsonpath='{.status.conditions}'` |
| which pods is a Service actually sending to | `kubectl -n deepcs get endpointslice -l kubernetes.io/service-name=collab` |
| reach a ClusterIP service from your laptop | `kubectl -n deepcs port-forward svc/collab 8184:8084` |
| watch a rollout happen | `kubectl -n deepcs rollout status deployment/gateway` |
| undo one | `kubectl -n deepcs rollout undo deployment/gateway` |
| did the CronJob run | `kubectl -n deepcs get jobs` |

Add `--context kind-deepcs` to any of these if `kubectl` is pointed at another
cluster. `k8s/up.sh` deliberately never switches your current context.

Three failures worth recognising on sight:

- **`ImagePullBackOff`** on a `deepcs/*:local` image means `kind load` has not
  run for it. Run `make k8s-up`.
- **`CrashLoopBackOff` with a rising restart count** means the process is
  exiting. `logs --previous` is the only thing that will tell you why; `logs`
  alone shows the new container, which has not failed yet.
- **A pod that is `Running` but `0/1`** is failing its readiness probe. It is
  not broken, it is refusing traffic. `describe` names the probe and the status
  code it got.

---

# Part 7 — What differs from compose, and why

| | compose | cluster | why |
|---|---|---|---|
| the Auth emulator's accounts | survive a restart | do not | the emulator only exports on a clean SIGINT, and Kubernetes always sends SIGTERM. There is no volume either way, and nothing depends on it |
| Postgres data | a named volume | nothing | `make k8s-up` re-runs the migration and the seeds every time, so a volume could only let a run inherit half of a previous one |
| Redis persistence | the image default, on | explicitly off | it would fork and write a dump file into a filesystem that is thrown away |
| `NODE_ENV` | `development` | `development` | see below, it is the surprising one |
| how services find each other | compose's service-name DNS | Kubernetes Service DNS | identical in practice: `http://users:8081` works in both |

**The `NODE_ENV` one.** These are the production-target images, and the
ConfigMap sets `NODE_ENV=development` anyway. That is not an oversight. The
Gateway *refuses to boot* when `FIREBASE_AUTH_EMULATOR_HOST` is set and
`NODE_ENV` is `production`, because the emulator issues unsigned tokens and
accepting those in production means accepting forged identities
([`services/gateway/src/auth.ts`](../../services/gateway/src/auth.ts)). This
cluster runs the emulator, so it is by definition not production, and saying so
is what keeps that guard able to fire somewhere it matters. A cluster that
lied about this would boot fine and be the exact thing the guard was written to
prevent.

---

# Explaining this in an interview

Nine questions, and the answers this repo actually supports.

**What does Kubernetes give you that Docker Compose does not?**
A scheduler. Compose starts containers; it has no opinion about what to do when
one dies, and no way to replace one without a gap. Kubernetes keeps a declared
number of pods running, decides which of them may receive traffic, and moves
traffic between them without being told.

**What is a Service?**
A stable name in front of a changing set of pods. Pods are disposable and each
gets a new IP, so nothing addresses them directly. The Service forwards to
whichever pods are currently passing their readiness probe.

**Liveness or readiness — what is the difference?**
Liveness asks "is this wedged, restart it". Readiness asks "may traffic go here
yet". A service still connecting to its database is live but not ready.
Conflating them makes Kubernetes kill healthy processes for starting slowly.

**How do you deploy without dropping requests?**
Two replicas, `maxUnavailable: 0` so the count never dips, a readiness probe so
"available" means something, and a `preStop` pause so the pod stops being routed
to before it stops answering.

**Why does `preStop` matter?**
Because SIGTERM and endpoint removal happen in parallel, and endpoint removal
has to propagate. Without a pause the process starts refusing connections while
the ingress is still sending it traffic. That window is where dropped requests
come from, and it is the part people leave out.

**How do you know it worked?**
`make k8s-check` sends a steady stream of authenticated requests through the
Ingress, restarts every Gateway and Questions pod underneath it, and counts what
came back. The numbers are in
[`../system/09-running-it.md`](../system/09-running-it.md).

**What about WebSockets?**
They break, and the honest claim is narrower. A replaced pod closes its sockets;
nothing in a Deployment can prevent that. What is protected is the *state*:
Collab snapshots its documents on SIGTERM and the browser reconnects and resumes
from the snapshot. A reconnect, not lost edits.

**Why one node?**
Both claims are properties of readiness probes and Service endpoints, and
neither involves a second node. More nodes would be more containers and another
full copy of every image to load, for nothing this demonstrates.

**Why is none of this deployed?**
See [`../adr/05-kubernetes-locally-no-deployment.md`](../adr/05-kubernetes-locally-no-deployment.md).
The behaviours worth showing need an orchestrator; they do not need a hosted
one, and a hosted one bills by the hour whether or not anybody visits.
