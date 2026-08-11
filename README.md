# deepcs

Learn CS fundamentals from a roadmap, then check yourself against the
questions. Nine topics laid out by what makes what easier to read; each one
opens into three steps, and a step is a lesson plus the questions it prepares
you for. Answer them alone, or get matched with someone and work through them
in a shared editor.

Six services in TypeScript, one Postgres with a schema and role per service, and
real-time collaborative editing on a CRDT. See
[the overview](docs/system/00-overview.md) for the architecture and the
reasoning behind it.

## How to run it

```bash
make up      # the backend: Postgres, Redis, the Auth emulator, six services
make web     # the frontend on http://localhost:5173
make test    # the suites, against the real Postgres and Redis
make load    # the k6 load run against the running stack
```

There is a second way to run the same system, on a local Kubernetes cluster:

```bash
make k8s-up     # the whole stack on a kind cluster, gateway on :8090
make k8s-check  # the rolling-update and pod-kill measurements
make k8s-down   # delete the cluster
```

Compose is the one to develop against: it bind-mounts `src/` and reloads. The
cluster runs the production images and is where rolling updates and pod failure
are demonstrated. Both can be up at once, on 8080 and 8090. After a code change
re-run `make k8s-up` rather than `kubectl apply`, because a rebuilt image does
not reach the cluster without `kind load`.

## What it demonstrates, and what each claim is worth

The repo is built on stating what was measured and on which machine, so the
numbers come with their conditions attached. Full results, including the ones
that needed qualifying, are in
[docs/system/09-running-it.md](docs/system/09-running-it.md).

**A rolling update drops no requests.** Zero non-200 out of 1,230, holding a
steady stream through the Ingress while every Gateway and Questions pod was
replaced. That number only means something because two other things were
checked: the prober was separately shown able to detect an outage, and the
ingress was shown not to be quietly retrying failures out of sight.

**A killed pod costs a reconnect, not any edits.** Verified by writing into a
live document, deleting the pod holding that room while the socket was still
open, and reading the text back afterwards. The socket itself does close — no
Kubernetes setting can prevent that — and the client reconnects and resumes from
the snapshot. The narrower claim is the true one.

**250 concurrent collaboration sockets, p50 4 ms edit propagation.** This one is
a fact about an AMD Ryzen AI 7 350 running WSL2, not about deepcs. No run here
makes a capacity claim, because every run measures one laptop.

## Where the docs are

- [docs/system/](docs/system/) — how it works now. Start at `00-overview.md`.
- [docs/adr/](docs/adr/) — the decisions worth knowing, one file each.
- [docs/learning/](docs/learning/) — how the tooling works: Docker, Kubernetes, CI.
- [docs/future/](docs/future/) — things not built, and what deploying would cost.

## There is no deployed version, and that is a decision

This runs on your machine and nowhere else. The deployment was designed (§7 of
the overview) and priced line by line
([docs/future/cost.md](docs/future/cost.md)) before being declined: keeping a
demo online past a free trial means attaching a payment card to it, and the
behaviours worth showing need an orchestrator rather than a hosted one. Knowing
what it would cost, and why, is the deliverable.
